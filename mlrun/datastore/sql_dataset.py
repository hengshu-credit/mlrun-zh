# Copyright 2026 Iguazio
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#   http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Bounded SQL reads and immutable dataset snapshots for platform import jobs."""

import contextlib
import hashlib
import json
import pathlib
import re
import tempfile
import time
import uuid
from datetime import UTC, datetime

import pandas as pd
import sqlalchemy


def validate_query(query: str) -> str:
    """Validate a single read query; database read-only transactions enforce writes.

    :param query: Parameterized SELECT or SELECT CTE.
    :return: Query with a trailing statement terminator removed.
    """
    if not isinstance(query, str) or not query.strip() or len(query) > 100_000:
        raise ValueError("Provide a SELECT query of at most 100000 characters")
    # MySQL executable comments must never disappear as ordinary comments.
    if any(marker in query.upper() for marker in ("/*!", "/*M!", "/*+")):
        raise ValueError(
            "Executable SQL comments and optimizer hints are not supported"
        )
    tokens = re.findall(
        r"--[^\n]*|/\*[\s\S]*?\*/|'(?:''|\\.|[^'])*'|"
        r'"(?:""|[^\"])*"|`(?:``|[^`])*`|\b[a-zA-Z_][\w$]*\b|;',
        query,
    )
    words = [
        token.upper()
        for token in tokens
        if not token.startswith(("--", "/*", "'", '"', "`"))
    ]
    if words and words[-1] == ";":
        words.pop()
    forbidden = {
        ";",
        "INSERT",
        "UPDATE",
        "DELETE",
        "MERGE",
        "DROP",
        "ALTER",
        "CREATE",
        "TRUNCATE",
        "GRANT",
        "REVOKE",
        "COPY",
        "CALL",
        "EXEC",
        "EXECUTE",
        "INTO",
        "LOCK",
        "SET",
        "RESET",
        "DO",
        "VACUUM",
        "ANALYZE",
        "REPLACE",
    }
    if not words or words[0] not in {"SELECT", "WITH"} or forbidden.intersection(words):
        raise ValueError(
            "Only a single read-only SELECT query or SELECT CTE is supported"
        )
    return query.strip().removesuffix(";").rstrip()


def create_query_engine(connection: dict, timeout_seconds: int = 30):
    """Create a supported database engine without exposing credentials in errors.

    :param connection: Validated connection fields including a Secret-resolved password.
    :param timeout_seconds: Connection and read timeout in seconds.
    :return: SQLAlchemy engine; caller must dispose it.
    """
    dialect = connection.get("dialect")
    if dialect not in {"mysql", "postgresql"}:
        raise ValueError("Only MySQL and PostgreSQL connections are supported")
    url = sqlalchemy.engine.URL.create(
        drivername="mysql+pymysql" if dialect == "mysql" else "postgresql+psycopg2",
        username=connection["username"],
        password=connection["password"],
        host=connection["host"],
        port=connection["port"],
        database=connection["database"],
    )
    connect_args = {"connect_timeout": min(timeout_seconds, 30)}
    if dialect == "mysql":
        connect_args.update(read_timeout=timeout_seconds, write_timeout=timeout_seconds)
    return sqlalchemy.create_engine(
        url,
        connect_args=connect_args,
        hide_parameters=True,
        poolclass=sqlalchemy.pool.NullPool,
    )


def preview_query(
    engine, query: str, parameters: dict, limit: int = 50, timeout_seconds: int = 30
) -> dict:
    """Execute a bounded preview using bound query parameters.

    :param engine: SQLAlchemy engine.
    :param query: SELECT query.
    :param parameters: Bound scalar parameters.
    :param limit: Maximum preview rows.
    :param timeout_seconds: Query timeout in seconds.
    :return: JSON-compatible columns, rows and truncation indicator.
    """
    query = validate_query(query)
    if not 1 <= limit <= 100:
        raise ValueError("Preview limit must be between 1 and 100")
    bounded_query = f"SELECT * FROM ({query}\n) AS mlrun_preview LIMIT {limit + 1}"
    with _query_result(engine, bounded_query, parameters, timeout_seconds) as result:
        columns = _result_columns(result)
        rows = result.fetchmany(limit + 1)
        frame = pd.DataFrame(rows[:limit], columns=columns, dtype=object)
        serialized = json.dumps(frame.to_dict(orient="records"), default=str)
        if len(serialized.encode()) > 2_097_152:
            raise ValueError("Query result exceeds the preview size limit")
        return {
            "columns": columns,
            "rows": json.loads(serialized),
            "truncated": len(rows) > limit,
        }


