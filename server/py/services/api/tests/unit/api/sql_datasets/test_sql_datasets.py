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

import json
import threading
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import AsyncMock, Mock

import fastapi
import pytest
import sqlalchemy
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

import mlrun
import mlrun.common.schemas
import mlrun.datastore.datastore_profile
import mlrun.errors

import framework.db.sqldb.db
import framework.db.sqldb.models


@pytest.fixture
def api(monkeypatch, tmp_path):
    import services.api.api.endpoints.sql_datasets as endpoint
    import services.api.crud.sql_datasets as crud

    engine = sqlalchemy.create_engine(f"sqlite:///{tmp_path / 'profiles.db'}")
    framework.db.sqldb.models.DatastoreProfile.__table__.create(engine)
    private = {}
    db = Mock(wraps=framework.db.sqldb.db.SQLDB(dsn="sqlite:///"))
    db.read_artifact.return_value = None
    db.list_runs.return_value = []
    secrets = Mock()
    secrets.store_project_secrets.side_effect = lambda project, secrets, **kwargs: (
        private.update(secrets.secrets)
    )
    secrets.get_project_secret.side_effect = lambda **kwargs: private[
        kwargs["secret_key"]
    ]
    monkeypatch.setattr(crud.framework.utils.singletons.db, "get_db", lambda: db)
    monkeypatch.setattr(crud.services.api.crud, "Secrets", lambda: secrets)
    verifier = Mock()
    verifier.query_project_permissions = AsyncMock()
    verifier.query_project_resource_permissions = AsyncMock()
    verifier.filter_project_resources_by_permissions = AsyncMock(
        side_effect=lambda resource_type, resources, *args, **kwargs: resources
    )
    monkeypatch.setattr(
        endpoint.framework.utils.auth.verifier, "AuthVerifier", lambda: verifier
    )
    submit = AsyncMock(
        return_value={
            "data": {
                "metadata": {"uid": "run-1", "project": "demo"},
                "status": {"state": "running"},
            }
        }
    )
    monkeypatch.setattr(endpoint.framework.api.utils, "submit_run", submit)
    monkeypatch.setitem(
        mlrun.mlconf._cfg, "sql_dataset", {"job_image": "platform/sql-worker:fixed"}
    )
    app = fastapi.FastAPI()
    app.include_router(endpoint.router)
    app.dependency_overrides[endpoint.framework.api.deps.authenticate_request] = (
        lambda: mlrun.common.schemas.AuthInfo()
    )

    def session_dependency():
        with Session(bind=engine) as session:
            yield session

    app.dependency_overrides[endpoint.framework.api.deps.get_db_session] = (
        session_dependency
    )
    yield TestClient(app), db, secrets, verifier, submit, engine, endpoint, crud
    engine.dispose()


def connection():
    return {
        "name": "warehouse",
        "dialect": "postgresql",
        "host": "database",
        "port": 5432,
        "database": "analytics",
        "username": "reader",
        "password": "top-secret",
    }


def definition():
    return {
        "name": "customers",
        "connection": "warehouse",
        "query": "SELECT id FROM customers WHERE id > :minimum",
        "parameters": {"minimum": 10},
        "description": "Customer snapshot",
        "timeout_seconds": 300,
        "max_rows": 1000000,
    }


def test_connection_redacted_and_duplicate_rejected(api):
    client, db, secrets, _, _, engine, *_ = api
    result = client.post("/projects/demo/sql-connections", json=connection())
    assert result.status_code == 201, result.text
    assert "password" not in result.json()
    with Session(bind=engine) as session:
        profile = db.get_datastore_profile(
            session=session, project="demo", profile="sql-connection-warehouse"
        )
        decoded = (
            mlrun.datastore.datastore_profile.DatastoreProfile2Json.create_from_json(
                profile.object
            )
        )
        assert "password" not in decoded.public
        assert not decoded.private
    assert secrets.store_project_secrets.call_count == 1
    again = client.post("/projects/demo/sql-connections", json=connection())
    assert again.status_code == 409
    assert secrets.store_project_secrets.call_count == 1
    listing = client.get("/projects/demo/sql-datasets")
    assert listing.json()["connections"] == [
        {k: v for k, v in connection().items() if k != "password"}
    ]
    assert "top-secret" not in listing.text


