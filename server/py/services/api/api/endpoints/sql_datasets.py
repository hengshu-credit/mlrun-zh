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

"""Authenticated project SQL connection and immutable dataset snapshot endpoints."""

import json
import math
from typing import Annotated, Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Path
from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator
from sqlalchemy.orm import Session

import mlrun
import mlrun.common.schemas
import mlrun.datastore.sql_dataset
import mlrun.utils

import framework.api.deps
import framework.api.utils
import framework.utils.auth.verifier
import framework.utils.singletons.db
import services.api.crud.sql_datasets

router = APIRouter()
Name = Annotated[
    str, Field(pattern=r"^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$", max_length=50)
]


class SqlConnection(BaseModel):
    """A reusable SQL connection; passwords are stored only in project Secrets."""

    model_config = ConfigDict(extra="forbid")
    name: Name
    dialect: Literal["mysql", "postgresql"]
    host: str = Field(min_length=1, max_length=253, pattern=r"^[a-zA-Z0-9_.:-]+$")
    port: int = Field(ge=1, le=65535)
    database: str = Field(min_length=1, max_length=128)
    username: str = Field(min_length=1, max_length=128)
    password: SecretStr


class SqlPreview(BaseModel):
    """A bounded SELECT preview using scalar bound parameters."""

    model_config = ConfigDict(extra="forbid")
    connection: Name
    query: str = Field(min_length=1, max_length=100_000)
    parameters: dict = Field(default_factory=dict)
    timeout_seconds: int = Field(default=30, ge=1, le=30)

    @field_validator("query")
    @classmethod
    def validate_query(cls, value: str) -> str:
        """Check read-query syntax without connecting to the database.

        :param value: Submitted query.
        :return: Original validated query.
        """
        mlrun.datastore.sql_dataset.validate_query(value)
        return value

    @field_validator("parameters")
    @classmethod
    def validate_parameters(cls, value: dict) -> dict:
        """Accept only bounded JSON scalar parameters.

        :param value: Bind parameters.
        :return: Validated parameters.
        """
        if len(value) > 100 or len(json.dumps(value, default=str).encode()) > 65_536:
            raise ValueError("SQL parameters exceed the size limit")
        for key, item in value.items():
            if not isinstance(key, str) or not key.isidentifier() or len(key) > 128:
                raise ValueError(
                    "SQL parameter names must be identifiers of at most 128 characters"
                )
            if item is not None and type(item) not in (str, int, float, bool):
                raise ValueError("SQL parameters must be JSON scalar values")
            if isinstance(item, float) and not math.isfinite(item):
                raise ValueError("SQL numeric parameters must be finite")
        return value


class SqlDataset(SqlPreview):
    """An immutable query definition; refresh reuses these exact fields."""

    name: Name
    description: str = Field(default="", max_length=4096)
    timeout_seconds: int = Field(default=300, ge=1, le=3600)
    max_rows: int = Field(default=1_000_000, ge=1, le=10_000_000)


@router.get("/projects/{project}/sql-datasets")
async def list_sql_datasets(
    project: str,
    db_session: Annotated[Session, Depends(framework.api.deps.get_db_session)],
    auth_info: Annotated[
        mlrun.common.schemas.AuthInfo, Depends(framework.api.deps.authenticate_request)
    ],
) -> dict:
    """List authorized public connections and saved definitions.

    :param project: Owning project.
    :param db_session: Database session.
    :param auth_info: Authenticated caller.
    :return: Public connections and definitions.
    """
    verifier = framework.utils.auth.verifier.AuthVerifier()
    await verifier.query_project_permissions(
        project_name=project,
        action=mlrun.common.schemas.AuthorizationAction.read,
        auth_info=auth_info,
    )
    profiles = await mlrun.utils.run_in_threadpool(
        framework.utils.singletons.db.get_db().list_datastore_profiles,
        session=db_session,
        project=project,
    )
    profiles = await verifier.filter_project_resources_by_permissions(
        mlrun.common.schemas.AuthorizationResourceTypes.datastore_profile,
        profiles,
        lambda profile: (project, profile.name),
        auth_info,
    )
    result = {"connections": [], "datasets": []}
    for profile in profiles:
        if profile.type != "config":
            continue
        public = services.api.crud.sql_datasets.public_profile(profile=profile)
        purpose = public.pop("purpose", None)
        if purpose == "sql-connection" and profile.name.startswith(
            services.api.crud.sql_datasets.CONNECTION_PREFIX
        ):
            result["connections"].append(public)
        elif purpose == "sql-dataset" and profile.name.startswith(
            services.api.crud.sql_datasets.DATASET_PREFIX
        ):
            public["latest_run"] = await _latest_run(
                project=project,
                name=public["name"],
                db_session=db_session,
                auth_info=auth_info,
            )
            result["datasets"].append(public)
    return result