def write_snapshot(
    engine,
    query: str,
    parameters: dict,
    path: pathlib.Path,
    chunksize: int = 10_000,
    max_rows: int = 1_000_000,
    timeout_seconds: int = 300,
    max_bytes: int = 1_073_741_824,
) -> dict:
    """Stream a query to a complete Parquet snapshot before publishing any data.

    :param engine: SQLAlchemy engine.
    :param query: SELECT query.
    :param parameters: Bound scalar parameters.
    :param path: New local snapshot path, never an existing snapshot.
    :param chunksize: Rows fetched per batch.
    :param max_rows: Maximum accepted rows; excess fails the complete import.
    :param timeout_seconds: Maximum query and local materialization duration.
    :param max_bytes: Maximum uncompressed Arrow data size in bytes.
    :return: Row count and a bounded preview DataFrame.
    """
    import pyarrow as pa
    import pyarrow.parquet as pq

    query = validate_query(query)
    path = pathlib.Path(path)
    if path.exists():
        raise ValueError("Snapshot path already exists")
    if chunksize < 1 or max_rows < 1 or max_bytes < 1:
        raise ValueError("Snapshot limits must be positive")
    started = time.monotonic()
    rows = 0
    size_in_bytes = 0
    preview = None
    schemas = []
    # Stage each chunk independently so an initial all-null column can acquire
    # its actual type later without loading the full result into memory.
    with tempfile.TemporaryDirectory(prefix="mlrun-sql-") as temporary:
        parts = []
        bounded_query = (
            f"SELECT * FROM ({query}\n) AS mlrun_snapshot LIMIT {max_rows + 1}"
        )
        with _query_result(
            engine, bounded_query, parameters, timeout_seconds
        ) as result:
            columns = _result_columns(result)
            while batch := result.fetchmany(chunksize):
                rows += len(batch)
                if rows > max_rows:
                    raise ValueError("Query result exceeds the configured row limit")
                if time.monotonic() - started > timeout_seconds:
                    raise ValueError("SQL snapshot timed out")
                # Do not let pandas coerce nullable BIGINT values through float64.
                frame = pd.DataFrame(batch, columns=columns, dtype=object)
                if preview is None:
                    preview = frame.head(20)
                try:
                    table = pa.Table.from_pandas(frame, preserve_index=False)
                except (pa.ArrowException, TypeError):
                    raise ValueError(
                        "Query contains unsupported column types"
                    ) from None
                size_in_bytes += table.nbytes
                if size_in_bytes > max_bytes:
                    raise ValueError("Query result exceeds the snapshot size limit")
                part = pathlib.Path(temporary) / f"{len(parts)}.parquet"
                pq.write_table(table, part)
                parts.append(part)
                schemas.append(table.schema)
        if not rows:
            raise ValueError(
                "Query returned no rows; the previous dataset is unchanged"
            )
        staged = pathlib.Path(temporary) / "snapshot.parquet"
        try:
            schema = pa.unify_schemas(schemas, promote_options="permissive")
            # Preserve nullable integer dtypes for ordinary pandas/DataItem readers,
            # which would otherwise coerce an integer column containing NULL to float.
            metadata = dict(schema.metadata or {})
            pandas_metadata = json.loads(metadata[b"pandas"])
            fields = {field.name: field for field in schema}
            for column in pandas_metadata["columns"]:
                field = fields[column["field_name"]]
                if pa.types.is_integer(field.type):
                    prefix = (
                        "UInt" if pa.types.is_unsigned_integer(field.type) else "Int"
                    )
                    column["numpy_type"] = f"{prefix}{field.type.bit_width}"
                    column["pandas_type"] = str(field.type)
            metadata[b"pandas"] = json.dumps(pandas_metadata).encode()
            schema = schema.with_metadata(metadata)
            with pq.ParquetWriter(staged, schema=schema) as writer:
                for part in parts:
                    if time.monotonic() - started > timeout_seconds:
                        raise ValueError("SQL snapshot timed out")
                    writer.write_table(pq.read_table(part).cast(schema))
        except (pa.ArrowException, TypeError):
            raise ValueError(
                "Query column types are inconsistent across batches"
            ) from None
        # copyfile works when the destination resides on a different filesystem.
        import shutil

        shutil.copyfile(staged, path)
    # Artifact metadata must remain small even when individual SQL cells are large.
    while (
        len(preview)
        and len(json.dumps(preview.values.tolist(), default=str).encode()) > 65_536
    ):
        preview = preview.iloc[:-1]
    from pandas.io.json import build_table_schema

    metadata_schema = build_table_schema(
        schema.empty_table().to_pandas(types_mapper=pd.ArrowDtype)
    )
    return {"rows": rows, "preview": preview, "schema": metadata_schema}