def test_denied_preview_does_not_resolve_secret_or_query(api, monkeypatch):
    client, _, secrets, verifier, _, _, _, crud = api
    client.post("/projects/demo/sql-connections", json=connection())
    engine = Mock()
    monkeypatch.setattr(crud.mlrun.datastore.sql_dataset, "create_query_engine", engine)
    verifier.query_project_resource_permissions.side_effect = fastapi.HTTPException(
        403, "denied"
    )
    result = client.post(
        "/projects/demo/sql-datasets/preview",
        json={"connection": "warehouse", "query": "SELECT 1"},
    )
    assert result.status_code == 403
    secrets.get_project_secret.assert_not_called()
    engine.assert_not_called()


def test_register_refresh_immutable_definition_and_safe_job(api):
    client, _, secrets, verifier, submit, *_ = api
    assert (
        client.post("/projects/demo/sql-connections", json=connection()).status_code
        == 201
    )
    created = client.post("/projects/demo/sql-datasets", json=definition())
    assert created.status_code == 202, created.text
    assert created.json()["run"]["metadata"]["uid"] == "run-1"
    payload = submit.call_args.kwargs["data"]
    assert payload["task"]["spec"]["parameters"]["definition"] == definition()
    assert payload["function"]["spec"]["image"] == "platform/sql-worker:fixed"
    assert "top-secret" not in json.dumps(payload)
    secrets.get_project_secret.assert_not_called()
    assert (
        client.post(
            "/projects/demo/sql-datasets", json={**definition(), "query": "SELECT 2"}
        ).status_code
        == 409
    )
    refreshed = client.post("/projects/demo/sql-datasets/customers/refresh")
    assert refreshed.status_code == 202, refreshed.text
    assert (
        submit.call_args.kwargs["data"]["task"]["spec"]["parameters"]["definition"]
        == definition()
    )
    permissions = [
        call.kwargs["resource_type"]
        for call in verifier.query_project_resource_permissions.call_args_list
    ]
    for resource in ["artifact", "run", "function", "secret", "datastore-profile"]:
        assert resource in permissions


def test_existing_artifact_name_conflicts(api):
    client, db, _, _, submit, *_ = api
    client.post("/projects/demo/sql-connections", json=connection())
    db.read_artifact.return_value = {"metadata": {"key": "customers"}}
    result = client.post("/projects/demo/sql-datasets", json=definition())
    assert result.status_code == 409
    submit.assert_not_called()


def test_unconfigured_image_does_not_save_definition(api, monkeypatch):
    client, _, _, _, submit, _, *_ = api
    client.post("/projects/demo/sql-connections", json=connection())
    monkeypatch.setitem(mlrun.mlconf._cfg, "sql_dataset", {"job_image": ""})
    result = client.post("/projects/demo/sql-datasets", json=definition())
    assert result.status_code == 503
    assert not client.get("/projects/demo/sql-datasets").json()["datasets"]
    submit.assert_not_called()


@pytest.mark.parametrize(
    "body",
    [
        {"connection": "warehouse", "query": "DELETE FROM customers"},
        {"connection": "warehouse", "query": "SELECT 1", "timeout_seconds": 31},
        {"connection": "../warehouse", "query": "SELECT 1"},
        {"connection": "warehouse", "query": "SELECT 1", "parameters": {"ids": [1, 2]}},
    ],
)
def test_invalid_preview_never_opens_connection(api, monkeypatch, body):
    client, _, secrets, _, _, _, _, crud = api
    engine = Mock()
    monkeypatch.setattr(crud.mlrun.datastore.sql_dataset, "create_query_engine", engine)
    assert client.post(
        "/projects/demo/sql-datasets/preview", json=body
    ).status_code in (400, 422)
    secrets.get_project_secret.assert_not_called()
    engine.assert_not_called()


