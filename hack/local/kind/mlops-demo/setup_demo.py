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
"""Configure, train, deploy and verify a persistent MLRun transaction example."""

import argparse
import copy
import hashlib
import json
import os
import random
from datetime import UTC, datetime, timedelta
from pathlib import Path

import event_features
import pandas as pd
import requests

import mlrun
import mlrun.datastore
import mlrun.datastore.targets
import mlrun.feature_store as fstore


def main() -> None:
    """Execute one resumable setup stage; retain state, data, runs and configurations."""
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "stage",
        choices=[
            "prepare",
            "backfill",
            "train",
            "deploy-features",
            "deploy-model",
            "verify",
        ],
    )
    parser.add_argument("--root", default="/home/jovyan/data/transaction-feature-demo")
    parser.add_argument("--redeploy", action="store_true")
    args = parser.parse_args()
    root = Path(args.root)
    root.mkdir(parents=True, exist_ok=True)
    config_path = root / "config.json"
    if not config_path.exists():
        config_path.write_text(Path(__file__).with_name("config.json").read_text())
    config = json.loads(config_path.read_text())
    os.environ["MLRUN_DEMO_CONFIG"] = str(config_path)
    state_path = root / "state.json"
    state = json.loads(state_path.read_text()) if state_path.exists() else {}
    config_hash = hashlib.sha256(config_path.read_bytes()).hexdigest()
    if state.get("config_hash", config_hash) != config_hash:
        raise ValueError(
            "Saved configuration differs from the trained version. "
            "Retain this project and use a new project/root for changed feature definitions."
        )
    state["config_hash"] = config_hash
    revisions = root / "config-revisions"
    revisions.mkdir(exist_ok=True)
    revision = revisions / f"{config_hash}.json"
    if not revision.exists():
        revision.write_bytes(config_path.read_bytes())
    os.environ["MLRUN_DEMO_CONFIG"] = str(revision)
    project = mlrun.get_or_create_project(
        name=config["project"], context=str(root), user_project=False
    )
    if args.stage == "prepare":
        if state.get("training_data"):
            print(
                "Prepared dataset already exists; reusing saved configuration and snapshots."
            )
        else:
            _prepare(project, config, root, state)
    elif args.stage == "backfill":
        if state.get("backfill_run_uid"):
            print(
                "Offline backfill already exists; retaining the saved run and dataset."
            )
        else:
            function = _function(project, config, root, "backfill-features", "job")
            project.set_function(func=function)
            project.save()
            run = function.run(
                handler="backfill",
                inputs={"requests_data": str(root / "sample-cutoffs.parquet")},
                watch=True,
            )
            state["backfill_run_uid"] = run.metadata.uid
            state["backfill_dataset"] = run.outputs["historical-features"]
    elif args.stage == "train":
        if state.get("model_uri"):
            print("Trained model already exists; retaining its training run.")
        else:
            function = _function(
                project, config, root, config["training_function"], "job"
            )
            project.set_function(func=function)
            project.save()
            run = function.run(
                handler="train", inputs={"dataset": state["training_data"]}, watch=True
            )
            state["model_uri"] = run.outputs[config["model_name"]]
            state["training_run_uid"] = run.metadata.uid
            state["metrics"] = run.status.results
    elif args.stage.startswith("deploy"):
        is_model = args.stage == "deploy-model"
        uri_key = "model_function_uri" if is_model else "feature_function_uri"
        if state.get(uri_key) and not args.redeploy:
            print(
                "Existing serving configuration retained; use --redeploy only to explicitly replace it."
            )
            return
        name = config["model_function"] if is_model else config["feature_function"]
        function = _function(project, config, root, name, "serving")
        if not is_model:
            function.set_env("DEMO_REDIS_TARGET_PATH", state["redis_target_path"])
        if is_model:
            function.add_model(
                key=config["model_name"],
                model_path=state["model_uri"],
                class_name="functions.OrderClassifier",
            )
        else:
            function.set_topology("flow", engine="sync").to(
                name="aggregate-events", handler="functions.features_http"
            ).respond()
            function.with_http(num_workers=1)
        project.set_function(func=function)
        project.save()
        function.deploy()
        function.save()
        state["model_function_uri" if is_model else "feature_function_uri"] = (
            function.uri
        )
        state["model_service" if is_model else "feature_service"] = (
            f"nuclio-{config['project']}-{name}"
        )
    else:
        _verify(config, root, state)
    project.save()
    state_path.write_text(json.dumps(state, indent=2, default=str))
    _export(project, config, root)
    print(json.dumps({"stage": args.stage, "state_file": str(state_path)}))


