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

"""Secret-backed configuration and bounded SQL dataset operations.

Callers must authorize profile, secret and artifact access before these synchronous
operations. API endpoints execute them in the thread pool.
"""

import base64

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

import mlrun
import mlrun.common.schemas
import mlrun.datastore.datastore_profile
import mlrun.datastore.sql_dataset
import mlrun.errors

import framework.db.sqldb.models
import framework.utils.singletons.db
import services.api.crud

CONNECTION_PREFIX = "sql-connection-"
DATASET_PREFIX = "sql-dataset-"
CONNECTION_FIELDS = ("name", "dialect", "host", "port", "database", "username")
DATASET_FIELDS = (
    "name",
    "connection",
    "query",
    "parameters",
    "description",
    "timeout_seconds",
    "max_rows",
)


def public_profile(profile: mlrun.common.schemas.DatastoreProfile) -> dict:
    """Decode only the public configuration portion.

    :param profile: Stored profile schema.
    :return: Public attributes, excluding any unexpected password fields.
    """
    parsed = mlrun.datastore.datastore_profile.DatastoreProfile2Json.create_from_json(
        public_json=profile.object
    )
    if not isinstance(parsed, mlrun.datastore.datastore_profile.ConfigProfile):
        return {}
    public = parsed.public or {}
    purpose = public.get("purpose")
    fields = CONNECTION_FIELDS if purpose == "sql-connection" else DATASET_FIELDS
    return {"purpose": purpose, **{key: public[key] for key in fields if key in public}}


def get_definition(session: Session, project: str, name: str) -> dict:
    """Read an immutable SQL dataset definition.

    :param session: Database session.
    :param project: Owning project.
    :param name: Dataset name.
    :return: Saved dataset definition.
    """
    public = _get_public(session=session, project=project, name=DATASET_PREFIX + name)
    if public.pop("purpose", None) != "sql-dataset":
        raise HTTPException(status_code=404, detail="SQL dataset not found")
    return public


def get_connection(
    session: Session, project: str, name: str, private: bool = False
) -> dict:
    """Read a connection, resolving its password only when requested after authorization.

    :param session: Database session.
    :param project: Owning project.
    :param name: Connection name.
    :param private: Whether the caller authorized secret access.
    :return: Connection fields.
    """
    profile_name = CONNECTION_PREFIX + name
    profile = _get_profile(session=session, project=project, name=profile_name)
    public = public_profile(profile=profile)
    if public.pop("purpose", None) != "sql-connection":
        raise HTTPException(status_code=404, detail="SQL connection not found")
    if private:
        secret = services.api.crud.Secrets().get_project_secret(
            project=project,
            provider=mlrun.common.schemas.SecretProviderName.kubernetes,
            secret_key=mlrun.datastore.datastore_profile.DatastoreProfile.generate_secret_key(
                profile_name=profile_name, project=project
            ),
            allow_secrets_from_k8s=True,
            allow_internal_secrets=True,
        )
        if not secret:
            raise HTTPException(
                status_code=400, detail="SQL connection password is unavailable"
            )
        decoded = (
            mlrun.datastore.datastore_profile.DatastoreProfile2Json.create_from_json(
                public_json=profile.object, private_json=secret
            )
        )
        public["password"] = (decoded.private or {}).get("password", "")
    return public


def create_connection(session: Session, project: str, connection: dict) -> dict:
    """Save a new connection and store its password as an existing project Secret.

    :param session: Database session.
    :param project: Owning project.
    :param connection: Validated connection including password.
    :return: Public connection fields.
    """
    profile_name = CONNECTION_PREFIX + connection["name"]
    public = {key: connection[key] for key in CONNECTION_FIELDS}
    profile = mlrun.datastore.datastore_profile.ConfigProfile(
        name=profile_name,
        public={"purpose": "sql-connection", **public},
        private={"password": connection["password"]},
    )
    _create_profile(session=session, project=project, profile=profile)
    return public


def create_definition(session: Session, project: str, definition: dict) -> None:
    """Persist a new definition without replacing existing datasets or profiles.

    :param session: Database session.
    :param project: Owning project.
    :param definition: Validated immutable definition.
    :return: None.
    """
    profile_name = DATASET_PREFIX + definition["name"]
    existing = framework.utils.singletons.db.get_db().read_artifact(
        session=session,
        key=definition["name"],
        project=project,
        tag="latest",
        raise_on_not_found=False,
    )
    if existing:
        raise HTTPException(
            status_code=409, detail="An artifact already uses this dataset name"
        )
    profile = mlrun.datastore.datastore_profile.ConfigProfile(
        name=profile_name, public={"purpose": "sql-dataset", **definition}
    )
    _create_profile(session=session, project=project, profile=profile)