def test_listing_restores_authorized_latest_run(api):
    client, db, _, _, _, _, _, _ = api
    client.post("/projects/demo/sql-connections", json=connection())
    client.post("/projects/demo/sql-datasets", json=definition())
    db.list_runs.return_value = [
        {
            "metadata": {
                "uid": "run-2",
                "project": "demo",
                "name": "sql-dataset-customers",
            },
            "spec": {"parameters": {"sensitive": "must-not-return"}},
            "status": {
                "state": "completed",
                "results": {
                    "rows": 12,
                    "dataset_uri": "store://datasets/demo/customers:latest",
                },
            },
        }
    ]
    result = client.get("/projects/demo/sql-datasets")
    assert result.status_code == 200, result.text
    assert result.json()["datasets"][0]["latest_run"]["metadata"]["uid"] == "run-2"
    assert "must-not-return" not in result.text


def test_preview_uses_secret_and_real_bound_sql(api, monkeypatch):
    import sqlalchemy

    client, _, _, _, _, _, _, crud = api
    client.post("/projects/demo/sql-connections", json=connection())
    monkeypatch.setattr(
        crud.mlrun.datastore.sql_dataset,
        "create_query_engine",
        lambda connection, **kwargs: sqlalchemy.create_engine("sqlite://"),
    )
    result = client.post(
        "/projects/demo/sql-datasets/preview",
        json={
            "connection": "warehouse",
            "query": "SELECT :value AS value",
            "parameters": {"value": "a' OR 1=1"},
        },
    )
    assert result.status_code == 200, result.text
    assert result.json() == {
        "columns": ["value"],
        "rows": [{"value": "a' OR 1=1"}],
        "truncated": False,
    }


def test_database_error_is_redacted(api, monkeypatch):
    client, _, _, _, _, _, _, crud = api
    monkeypatch.setattr(
        crud.mlrun.datastore.sql_dataset,
        "create_query_engine",
        Mock(side_effect=RuntimeError("driver leaked top-secret")),
    )
    result = client.post("/projects/demo/sql-connections/test", json=connection())
    assert result.status_code == 400
    assert "top-secret" not in result.text


@pytest.mark.parametrize("resource", ["artifact", "run", "function", "secret"])
def test_import_denied_before_persistence(api, resource):
    client, db, _, verifier, submit, _, *_ = api
    client.post("/projects/demo/sql-connections", json=connection())

    async def deny(**kwargs):
        if kwargs["resource_type"] == resource:
            raise fastapi.HTTPException(403, "denied")
        return True

    verifier.query_project_resource_permissions.side_effect = deny
    assert (
        client.post("/projects/demo/sql-datasets", json=definition()).status_code == 403
    )
    assert not client.get("/projects/demo/sql-datasets").json()["datasets"]
    submit.assert_not_called()
    db.read_artifact.assert_not_called()


def test_listing_does_not_query_runs_without_run_access(api):
    client, db, _, verifier, _, _, _, _ = api
    client.post("/projects/demo/sql-connections", json=connection())
    client.post("/projects/demo/sql-datasets", json=definition())
    verifier.query_project_resource_permissions.return_value = False
    result = client.get("/projects/demo/sql-datasets")
    assert result.status_code == 200
    assert result.json()["datasets"][0]["latest_run"] is None
    db.list_runs.assert_not_called()


def test_listing_filters_individually_denied_latest_run(api):
    client, db, _, verifier, _, _, _, _ = api
    client.post("/projects/demo/sql-connections", json=connection())
    client.post("/projects/demo/sql-datasets", json=definition())
    db.list_runs.return_value = [
        {"metadata": {"uid": "denied"}, "status": {"state": "running"}}
    ]

    async def filtered(resource_type, resources, *args, **kwargs):
        return [] if resource_type == "run" else resources

    verifier.filter_project_resources_by_permissions.side_effect = filtered
    result = client.get("/projects/demo/sql-datasets")
    assert result.json()["datasets"][0]["latest_run"] is None
    assert "denied" not in result.text


