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

import pandas as pd
import pytest
import sqlalchemy

from mlrun.datastore import sql_dataset


@pytest.fixture
def engine(tmp_path):
    engine = sqlalchemy.create_engine(f"sqlite:///{tmp_path / 'source.db'}")
    with engine.begin() as connection:
        connection.execute(sqlalchemy.text("CREATE TABLE samples (id INT, amount INT)"))
        connection.execute(
            sqlalchemy.text("INSERT INTO samples VALUES (1, 10), (2, 20), (3, 30)")
        )
    yield engine
    engine.dispose()


@pytest.mark.parametrize(
    "query",
    [
        "DELETE FROM samples",
        "SELECT * FROM samples; DELETE FROM samples",
        "WITH x AS (DELETE FROM samples RETURNING *) SELECT * FROM x",
        "SELECT * INTO backup FROM samples",
        "SELECT * FROM samples INTO OUTFILE '/tmp/export'",
        "SELECT * FROM samples FOR UPDATE",
        "/*!50000 DELETE FROM samples */ SELECT 1",
        "SELECT /*+ MAX_EXECUTION_TIME(9999999) */ 1",
    ],
)
def test_rejects_mutating_and_multi_statement_queries(query):
    with pytest.raises(ValueError):
        sql_dataset.validate_query(query)


def test_parameters_are_bound_and_preview_is_limited(engine):
    result = sql_dataset.preview_query(
        engine=engine,
        query="SELECT id, amount FROM samples WHERE amount > :minimum ORDER BY id",
        parameters={"minimum": 5},
        limit=2,
    )
    assert result == {
        "columns": ["id", "amount"],
        "rows": [{"id": 1, "amount": 10}, {"id": 2, "amount": 20}],
        "truncated": True,
    }
    result = sql_dataset.preview_query(
        engine=engine,
        query="SELECT id FROM samples WHERE id = :id",
        parameters={"id": "1 OR 1=1"},
    )
    assert result["rows"] == []


def test_chunked_snapshot_preserves_all_rows_and_schema(engine, tmp_path):
    output = tmp_path / "snapshot.parquet"
    result = sql_dataset.write_snapshot(
        engine=engine,
        query="SELECT id, amount FROM samples ORDER BY id",
        parameters={},
        path=output,
        chunksize=2,
    )
    assert result["rows"] == 3
    assert pd.read_parquet(output).to_dict("records") == [
        {"id": 1, "amount": 10},
        {"id": 2, "amount": 20},
        {"id": 3, "amount": 30},
    ]


def test_failed_refresh_keeps_prior_snapshot(engine, tmp_path):
    old = tmp_path / "old.parquet"
    new = tmp_path / "new.parquet"
    old.write_bytes(b"existing snapshot")
    with pytest.raises(ValueError, match="row limit"):
        sql_dataset.write_snapshot(
            engine=engine,
            query="SELECT * FROM samples",
            parameters={},
            path=new,
            max_rows=2,
            chunksize=2,
        )
    assert old.read_bytes() == b"existing snapshot"
    assert not new.exists()


def test_empty_result_is_not_published(engine, tmp_path):
    output = tmp_path / "empty.parquet"
    with pytest.raises(ValueError, match="no rows"):
        sql_dataset.write_snapshot(
            engine=engine,
            query="SELECT * FROM samples WHERE id < 0",
            parameters={},
            path=output,
        )
    assert not output.exists()


def test_query_failure_does_not_expose_sql_or_bound_values(engine):
    with pytest.raises(ValueError) as error:
        sql_dataset.preview_query(
            engine=engine,
            query="SELECT secret_column FROM missing_table WHERE id=:password",
            parameters={"password": "private-value"},
        )
    assert "private-value" not in str(error.value)
    assert "secret_column" not in str(error.value)
    assert "missing_table" not in str(error.value)


def test_accepts_cte_comments_and_quoted_keywords(engine):
    result = sql_dataset.preview_query(
        engine=engine,
        query="/* comment */ WITH x AS (SELECT id FROM samples) SELECT id, 'delete; update' AS note FROM x;",
        parameters={},
    )
    assert len(result["rows"]) == 3


def test_rejects_duplicate_columns(engine, tmp_path):
    with pytest.raises(ValueError, match="unique"):
        sql_dataset.write_snapshot(
            engine=engine,
            query="SELECT id, id FROM samples",
            parameters={},
            path=tmp_path / "duplicate.parquet",
        )