def _function(project, config, root, name, kind):
    function = mlrun.code_to_function(
        name=name,
        project=project.name,
        kind=kind,
        filename=str(Path(__file__).with_name("functions.py")),
        image=config["image"],
    )
    function.apply(mlrun.auto_mount())
    function.set_env("PYTHONPATH", str(Path(__file__).parent))
    function.set_env("MLRUN_DEMO_CONFIG", os.environ["MLRUN_DEMO_CONFIG"])
    function.set_env("MLRUN_DBPATH", "http://mlrun-api:8080")
    function.set_env_from_secret(
        name="POSTGRES_PASSWORD", secret="mlrun-platform-credentials"
    )
    function.with_requests(cpu="100m", mem="256Mi")
    if kind == "serving":
        function.with_limits(cpu="1", mem="1Gi")
        function.spec.min_replicas = 1
        function.spec.max_replicas = 1
    return function


def _export(project, config, root):
    feature_set = fstore.get_feature_set(
        f"store://feature-sets/{project.name}/{config['feature_set']}"
    )
    (root / "feature-set.yaml").write_text(feature_set.to_yaml())
    for key, filename in [
        ("serving_vector", "serving-vector.yaml"),
        ("training_vector", "training-vector.yaml"),
    ]:
        vector = fstore.get_feature_vector(
            f"store://feature-vectors/{project.name}/{config[key]}"
        )
        (root / filename).write_text(vector.to_yaml())


def _prepare(project, config, root, state):
    store = event_features.EventStore(config)
    store.initialize()
    samples_path = root / "sample-cutoffs.json"
    if samples_path.exists():
        samples = json.loads(samples_path.read_text())
    else:
        samples = _seed(store, config, root)
        samples_path.write_text(json.dumps(samples, indent=2))
    features = [feature["name"] for feature in config["features"]]
    requests_frame = pd.DataFrame(samples)
    requests_frame["as_of"] = pd.to_datetime(requests_frame["as_of"], utc=True)
    requests_frame.to_parquet(root / "sample-cutoffs.parquet", index=False)
    feature_set = fstore.FeatureSet(
        name=config["feature_set"],
        entities=[fstore.Entity("user_id"), fstore.Entity("order_id")],
        timestamp_key="as_of",
        engine="storey",
        description="Exact user/order event windows at as_of; as_known excludes late arrivals",
    )
    feature_set.metadata.project = project.name
    feature_set.graph.to(
        name="point-in-time-aggregates", handler="event_features.process_request"
    )
    parquet = mlrun.datastore.ParquetTarget(
        name="parquet", path=str(root / "offline-features")
    )
    redis = mlrun.datastore.targets.RedisNoSqlTarget(
        name="redis", path=config["redis_url"] + "/" + project.name + "/features"
    )
    feature_set.set_targets([parquet, redis], with_defaults=False)
    feature_set.save()
    # Append mode is mandatory: the default ingest mode purges previous targets.
    result = feature_set.ingest(
        source=requests_frame, targets=[parquet], overwrite=False
    )
    result = result.reset_index()
    result.to_parquet(root / "training-snapshots.parquet", index=False)
    project.log_dataset(
        key="training-snapshots", df=result, format="parquet", index=False
    )
    serving_vector = fstore.FeatureVector(
        name=config["serving_vector"],
        features=[f"{config['feature_set']}.{name}" for name in features],
    )
    serving_vector.metadata.project = project.name
    serving_vector.save()
    training_vector = fstore.FeatureVector(
        name=config["training_vector"],
        features=[f"{config['feature_set']}.{name}" for name in features],
        label_feature=f"{config['feature_set']}.label",
        with_indexes=True,
    )
    training_vector.metadata.project = project.name
    training_vector.save()
    # Initialize native online storage separately, using current-time snapshots only.
    current = requests_frame.tail(1).drop(columns=["as_of", "label"])
    feature_set.ingest(source=current, targets=[redis], overwrite=False)
    feature_set.reload()
    for target in feature_set.status.targets:
        if target.kind == "redisnosql":
            state["redis_target_path"] = target.get_path().get_absolute_path(
                project_name=project.name
            )
    (root / "feature-set.yaml").write_text(feature_set.to_yaml())
    (root / "serving-vector.yaml").write_text(serving_vector.to_yaml())
    (root / "training-vector.yaml").write_text(training_vector.to_yaml())
    state.update(
        training_data=str(root / "training-snapshots.parquet"),
        sample_count=len(result),
        example_query={
            key: samples[-1][key] for key in ["user_id", "order_id", "as_of"]
        },
        feature_names=features,
    )
    project.description = config["description"]
    project.save()
    store.close()


