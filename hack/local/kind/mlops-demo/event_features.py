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
"""Persistent event ledger and exact point-in-time user/order aggregations."""

import json
import math
import numbers
import os
import threading
from datetime import UTC, datetime, timedelta
from pathlib import Path

import psycopg
from psycopg import sql

_runtime_lock = threading.RLock()
_runtime_store = None
_snapshot_writer = None


class EventStore:
    """Store immutable events and calculate configured features in PostgreSQL."""

    def __init__(self, config: dict, temporary: bool = False) -> None:
        self.config = config
        self.temporary = temporary
        self.schema = "pg_temp" if temporary else config["database_schema"]
        self.table = sql.Identifier(self.schema, "events")
        self.connection = psycopg.connect(
            host=config["database_host"],
            port=config["database_port"],
            dbname=config["database_name"],
            user=config["database_user"],
            password=os.environ["POSTGRES_PASSWORD"],
            autocommit=True,
            connect_timeout=10,
            options="-c statement_timeout=30000",
        )

    def initialize(self) -> None:
        """Create additive demo tables and indexes; retain existing records."""
        if not self.temporary:
            self.connection.execute(
                sql.SQL("CREATE SCHEMA IF NOT EXISTS {}").format(
                    sql.Identifier(self.schema)
                )
            )
        prefix = "CREATE TEMP TABLE" if self.temporary else "CREATE TABLE IF NOT EXISTS"
        self.connection.execute(
            sql.SQL(
                prefix + " {} (event_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, "
                "order_id TEXT NOT NULL, event_type TEXT NOT NULL, amount DOUBLE PRECISION NOT NULL, "
                "event_time TIMESTAMPTZ NOT NULL, received_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp())"
            ).format(self.table)
        )
        for entity in ["user_id", "order_id"]:
            self.connection.execute(
                sql.SQL(
                    "CREATE INDEX IF NOT EXISTS {} ON {} ({}, event_time, received_at)"
                ).format(
                    sql.Identifier("events_" + entity + "_time"),
                    self.table,
                    sql.Identifier(entity),
                )
            )

    def close(self) -> None:
        """Close the database connection."""
        self.connection.close()

    def append(self, events: list[dict], received_at: datetime | None = None) -> int:
        """Atomically append events, ignoring identical retries.

        :param events: Raw log/detail events; each event_id must be stable and unique.
        :param received_at: Internal fixture import only; HTTP never accepts this value.
        :return: Number of newly stored events.
        """
        if not isinstance(events, list) or not 1 <= len(events) <= 1000:
            raise ValueError("events must contain between 1 and 1000 records")
        records = [normalize_event(event) for event in events]
        inserted = 0
        with self.connection.transaction():
            for record in records:
                values = tuple(
                    record[name]
                    for name in (
                        "event_id",
                        "user_id",
                        "order_id",
                        "event_type",
                        "amount",
                        "event_time",
                    )
                )
                result = self.connection.execute(
                    sql.SQL(
                        "INSERT INTO {} (event_id,user_id,order_id,event_type,amount,event_time,received_at) "
                        "VALUES (%s,%s,%s,%s,%s,%s,COALESCE(%s,clock_timestamp())) "
                        "ON CONFLICT (event_id) DO NOTHING RETURNING event_id"
                    ).format(self.table),
                    values + (received_at,),
                ).fetchone()
                if result:
                    inserted += 1
                else:
                    old = self.connection.execute(
                        sql.SQL(
                            "SELECT event_id,user_id,order_id,event_type,amount,event_time "
                            "FROM {} WHERE event_id=%s"
                        ).format(self.table),
                        (record["event_id"],),
                    ).fetchone()
                    if old != values:
                        raise ValueError(
                            "event_id already exists with different event contents"
                        )
        return inserted

    def query(
        self,
        user_id: str | None = None,
        order_id: str | None = None,
        as_of: datetime | str | None = None,
        visibility: str | None = None,
    ) -> dict:
        """Calculate exact trailing windows from persisted events.

        :param user_id: User to aggregate, or None for an order-only request.
        :param order_id: Order to aggregate, or None for a user-only request.
        :param as_of: Exclusive event-time cutoff with an explicit timezone; defaults to database time.
        :param visibility: as_known excludes late arrivals; event_time includes subsequently received events.
        :return: Entity identifiers, cutoff, visibility and configured numeric features.
        """
        for key, value in [("user_id", user_id), ("order_id", order_id)]:
            if value is not None and (not isinstance(value, str) or not value.strip()):
                raise ValueError(f"{key} must be a non-empty string")
        if user_id is None and order_id is None:
            raise ValueError("Provide user_id or order_id")
        cutoff = (
            parse_time(as_of)
            if as_of is not None
            else self.connection.execute("SELECT clock_timestamp()").fetchone()[0]
        )
        visibility = visibility or self.config["visibility"]
        if visibility not in ("as_known", "event_time"):
            raise ValueError("visibility must be as_known or event_time")
        entities = {"user_id": user_id, "order_id": order_id}
        expressions = []
        parameters = []
        for feature in self.config["features"]:
            if feature["entity"] not in entities or feature["operation"] not in (
                "count",
                "sum",
                "avg",
                "max",
            ):
                raise ValueError("Unsupported feature entity or operation")
            window = feature["window_seconds"]
            if not isinstance(window, int) or isinstance(window, bool) or window <= 0:
                raise ValueError("window_seconds must be a positive integer")
            aggregate = {
                "count": "COUNT(*)",
                "sum": "SUM(amount)",
                "avg": "AVG(amount)",
                "max": "MAX(amount)",
            }[feature["operation"]]
            expressions.append(
                sql.SQL(
                    "COALESCE("
                    + aggregate
                    + " FILTER (WHERE {}=%s AND event_type=%s AND event_time >= %s),0) AS {}"
                ).format(
                    sql.Identifier(feature["entity"]), sql.Identifier(feature["name"])
                )
            )
            parameters.extend(
                [
                    entities[feature["entity"]],
                    feature["event_type"],
                    cutoff - timedelta(seconds=window),
                ]
            )
        max_window = max(
            feature["window_seconds"] for feature in self.config["features"]
        )
        statement = sql.SQL(
            "SELECT {} FROM {} WHERE (user_id=%s OR order_id=%s) "
            "AND event_time >= %s AND event_time < %s"
        ).format(sql.SQL(", ").join(expressions), self.table)
        parameters.extend(
            [user_id, order_id, cutoff - timedelta(seconds=max_window), cutoff]
        )
        if visibility == "as_known":
            statement += sql.SQL(" AND received_at <= %s")
            parameters.append(cutoff)
        row = self.connection.execute(statement, parameters).fetchone()
        result = {
            "user_id": user_id,
            "order_id": order_id,
            "as_of": cutoff,
            "visibility": visibility,
        }
        result.update(
            {
                feature["name"]: float(value)
                for feature, value in zip(self.config["features"], row)
            }
        )
        return result