def import_sql_dataset(context, definition: dict):
    """MLRun job handler resolving a connection and publishing a query snapshot.

    :param context: MLRun execution context.
    :param definition: Immutable dataset definition, containing a connection reference.
    :return: Registered dataset URI.
    """
    import mlrun
    import mlrun.artifacts
    import mlrun.datastore.datastore_profile

    profile = mlrun.datastore.datastore_profile.datastore_profile_read(
        url=f"ds://sql-connection-{definition['connection']}",
        project_name=context.project,
    )
    connection = profile.attributes()
    engine = create_query_engine(
        connection=connection, timeout_seconds=definition.get("timeout_seconds", 300)
    )
    snapshot_id = uuid.uuid4().hex
    try:
        with tempfile.TemporaryDirectory(prefix="mlrun-sql-import-") as temporary:
            path = pathlib.Path(temporary) / "data.parquet"
            result = write_snapshot(
                engine=engine,
                query=definition["query"],
                parameters=definition.get("parameters", {}),
                path=path,
                max_rows=definition.get("max_rows", 1_000_000),
                timeout_seconds=definition.get("timeout_seconds", 300),
            )
            target = (
                f"{context.artifact_path.rstrip('/')}/sql-datasets/"
                f"{definition['name']}/{snapshot_id}/data.parquet"
            )
            artifact = mlrun.artifacts.DatasetArtifact(
                key=definition["name"],
                df=result["preview"],
                format="parquet",
                stats=False,
            )
            artifact.spec.length = result["rows"]
            artifact.spec.schema = result["schema"]
            artifact.metadata.description = definition.get("description", "")
            artifact.spec.annotations = {
                "sql_dataset": {
                    "connection": definition["connection"],
                    "query_sha256": hashlib.sha256(
                        definition["query"].encode()
                    ).hexdigest(),
                    "snapshot_id": snapshot_id,
                    "extracted_at": datetime.now(UTC).isoformat(),
                    "refresh_mode": "full",
                }
            }
            # local_path takes precedence over the preview DataFrame on upload.
            artifact = context.log_artifact(
                artifact,
                local_path=str(path),
                target_path=target,
                tag="latest",
                db_key=definition["name"],
                upload=True,
                labels={"sql-dataset": definition["name"]},
            )
            context.log_result("rows", result["rows"])
            context.log_result("dataset_uri", artifact.uri)
            return artifact.uri
    finally:
        engine.dispose()


@contextlib.contextmanager
def _query_result(engine, query, parameters, timeout_seconds):
    if not 1 <= timeout_seconds <= 3600:
        raise ValueError("Query timeout must be between 1 and 3600 seconds")
    started = time.monotonic()
    try:
        with engine.connect() as connection:
            dialect = engine.dialect.name
            if dialect == "postgresql":
                connection.exec_driver_sql("SET TRANSACTION READ ONLY")
                connection.execute(
                    sqlalchemy.text(
                        "SELECT set_config('statement_timeout', :timeout, true)"
                    ),
                    {"timeout": str(timeout_seconds * 1000)},
                )
            elif dialect == "mysql":
                connection.exec_driver_sql(
                    f"SET SESSION MAX_EXECUTION_TIME = {int(timeout_seconds * 1000)}"
                )
                connection.exec_driver_sql("START TRANSACTION READ ONLY")
            elif dialect == "sqlite":
                connection.exec_driver_sql("PRAGMA query_only = ON")
            else:
                raise ValueError("Unsupported database dialect")
            with connection.execution_options(stream_results=True).execute(
                sqlalchemy.text(query), parameters
            ) as result:
                yield result
                if time.monotonic() - started >= timeout_seconds:
                    raise ValueError("Database query timed out")
    except sqlalchemy.exc.SQLAlchemyError:
        raise ValueError(
            "Database query failed. Check the connection, read permissions, SQL parameters and timeout."
        ) from None


def _result_columns(result):
    columns = list(result.keys())
    if (
        not columns
        or len(columns) != len(set(columns))
        or any(re.search(r":\d+$", column) for column in columns)
    ):
        raise ValueError("Query must return unique column names; use SQL aliases")
    return columns
