FROM mlrun/mlrun-ui:1.13.0-rc7@sha256:9de35321535a14e9e01614a2e802f08e1a6b40c8b7dd383b395420ad65c3b0cf

# Extend the release template while preserving its environment-based proxies.
USER root
COPY ui-entry.conf /etc/nginx/ui-entry.conf
RUN grep -q '  include resolvers.conf;' /etc/nginx/conf.d/nginx.conf.tmpl \
    && sed -i '/  include resolvers.conf;/a\  include /etc/nginx/ui-entry.conf;' /etc/nginx/conf.d/nginx.conf.tmpl
USER 101

COPY --chown=101:0 build/ /usr/share/nginx/html/
LABEL org.opencontainers.image.revision="c4235698cba093958c02281cd20dbe0ab380230e" \
      mlrun.local.ui.patch="workflow-permissions-1,bilingual-1,tianshu-shell-1,nuclio-embed-1,entry-cache-1,sql-datasets-1"
