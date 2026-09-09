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
"""One-time additive recovery of this demo's missing run in the local SQLite DB.

Run inside mlrun-api only after confirming orphan run-label parents caused allocation
collisions. A SQLite backup is mandatory. Existing rows and orphan labels are retained.
"""

import argparse
import json
import pickle
import sqlite3
from datetime import UTC, datetime
from pathlib import Path


def main() -> None:
    """Restore the observed failed run above occupied label parent identifiers."""
    parser = argparse.ArgumentParser()
    parser.add_argument("run_file")
    args = parser.parse_args()
    run = json.loads(Path(args.run_file).read_text())
    project = run["metadata"]["project"]
    if project != "transaction-feature-demo":
        raise ValueError("This recovery is restricted to transaction-feature-demo")
    uid = run["metadata"]["uid"]
    connection = sqlite3.connect("/mlrun/db/mlrun.db", timeout=30)
    if connection.execute(
        "SELECT 1 FROM runs WHERE project=? AND uid=?", (project, uid)
    ).fetchone():
        print("Run already exists; no changes made")
        return
    backup_path = Path("/mlrun/db/backups") / (
        "before-demo-run-recovery-"
        + datetime.now(UTC).strftime("%Y%m%dT%H%M%S")
        + ".db"
    )
    backup_path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(backup_path) as backup:
        connection.backup(backup)
    now = datetime.now(UTC).isoformat()
    run["metadata"].pop("credentials", None)
    run["status"] = {
        "state": "error",
        "error": (
            "Run metadata creation failed because pre-existing orphan run labels "
            "collided with an allocated SQLite ID; preserved for diagnosis."
        ),
        "last_update": now,
    }
    with connection:
        connection.execute("BEGIN IMMEDIATE")
        next_id = connection.execute(
            "SELECT max(value)+1 FROM (SELECT coalesce(max(id),0) value FROM runs "
            "UNION ALL SELECT coalesce(max(parent),0) FROM runs_labels)"
        ).fetchone()[0]
        connection.execute(
            "INSERT INTO runs (id,uid,project,name,iteration,state,body,start_time,end_time,updated,requested_logs) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (
                next_id,
                uid,
                project,
                run["metadata"]["name"],
                0,
                "error",
                pickle.dumps(run),
                now,
                now,
                now,
                0,
            ),
        )
    print(
        json.dumps(
            {
                "restored_failed_run_uid": uid,
                "id": next_id,
                "backup": str(backup_path),
                "existing_rows_removed": 0,
            }
        )
    )


if __name__ == "__main__":
    main()