def parse_time(value: datetime | str) -> datetime:
    """Parse and normalize an explicitly zoned timestamp to UTC.

    :param value: ISO timestamp or aware datetime.
    :return: UTC datetime.
    """
    try:
        parsed = (
            datetime.fromisoformat(value.replace("Z", "+00:00"))
            if isinstance(value, str)
            else value
        )
    except ValueError as exc:
        raise ValueError("Invalid ISO timestamp") from exc
    if not isinstance(parsed, datetime) or parsed.tzinfo is None:
        raise ValueError("Timestamp must include a timezone")
    return parsed.astimezone(UTC)


def normalize_event(event: dict) -> dict:
    """Validate a raw event, including the server-owned arrival timestamp.

    :param event: JSON event object.
    :return: Validated record.
    """
    if not isinstance(event, dict):
        raise ValueError("Each event must be a JSON object")
    if "received_at" in event:
        raise ValueError("received_at is assigned by the server")
    result = {}
    for key in ["event_id", "user_id", "order_id", "event_type"]:
        value = event.get(key)
        if not isinstance(value, str) or not value.strip() or len(value) > 200:
            raise ValueError(
                f"{key} must be a non-empty string of at most 200 characters"
            )
        result[key] = value
    if result["event_type"] not in (
        "payment",
        "payment_failed",
        "refund",
        "item",
        "visit",
    ):
        raise ValueError("Unsupported event_type")
    amount = event.get("amount", 0)
    if (
        isinstance(amount, bool)
        or not isinstance(amount, numbers.Real)
        or not math.isfinite(amount)
        or amount < 0
    ):
        raise ValueError("amount must be a finite non-negative number")
    result["amount"] = float(amount)
    result["event_time"] = parse_time(event.get("event_time"))
    return result


def process_request(body: dict) -> dict:
    """Handle online ingestion or an offline point-in-time query with the same logic.

    :param body: user_id/order_id with optional events, as_of, visibility and offline label.
    :return: Computed features. Explicit historical queries never update online snapshots.
    """
    global _runtime_store
    if not isinstance(body, dict):
        raise ValueError("Expected a JSON object")
    if body.get("events") is not None and body.get("as_of") is not None:
        raise ValueError("Ingestion cannot specify a historical as_of")
    with _runtime_lock:
        if _runtime_store is None or _runtime_store.connection.closed:
            config = json.loads(Path(os.environ["MLRUN_DEMO_CONFIG"]).read_text())
            _runtime_store = EventStore(config)
        # Validate query before committing any incoming events.
        user_id, order_id = body.get("user_id"), body.get("order_id")
        result = _runtime_store.query(
            user_id=user_id,
            order_id=order_id,
            as_of=body.get("as_of"),
            visibility=body.get("visibility"),
        )
        if "events" in body:
            _runtime_store.append(body["events"])
            result = _runtime_store.query(
                user_id=user_id, order_id=order_id, visibility=body.get("visibility")
            )
        if "label" in body:
            result["label"] = int(body["label"])
        if (
            body.get("as_of") is None
            and result["visibility"] == _runtime_store.config["visibility"]
            and user_id
            and order_id
            and os.environ.get("DEMO_REDIS_TARGET_PATH")
        ):
            _publish_snapshot(result)
        return result


def _publish_snapshot(result: dict) -> None:
    global _snapshot_writer
    import storey

    import mlrun.datastore.targets

    if _snapshot_writer is None:
        target = mlrun.datastore.targets.RedisNoSqlTarget(
            path=os.environ["DEMO_REDIS_TARGET_PATH"]
        )
        source = storey.SyncEmitSource(key_field=["user_id", "order_id"])
        source.to(
            storey.NoSqlTarget(
                table=target.get_table_object(), infer_columns_from_data=True
            )
        ).to(storey.Complete())
        _snapshot_writer = source.run()
    snapshot = dict(result, as_of=result["as_of"].isoformat())
    # Storey reserves *_sum_24h-style names for aggregation state. These are
    # already calculated values, so publish static fields and alias them in MLRun.
    for feature in _runtime_store.config["features"]:
        snapshot[feature["name"] + "_value"] = result[feature["name"]]
    _snapshot_writer.emit(snapshot)