def test_later_non_null_values_survive_chunk_schema_inference(engine, tmp_path):
    output = tmp_path / "nullable.parquet"
    sql_dataset.write_snapshot(
        engine=engine,
        query="SELECT id, CASE WHEN id > 2 THEN amount ELSE NULL END AS optional FROM samples ORDER BY id",
        parameters={},
        path=output,
        chunksize=2,
    )
    frame = pd.read_parquet(output)
    assert frame["optional"].isna().tolist() == [True, True, False]
    assert frame.iloc[2]["optional"] == 30


def test_preview_rejects_oversized_results(engine):
    with pytest.raises(ValueError, match="preview size"):
        sql_dataset.preview_query(
            engine=engine,
            query="SELECT :large AS value",
            parameters={"large": "x" * 2_100_000},
        )


def test_nullable_bigint_is_not_rounded_in_snapshot(engine, tmp_path):
    import pyarrow.parquet as pq

    output = tmp_path / "bigint.parquet"
    sql_dataset.write_snapshot(
        engine=engine,
        query="SELECT 9007199254740993 AS id UNION ALL SELECT NULL AS id",
        parameters={},
        path=output,
    )
    assert pq.read_table(output).to_pylist() == [{"id": 9007199254740993}, {"id": None}]
    assert int(pd.read_parquet(output)["id"].iloc[0]) == 9007199254740993
    assert str(pd.read_parquet(output)["id"].dtype) == "Int64"


def test_nullable_bigint_is_not_rounded_in_preview(engine):
    result = sql_dataset.preview_query(
        engine=engine,
        query="SELECT 9007199254740993 AS id UNION ALL SELECT NULL AS id",
        parameters={},
    )
    assert result["rows"] == [{"id": 9007199254740993}, {"id": None}]


def test_snapshot_metadata_is_bounded_and_uses_final_schema(engine, tmp_path):
    result = sql_dataset.write_snapshot(
        engine=engine,
        query="SELECT NULL AS optional, :large AS value UNION ALL SELECT 30, :large",
        parameters={"large": "x" * 3_000_000},
        path=tmp_path / "large.parquet",
        chunksize=1,
    )
    assert result["rows"] == 2
    assert len(result["preview"].to_json().encode()) < 65_536
    fields = {field["name"]: field for field in result["schema"]["fields"]}
    assert fields["optional"]["type"] == "integer"


def test_binary_columns_do_not_fail_metadata_serialization(engine, tmp_path):
    import pyarrow.parquet as pq

    output = tmp_path / "binary.parquet"
    sql_dataset.write_snapshot(
        engine=engine, query="SELECT X'FF00' AS blob", parameters={}, path=output
    )
    assert pq.read_table(output).to_pylist() == [{"blob": b"\xff\x00"}]
    assert sql_dataset.preview_query(
        engine=engine, query="SELECT X'FF00' AS blob", parameters={}
    )["rows"] == [{"blob": str(b"\xff\x00")}]


def test_handler_publishes_complete_file_and_description(engine, tmp_path, monkeypatch):
    from types import SimpleNamespace

    import pyarrow.parquet as pq

    import mlrun.datastore.datastore_profile

    monkeypatch.setattr(
        mlrun.datastore.datastore_profile,
        "datastore_profile_read",
        lambda **kwargs: SimpleNamespace(attributes=dict),
    )
    monkeypatch.setattr(sql_dataset, "create_query_engine", lambda **kwargs: engine)
    published = {}

    def log_artifact(artifact, **kwargs):
        assert pq.read_table(kwargs["local_path"]).num_rows == 27
        assert len(artifact.status.preview) == 20
        published.update(artifact.to_dict())
        return SimpleNamespace(uri="store://datasets/demo/samples#fixed-uid")

    context = SimpleNamespace(
        project="demo",
        artifact_path=str(tmp_path),
        log_artifact=log_artifact,
        log_result=lambda *args: None,
    )
    uri = sql_dataset.import_sql_dataset(
        context=context,
        definition={
            "name": "samples",
            "connection": "example",
            "query": "SELECT a.id FROM samples a CROSS JOIN samples b CROSS JOIN samples c",
            "description": "Snapshot description",
        },
    )
    assert uri.endswith("#fixed-uid")
    assert published["metadata"]["description"] == "Snapshot description"
    assert published["spec"]["length"] == 27
