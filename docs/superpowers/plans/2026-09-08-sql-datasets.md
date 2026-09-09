# SQL dataset snapshots implementation plan

> Execute using superpowers:subagent-driven-development, with focused tests and a final review.

**Goal:** Register MySQL/PostgreSQL query results as reusable platform datasets and refresh them explicitly.

**Architecture:** Project datastore ConfigProfiles hold reusable connections (passwords in existing Secrets) and immutable SQL dataset definitions. Authenticated project API endpoints validate requests and submit independent MLRun Jobs. Jobs stream queries into unique Parquet snapshot files and publish DatasetArtifacts only after the complete file is uploaded. Existing store dataset paths feed feature processing and training.

**Tech stack:** SQLAlchemy, pandas, PyArrow, FastAPI, MLRun Jobs/artifacts, existing React UI overlay and bilingual catalogue.

**Spec:** The approved snapshot design in this task: connection + SQL -> query -> snapshot -> dataset, including explicit full refresh and preservation of older snapshots.

## Constraints and decisions

- Preserve all existing working changes; work in the current checkout because integration depends on the existing UI overlay.
- No database migrations, lock-file edits, release version changes, or CI workflow edits.
- MySQL and PostgreSQL only in the public connection API. SQLite is used for isolated engine tests.
- SQL is parameterized, single SELECT/CTE only, with database read-only transactions, bounded execution and row limits.
- Credentials never enter job parameters, artifact metadata, URLs or returned errors.
- SQL definitions are immutable in this first version. Refresh reuses the saved definition; a new query uses a new dataset name.
- Jobs publish independent physical snapshot paths. A completed refresh becomes latest; failed imports never publish an artifact. Concurrent successful runs use completion-order latest semantics.
- Frontend copy covers English and Simplified Chinese from initial implementation.

## Task 1: Query and snapshot execution

Files: `mlrun/datastore/sql_dataset.py`, `tests/datastore/test_sql_dataset.py`.

- [x] Write failing tests for parameter binding, unsafe statements, row limits, empty result, chunked Parquet output, redacted failures and unchanged prior snapshots.
- [x] Run these tests in the existing MLRun Docker runtime.
- [x] Implement validated connection/query models, bounded query preview and streaming snapshot writer.
- [x] Add the MLRun job handler: resolve Secret-backed connection, write complete snapshot, log dataset and source lineage.
- [x] Verify tests and Ruff checks.

## Task 2: Authenticated platform API

Files: `server/py/services/api/api/endpoints/sql_datasets.py`, `server/py/services/api/crud/sql_datasets.py`, API router registration and targeted API tests.

- [x] Test denied access before query execution, public profile redaction, create conflict and refresh job payloads.
- [x] Add connection creation/test, dataset listing/preview/register/refresh.
- [x] Reuse existing profile persistence, Secret storage and submit-run enrichment.
- [x] Validate against the real SQL engine and artifact path with isolated fixtures.

## Task 3: Platform UI

Files: `hack/local/kind/ui/sql-datasets/`, `hack/local/kind/ui/apply-sql-datasets.cjs`, existing overlay integration.

- [x] Test connection creation, query preview, dataset registration, failure display and refresh without losing old datasets.
- [x] Add SQL dataset manager to the dataset page; existing dataset selectors require no new path scheme.
- [x] Display credentials separately, structured preview, import run link/status, and reusable dataset URI.
- [x] Include bilingual strings and responsive accessible controls.
- [x] Run component tests and production build.

## Task 4: Integration and delivery

- [x] Add reproducible local API/worker build support and user documentation.
- [x] Validate query -> Parquet -> DatasetArtifact -> DataItem and feature-source reads, plus refresh retaining the old snapshot.
- [x] Review changed files for authorization, credential disclosure, resource limits and compatibility.
- [x] Report verified functionality and any live deployment limitations precisely.