def _seed(store, config, root):
    rng = random.Random(config["random_state"])
    seed_path = root / "seed-start.json"
    if not seed_path.exists():
        start = datetime.now(UTC).replace(microsecond=0) - timedelta(days=12)
        # Persist before the first committed event so an interrupted import can replay it.
        seed_path.write_text(json.dumps({"start": start.isoformat()}))
    start = event_features.parse_time(json.loads(seed_path.read_text())["start"])
    samples = []
    for index in range(240):
        cutoff = start + timedelta(hours=index)
        user = f"user-{index % 40:03}"
        order = f"order-{index:04}"
        high_retry_user = index % 40 < 15
        failures = rng.randint(1, 4) if high_retry_user else rng.randint(0, 1)
        events = []
        for number in range(rng.randint(1, 5)):
            events.append(
                ("item", rng.randint(10, 200), cutoff - timedelta(minutes=30 - number))
            )
        for number in range(failures):
            events.append(
                ("payment_failed", 0, cutoff - timedelta(minutes=10 - number))
            )
        events.append(("payment", rng.randint(20, 600), cutoff - timedelta(minutes=50)))
        if index % 7 == 0:
            events.append(("refund", rng.randint(5, 80), cutoff - timedelta(hours=3)))
        label = int(rng.random() < (0.85 if high_retry_user else 0.15))
        # The outcome occurs after the prediction cutoff; it is only the label at that cutoff.
        events.append(
            (
                "payment_failed" if label else "payment",
                50,
                cutoff + timedelta(minutes=10),
            )
        )
        for number, (kind, amount, event_time) in enumerate(events):
            event = {
                "event_id": f"seed-{index:04}-{number:02}",
                "user_id": user,
                "order_id": order,
                "event_type": kind,
                "amount": amount,
                "event_time": event_time.isoformat(),
            }
            store.append([event], received_at=event_time + timedelta(seconds=2))
        samples.append(
            {
                "user_id": user,
                "order_id": order,
                "as_of": cutoff.isoformat(),
                "label": label,
            }
        )
    return samples


