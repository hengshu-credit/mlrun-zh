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

"""Opt-in tests against disposable databases, never platform metadata databases."""

import os

import pandas as pd
import pytest

import mlrun.datastore.sql_dataset

pytestmark = pytest.mark.skipif(
    not os.environ.get("MLRUN_SQL_DATASET_TEST_PASSWORD"),
    reason="Requires isolated MySQL/PostgreSQL test databases",
)


@pytest.fixture(params=["postgresql", "mysql"])
def sql_engine(request):
    dialect = request.param
    engine = mlrun.datastore.sql_dataset.create_query_engine(
        connection={
            "dialect": dialect,
            "host": os.environ[f"MLRUN_SQL_DATASET_TEST_{dialect.upper()}_HOST"],
            "port": 5432 if dialect == "postgresql" else 3306,
            "database": "postgres" if dialect == "postgresql" else "sql_fixture",
            "username": "postgres" if dialect == "postgresql" else "root",
            "password": os.environ["MLRUN_SQL_DATASET_TEST_PASSWORD"],
        },
        timeout_seconds=5,
    )
    yield engine
    engine.dispose()


def test_real_database_query_preview_and_snapshot(sql_engine, tmp_path):
    query = "SELECT :value AS amount UNION ALL SELECT 20 AS amount"
    preview = mlrun.datastore.sql_dataset.preview_query(
        engine=sql_engine, query=query, parameters={"value": 10}
    )
    assert preview["rows"] == [{"amount": 10}, {"amount": 20}]
    output = tmp_path / "snapshot.parquet"
    result = mlrun.datastore.sql_dataset.write_snapshot(
        engine=sql_engine,
        query=query,
        parameters={"value": 10},
        path=output,
        chunksize=1,
    )
    assert result["rows"] == 2
    assert sorted(pd.read_parquet(output)["amount"].tolist()) == [10, 20]


def test_database_enforces_query_timeout(sql_engine):
    query = (
        "SELECT pg_sleep(3)"
        if sql_engine.dialect.name == "postgresql"
        else "SELECT SLEEP(3)"
    )
    with pytest.raises(ValueError, match="Database query failed|timed out"):
        mlrun.datastore.sql_dataset.preview_query(
            engine=sql_engine, query=query, parameters={}, timeout_seconds=1
        )