@pytest.mark.parametrize("kind", ["connection", "definition"])
def test_concurrent_creation_is_atomic_and_preserves_winner(api, kind):
    _, db, secrets, _, _, engine, _, crud = api
    missing_reads = threading.Barrier(2)
    start = threading.Barrier(2)
    real_db = framework.db.sqldb.db.SQLDB(dsn="sqlite:///")

    def concurrent_missing_read(session, profile, project):
        try:
            return real_db.get_datastore_profile(
                session=session, profile=profile, project=project
            )
        except mlrun.errors.MLRunNotFoundError:
            # Reproduce two API workers observing absence before the old upsert.
            session.rollback()
            missing_reads.wait(timeout=10)
            raise

    db.get_datastore_profile.side_effect = concurrent_missing_read

    def create(candidate):
        start.wait(timeout=10)
        with Session(bind=engine) as session:
            try:
                if kind == "connection":
                    crud.create_connection(
                        session=session,
                        project="demo",
                        connection={**connection(), "password": candidate},
                    )
                else:
                    crud.create_definition(
                        session=session,
                        project="demo",
                        definition={**definition(), "description": candidate},
                    )
                return candidate, 201
            except fastapi.HTTPException as exc:
                return candidate, exc.status_code

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(create, ["first", "second"]))
    assert sorted(status for _, status in results) == [201, 409]
    winner = next(candidate for candidate, status in results if status == 201)
    with Session(bind=engine) as session:
        records = session.query(framework.db.sqldb.models.DatastoreProfile).all()
        assert len(records) == 1
        stored = (
            mlrun.datastore.datastore_profile.DatastoreProfile2Json.create_from_json(
                records[0].full_object
            )
        )
        if kind == "definition":
            assert stored.public["description"] == winner
            secrets.store_project_secrets.assert_not_called()
        else:
            assert secrets.store_project_secrets.call_count == 1
            secret_data = secrets.store_project_secrets.call_args.kwargs["secrets"]
            private_json = next(iter(secret_data.secrets.values()))
            stored = mlrun.datastore.datastore_profile.DatastoreProfile2Json.create_from_json(
                public_json=records[0].full_object, private_json=private_json
            )
            assert stored.private["password"] == winner


def test_secret_failure_rolls_back_reserved_profile(api):
    _, _, secrets, _, _, engine, _, crud = api
    with Session(bind=engine) as session:

        def fail_secret(**kwargs):
            # The unique database row must already be reserved before any Secret write.
            assert (
                session.query(framework.db.sqldb.models.DatastoreProfile).count() == 1
            )
            raise RuntimeError("Secret storage unavailable")

        secrets.store_project_secrets.side_effect = fail_secret
        with pytest.raises(RuntimeError, match="Secret storage unavailable"):
            crud.create_connection(
                session=session, project="demo", connection=connection()
            )
        assert not session.in_transaction()
    with Session(bind=engine) as observer:
        assert observer.query(framework.db.sqldb.models.DatastoreProfile).count() == 0
        secrets.store_project_secrets.side_effect = None
        crud.create_connection(
            session=observer, project="demo", connection=connection()
        )
        assert observer.query(framework.db.sqldb.models.DatastoreProfile).count() == 1


def test_import_worker_disables_api_server_mode(api, monkeypatch):
    _, _, _, _, _, _, _, crud = api
    payload = crud.job_payload(
        project="demo", definition=definition(), image="platform/sql-worker:fixed"
    )
    environment = {
        item["name"]: item["value"]
        for item in payload["function"]["spec"].get("env", [])
    }
    assert environment["MLRUN_IS_API_SERVER"] == "false"
    monkeypatch.setenv("MLRUN_IS_API_SERVER", environment["MLRUN_IS_API_SERVER"])
    monkeypatch.setattr(mlrun.config, "_is_running_as_api", None)
    assert not mlrun.config.is_running_as_api()