def _verify(config, root, state):
    _configure_online_snapshot(config, root, state)
    base = f"http://{state['feature_service']}.mlrun.svc.cluster.local:8080"
    model = f"http://{state['model_service']}.mlrun.svc.cluster.local:8080/v2/models/{config['model_name']}/infer"
    query = state["example_query"]
    response = requests.post(base, json=query, timeout=30)
    mlrun.errors.raise_for_status(response)
    historical = response.json()
    frame = pd.read_parquet(state["training_data"])
    backfill_matches_training = False
    if state.get("backfill_dataset"):
        backfill = mlrun.get_dataitem(state["backfill_dataset"]).as_df()
        keys = ["user_id", "order_id", "as_of"]
        columns = keys + state["feature_names"] + ["label"]
        frame["as_of"] = frame["as_of"].dt.as_unit("ns")
        backfill["as_of"] = backfill["as_of"].dt.as_unit("ns")
        pd.testing.assert_frame_equal(
            frame[columns].sort_values(keys).reset_index(drop=True),
            backfill[columns].sort_values(keys).reset_index(drop=True),
            check_dtype=False,
        )
        backfill_matches_training = True
    row = frame[
        (frame.user_id == query["user_id"]) & (frame.order_id == query["order_id"])
    ].iloc[-1]
    for name in state["feature_names"]:
        assert abs(historical[name] - row[name]) < 1e-9, name
    prediction = requests.post(model, json={"inputs": [query]}, timeout=30)
    mlrun.errors.raise_for_status(prediction)
    invalid = requests.post(
        base,
        json={"user_id": query["user_id"], "as_of": "2026-09-01T00:00:00"},
        timeout=30,
    )
    assert invalid.status_code == 400, invalid.text
    # Retry the same event and verify no double counting; received_at remains server-owned.
    event = {
        "event_id": "verification-live-payment",
        "user_id": "live-user",
        "order_id": "live-order",
        "event_type": "payment",
        "amount": 125.5,
        "event_time": (datetime.now(UTC) - timedelta(seconds=30)).isoformat(),
    }
    event_path = root / "verification-event.json"
    if event_path.exists():
        event = json.loads(event_path.read_text())
    else:
        event_path.write_text(json.dumps(event, indent=2))
    request = {"user_id": "live-user", "order_id": "live-order", "events": [event]}
    first = requests.post(base, json=request, timeout=30)
    second = requests.post(base, json=request, timeout=30)
    mlrun.errors.raise_for_status(first)
    mlrun.errors.raise_for_status(second)
    assert first.json()["user_payment_sum_24h"] == second.json()["user_payment_sum_24h"]
    online = fstore.get_feature_vector(
        f"store://feature-vectors/{config['project']}/{config['serving_vector']}"
    ).get_online_feature_service()
    cached = online.get([{"user_id": "live-user", "order_id": "live-order"}])[0]
    try:
        assert cached is not None, "MLRun online snapshot was not found"
        assert (
            cached["user_payment_sum_24h"] == second.json()["user_payment_sum_24h"]
        ), cached
    finally:
        online.close()
    result = {
        "verified_at": datetime.now(UTC).isoformat(),
        "historical_features": historical,
        "prediction": prediction.json(),
        "live_features": second.json(),
        "online_snapshot": cached,
        "historical_matches_training": True,
        "backfill_matches_training": backfill_matches_training,
        "duplicate_is_idempotent": True,
        "invalid_status": invalid.status_code,
    }
    (root / "verification.json").write_text(json.dumps(result, indent=2, default=str))
    state["verification"] = result


def _configure_online_snapshot(config, root, state):
    original = fstore.get_feature_set(
        f"store://feature-sets/{config['project']}/{config['feature_set']}"
    )
    online_name = config["feature_set"] + "-online"
    if state.get("online_snapshot_set"):
        return
    store = event_features.EventStore(config)
    sample = store.query(user_id="live-user", order_id="live-order")
    store.close()
    row = {key: sample[key] for key in ["user_id", "order_id", "as_of"]}
    row.update(
        {
            feature["name"] + "_value": sample[feature["name"]]
            for feature in config["features"]
        }
    )
    snapshot_set = fstore.FeatureSet(
        name=online_name,
        entities=[fstore.Entity("user_id"), fstore.Entity("order_id")],
        timestamp_key="as_of",
        description="Last computed user/order snapshot; use HTTP for exact current or historical windows",
    )
    snapshot_set.metadata.project = config["project"]
    snapshot_set.set_targets(
        [
            copy.deepcopy(target)
            for target in original.spec.targets
            if target.kind == "redisnosql"
        ],
        with_defaults=False,
    )
    snapshot_set.preview(pd.DataFrame([row]))
    snapshot_set.status.targets = [
        copy.deepcopy(target)
        for target in original.status.targets
        if target.kind == "redisnosql"
    ]
    snapshot_set.save()
    vector = fstore.get_feature_vector(
        f"store://feature-vectors/{config['project']}/{config['serving_vector']}"
    )
    vector.save(tag="before-static-snapshot-fix", versioned=True)
    vector.spec.features = [
        f"{online_name}.{feature['name']}_value as {feature['name']}"
        for feature in config["features"]
    ]
    # Retaining entity keys also distinguishes a valid all-zero snapshot from a missing entity.
    vector.spec.with_indexes = True
    vector.save()
    (root / "online-feature-set.yaml").write_text(snapshot_set.to_yaml())
    state["online_snapshot_set"] = online_name


if __name__ == "__main__":
    main()
