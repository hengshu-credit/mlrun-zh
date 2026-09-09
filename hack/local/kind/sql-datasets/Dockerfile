FROM mlrun/mlrun-api:1.13.0-rc7

# Keep the running release's server/SDK dependencies and add only this feature.
COPY sql_dataset.py /usr/local/lib/python3.11/site-packages/mlrun/datastore/sql_dataset.py
COPY sql_datasets_endpoint.py /mlrun/server/py/services/api/api/endpoints/sql_datasets.py
COPY sql_datasets_crud.py /mlrun/server/py/services/api/crud/sql_datasets.py
RUN python -c "from pathlib import Path; p=Path('/usr/local/lib/python3.11/site-packages/mlrun/config.py'); s=p.read_text(); anchor='    \"redis\": {'; assert s.count(anchor)==1; p.write_text(s.replace(anchor, '    \"sql_dataset\": {\"job_image\": \"\"},\n'+anchor))"
RUN printf '\nfrom services.api.api.endpoints import sql_datasets\napi_router.include_router(sql_datasets.router, tags=["sql-datasets"])\n' >> /mlrun/server/py/services/api/api/api.py

ENV MLRUN_SQL_DATASET__JOB_IMAGE=mlrun/mlrun-api:1.13.0-rc7-sql.1
LABEL mlrun.local.sql-datasets="1"