@router.post("/projects/{project}/sql-connections", status_code=201)
async def create_sql_connection(
    project: str,
    body: SqlConnection,
    db_session: Annotated[Session, Depends(framework.api.deps.get_db_session)],
    auth_info: Annotated[
        mlrun.common.schemas.AuthInfo, Depends(framework.api.deps.authenticate_request)
    ],
) -> dict:
    """Create a connection and protect its password with the project Secret provider.

    :param project: Owning project.
    :param body: Validated connection.
    :param db_session: Database session.
    :param auth_info: Authenticated caller.
    :return: Public connection fields.
    """
    await _authorize(
        project,
        auth_info,
        "datastore_profile",
        "store",
        services.api.crud.sql_datasets.CONNECTION_PREFIX + body.name,
    )
    await _authorize(project, auth_info, "secret", "store", "kubernetes")
    connection = body.model_dump(exclude={"password"})
    connection["password"] = body.password.get_secret_value()
    return await mlrun.utils.run_in_threadpool(
        services.api.crud.sql_datasets.create_connection,
        session=db_session,
        project=project,
        connection=connection,
    )


@router.post("/projects/{project}/sql-connections/test")
async def test_sql_connection(
    project: str,
    body: SqlConnection,
    auth_info: Annotated[
        mlrun.common.schemas.AuthInfo, Depends(framework.api.deps.authenticate_request)
    ],
) -> dict:
    """Test supplied credentials with a bounded SELECT.

    :param project: Owning project.
    :param body: Connection to test.
    :param auth_info: Authenticated caller.
    :return: Success marker.
    """
    await _authorize(
        project,
        auth_info,
        "datastore_profile",
        "store",
        services.api.crud.sql_datasets.CONNECTION_PREFIX + body.name,
    )
    await _authorize(project, auth_info, "secret", "store", "kubernetes")
    connection = body.model_dump(exclude={"password"})
    connection["password"] = body.password.get_secret_value()
    await mlrun.utils.run_in_threadpool(
        services.api.crud.sql_datasets.execute_preview,
        connection=connection,
        query="SELECT 1",
        parameters={},
        timeout_seconds=10,
    )
    return {"ok": True}


@router.post("/projects/{project}/sql-datasets/preview")
async def preview_sql_dataset(
    project: str,
    body: SqlPreview,
    db_session: Annotated[Session, Depends(framework.api.deps.get_db_session)],
    auth_info: Annotated[
        mlrun.common.schemas.AuthInfo, Depends(framework.api.deps.authenticate_request)
    ],
) -> dict:
    """Preview at most 50 rows after authorizing profile and credential access.

    :param project: Owning project.
    :param body: Query and connection reference.
    :param db_session: Database session.
    :param auth_info: Authenticated caller.
    :return: Columns, rows and truncation marker.
    """
    await _authorize_connection(
        project=project, auth_info=auth_info, name=body.connection
    )
    connection = await mlrun.utils.run_in_threadpool(
        services.api.crud.sql_datasets.get_connection,
        session=db_session,
        project=project,
        name=body.connection,
        private=True,
    )
    return await mlrun.utils.run_in_threadpool(
        services.api.crud.sql_datasets.execute_preview,
        connection=connection,
        query=body.query,
        parameters=body.parameters,
        timeout_seconds=body.timeout_seconds,
    )


@router.post("/projects/{project}/sql-datasets", status_code=202)
async def create_sql_dataset(
    project: str,
    body: SqlDataset,
    background_tasks: BackgroundTasks,
    db_session: Annotated[Session, Depends(framework.api.deps.get_db_session)],
    auth_info: Annotated[
        mlrun.common.schemas.AuthInfo, Depends(framework.api.deps.authenticate_request)
    ],
) -> dict:
    """Save an immutable dataset definition and submit its first import job.

    :param project: Owning project.
    :param body: Dataset definition.
    :param background_tasks: Existing run submission background tasks.
    :param db_session: Database session.
    :param auth_info: Authenticated caller.
    :return: Submitted run.
    """
    await _authorize(
        project,
        auth_info,
        "datastore_profile",
        "store",
        services.api.crud.sql_datasets.DATASET_PREFIX + body.name,
    )
    await _authorize_import(project=project, auth_info=auth_info, definition=body)
    image = _job_image()
    await mlrun.utils.run_in_threadpool(
        services.api.crud.sql_datasets.get_connection,
        session=db_session,
        project=project,
        name=body.connection,
    )
    definition = body.model_dump()
    await mlrun.utils.run_in_threadpool(
        services.api.crud.sql_datasets.create_definition,
        session=db_session,
        project=project,
        definition=definition,
    )
    return await _submit(
        project, definition, image, db_session, auth_info, background_tasks
    )