def execute_preview(
    connection: dict, query: str, parameters: dict, timeout_seconds: int = 30
) -> dict:
    """Execute a bounded preview and redact database driver failures.

    :param connection: Authorized connection with resolved credentials.
    :param query: Validated SELECT query.
    :param parameters: Bound scalar parameters.
    :param timeout_seconds: Maximum query duration in seconds.
    :return: Columns, rows and truncation marker.
    """
    engine = None
    try:
        engine = mlrun.datastore.sql_dataset.create_query_engine(
            connection=connection, timeout_seconds=timeout_seconds
        )
        return mlrun.datastore.sql_dataset.preview_query(
            engine=engine,
            query=query,
            parameters=parameters,
            limit=50,
            timeout_seconds=timeout_seconds,
        )
    except Exception:  # noqa: BLE001 - drivers may expose passwords in arbitrary exceptions.
        raise HTTPException(
            status_code=400,
            detail="SQL query failed. Check connection, read permissions, query and resource limits.",
        ) from None
    finally:
        if engine is not None:
            engine.dispose()


def job_payload(project: str, definition: dict, image: str) -> dict:
    """Create a fixed-code import job containing only a saved connection reference.

    :param project: Owning project.
    :param definition: Immutable saved definition without credentials.
    :param image: Operator-configured image containing the SQL import handler.
    :return: Submit-run request payload.
    """
    name = DATASET_PREFIX + definition["name"]
    code = (
        "from mlrun.datastore.sql_dataset import import_sql_dataset\n"
        "def handler(context, definition):\n"
        "    return import_sql_dataset(context, definition)\n"
    )
    return {
        "function": {
            "kind": "job",
            "metadata": {"name": name, "project": project},
            "spec": {
                "image": image,
                # Operators may reuse the API image, whose inherited environment
                # otherwise makes worker SDK code select an uninitialized API launcher.
                "env": [{"name": "MLRUN_IS_API_SERVER", "value": "false"}],
                "default_handler": "handler",
                "build": {
                    "functionSourceCode": base64.b64encode(code.encode()).decode()
                },
            },
        },
        "task": {
            "metadata": {
                "name": name,
                "project": project,
                "labels": {"sql-dataset": definition["name"]},
            },
            "spec": {"handler": "handler", "parameters": {"definition": definition}},
        },
    }


def _get_profile(session: Session, project: str, name: str):
    try:
        return framework.utils.singletons.db.get_db().get_datastore_profile(
            session=session, profile=name, project=project
        )
    except mlrun.errors.MLRunNotFoundError:
        raise HTTPException(
            status_code=404, detail="SQL configuration not found"
        ) from None


def _get_public(session: Session, project: str, name: str) -> dict:
    return public_profile(
        profile=_get_profile(session=session, project=project, name=name)
    )


def _create_profile(session: Session, project: str, profile):
    serializer = mlrun.datastore.datastore_profile.DatastoreProfile2Json
    try:
        # A plain INSERT reserves the existing (name, project) unique key. The
        # upsert API must not be used here: it can replace another caller's
        # immutable definition after both callers observed an absent profile.
        session.add(
            framework.db.sqldb.models.DatastoreProfile(
                name=profile.name,
                project=project,
                type="config",
                full_object=serializer.get_json_public(profile),
            )
        )
        session.flush()
        # Keep the unique-key reservation until Secret storage succeeds. A
        # competing create fails at flush, before it can overwrite credentials.
        if profile.private:
            services.api.crud.Secrets().store_project_secrets(
                project=project,
                secrets=mlrun.common.schemas.SecretsData(
                    provider=mlrun.common.schemas.SecretProviderName.kubernetes,
                    secrets={
                        profile.generate_secret_key(
                            profile_name=profile.name, project=project
                        ): serializer.get_json_private(profile)
                    },
                ),
                allow_internal_secrets=True,
            )
        session.commit()
    except IntegrityError:
        session.rollback()
        raise HTTPException(
            status_code=409,
            detail="SQL configuration already exists; use a new name or refresh the dataset",
        ) from None
    except Exception:
        session.rollback()
        raise
