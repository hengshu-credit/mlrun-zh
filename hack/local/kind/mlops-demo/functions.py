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
"""MLRun training and serving entrypoints for the transaction feature demo."""

import json
import os
import pickle
from pathlib import Path

import event_features
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, roc_auc_score

import mlrun
import mlrun.errors
import mlrun.serving
import mlrun.serving.server


def train(context: mlrun.MLClientCtx, dataset: mlrun.DataItem) -> None:
    """Train on historical snapshots with a chronological holdout.

    :param context: MLRun run context.
    :param dataset: Point-in-time training dataset.
    """
    config = json.loads(Path(os.environ["MLRUN_DEMO_CONFIG"]).read_text())
    names = [feature["name"] for feature in config["features"]]
    frame = dataset.as_df().sort_values("as_of").reset_index(drop=True)
    split = int(len(frame) * (1 - config["test_size"]))
    training, testing = frame.iloc[:split], frame.iloc[split:]
    model = RandomForestClassifier(
        n_estimators=config["n_estimators"], random_state=config["random_state"]
    )
    model.fit(training[names], training["label"])
    prediction = model.predict(testing[names])
    metrics = {
        "accuracy": float(accuracy_score(testing["label"], prediction)),
        "train_rows": len(training),
        "test_rows": len(testing),
    }
    if testing["label"].nunique() == 2:
        metrics["roc_auc"] = float(
            roc_auc_score(testing["label"], model.predict_proba(testing[names])[:, 1])
        )
    context.log_results(metrics)
    context.log_dataset(key="holdout", df=testing, format="parquet", index=False)
    context.log_model(
        key=config["model_name"],
        body=pickle.dumps(model),
        model_file="model.pkl",
        framework="sklearn",
        algorithm="RandomForestClassifier",
        metrics=metrics,
        training_set=training[names + ["label"]],
        label_column="label",
        feature_vector=f"store://feature-vectors/{config['project']}/{config['training_vector']}",
        labels={"data": "synthetic-transactions", "split": "chronological"},
    )


def features_http(body: dict) -> object:
    """Calculate features for an HTTP request, returning validation failures as 400.

    :param body: Query or event ingestion request.
    :returns: Feature object or HTTP validation response.
    """
    try:
        result = event_features.process_request(body)
        result["as_of"] = result["as_of"].isoformat()
        return result
    except ValueError as exc:
        return mlrun.serving.server.Response(
            body=json.dumps({"error": mlrun.errors.err_to_str(exc)}),
            content_type="application/json",
            status_code=400,
        )


def backfill(context: mlrun.MLClientCtx, requests_data: mlrun.DataItem) -> None:
    """Materialize user/order features at each historical sample cutoff.

    :param context: MLRun job context.
    :param requests_data: Dataset containing user_id and/or order_id and an aware as_of.
    """
    source = requests_data.as_df()
    if "as_of" not in source.columns or source["as_of"].isna().any():
        raise ValueError("Every offline sample must have an explicit as_of")
    records = [event_features.process_request(row) for row in source.to_dict("records")]
    context.log_dataset(
        key="historical-features",
        df=pd.DataFrame(records),
        format="parquet",
        index=False,
    )
    context.log_result("sample_count", len(records))


class OrderClassifier(mlrun.serving.V2ModelServer):
    """Serve an order model using the same time-aware feature calculation."""

    def load(self) -> None:
        """Load the versioned training artifact and its feature order."""
        model_file, _ = self.get_model(".pkl")
        with open(model_file, "rb") as model_stream:
            self.model = pickle.load(model_stream)
        config = json.loads(Path(os.environ["MLRUN_DEMO_CONFIG"]).read_text())
        self.names = [feature["name"] for feature in config["features"]]

    def predict(self, body: dict) -> list:
        """Predict from user/order queries or eight ordered numeric features.

        :param body: V2 request with a non-empty inputs list.
        :returns: Predicted synthetic follow-up labels.
        """
        inputs = body.get("inputs")
        if not isinstance(inputs, list) or not 1 <= len(inputs) <= 100:
            raise mlrun.errors.MLRunInvalidArgumentError(
                "inputs must contain 1 to 100 records"
            )
        rows = []
        for record in inputs:
            if isinstance(record, dict):
                try:
                    features = event_features.process_request(record)
                except ValueError as exc:
                    raise mlrun.errors.MLRunInvalidArgumentError(
                        mlrun.errors.err_to_str(exc)
                    ) from exc
                rows.append([features[name] for name in self.names])
            elif isinstance(record, list) and len(record) == len(self.names):
                rows.append(record)
            else:
                raise mlrun.errors.MLRunInvalidArgumentError(
                    "Each input must be a query or an ordered feature list"
                )
        return self.model.predict(pd.DataFrame(rows, columns=self.names)).tolist()