@router.post("/projects/{project}/sql-datasets/{name}/refresh", status_code=202)
async def refresh_sql_dataset(
    project: str,
    name: Annotated[
        str, Path(pattern=r"^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$", max_length=50)
    ],
    background_tasks: BackgroundTasks,
    db_session: Annotated[Session, Depends(framework.api.deps.get_db_session)],
    auth_info: Annotated[
        mlrun.common.schemas.AuthInfo, Depends(framework.api.deps.authenticate_request)
    ],
) -> dict:
    """Submit a fresh snapshot using the unchanged saved dataset definition.

    :param project: Owning project.
    :param name: Existing dataset name.
    :param background_tasks: Existing run submission background tasks.
    :param db_session: Database session.
    :param auth_info: Authenticated caller.
    :return: Submitted run.
    """
    await _authorize(
        project,
        auth_info,
        "datastore_profile",
        "read",
        services.api.crud.sql_datasets.DATASET_PREFIX + name,
    )
    definition = await mlrun.utils.run_in_threadpool(
        services.api.crud.sql_datasets.get_definition,
        session=db_session,
        project=project,
        name=name,
    )
    # Profiles can also be managed through the generic datastore API: validate again
    # before trusting a saved definition as an executable import request.
    body = SqlDataset.model_validate(definition)
    await _authorize_import(project=project, auth_info=auth_info, definition=body)
    image = _job_image()
    await mlrun.utils.run_in_threadpool(
        services.api.crud.sql_datasets.get_connection,
        session=db_session,
        project=project,
        name=body.connection,
    )
    return await _submit(
        project, body.model_dump(), image, db_session, auth_info, background_tasks
    )


async def _authorize(project, auth_info, resource_type, action, name):
    await (
        framework.utils.auth.verifier.AuthVerifier().query_project_resource_permissions(
            resource_type=getattr(
                mlrun.common.schemas.AuthorizationResourceTypes, resource_type
            ),
            project_name=project,
            resource_name=name,
            action=getattr(mlrun.common.schemas.AuthorizationAction, action),
            auth_info=auth_info,
        )
    )


async def _latest_run(project, name, db_session, auth_info):
    verifier = framework.utils.auth.verifier.AuthVerifier()
    allowed = await verifier.query_project_resource_permissions(
        resource_type=mlrun.common.schemas.AuthorizationResourceTypes.run,
        project_name=project,
        resource_name="",
        action=mlrun.common.schemas.AuthorizationAction.read,
        auth_info=auth_info,
        raise_on_forbidden=False,
    )
    if not allowed:
        return None
    runs = await mlrun.utils.run_in_threadpool(
        framework.utils.singletons.db.get_db().list_runs,
        session=db_session,
        project=project,
        labels=[f"sql-dataset={name}"],
        name=services.api.crud.sql_datasets.DATASET_PREFIX + name,
        sort=True,
        limit=1,
    )
    runs = await verifier.filter_project_resources_by_permissions(
        mlrun.common.schemas.AuthorizationResourceTypes.run,
        runs,
        lambda run: (project, run["metadata"]["uid"]),
        auth_info,
    )
    if not runs:
        return None
    run = runs[0]
    status = run.get("status", {})
    results = status.get("results", {})
    return {
        "metadata": {
            key: run["metadata"].get(key) for key in ("uid", "project", "name")
        },
        "status": {
            "state": status.get("state"),
            "results": {
                key: results[key] for key in ("rows", "dataset_uri") if key in results
            },
        },
    }


async def _authorize_connection(project, auth_info, name):
    await _authorize(
        project,
        auth_info,
        "datastore_profile",
        "read",
        services.api.crud.sql_datasets.CONNECTION_PREFIX + name,
    )
    await _authorize(project, auth_info, "secret", "read", "kubernetes")


async def _authorize_import(project, auth_info, definition):
    await _authorize_connection(
        project=project, auth_info=auth_info, name=definition.connection
    )
    await _authorize(project, auth_info, "artifact", "read", definition.name)
    await _authorize(project, auth_info, "artifact", "store", definition.name)
    await _authorize(project, auth_info, "run", "create", "")
    await _authorize(
        project,
        auth_info,
        "function",
        "store",
        services.api.crud.sql_datasets.DATASET_PREFIX + definition.name,
    )


def _job_image():
    image = getattr(getattr(mlrun.mlconf, "sql_dataset", None), "job_image", "")
    if not image:
        raise HTTPException(
            status_code=503, detail="SQL dataset worker image is not configured"
        )
    return image


async def _submit(project, definition, image, db_session, auth_info, background_tasks):
    result = await framework.api.utils.submit_run(
        db_session=db_session,
        auth_info=auth_info,
        background_tasks=background_tasks,
        data=services.api.crud.sql_datasets.job_payload(
            project=project, definition=definition, image=image
        ),
    )
    return {"run": result["data"]}
