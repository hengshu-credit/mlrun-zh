FROM mlrun/mlrun-ui:1.13.0-rc7@sha256:9de35321535a14e9e01614a2e802f08e1a6b40c8b7dd383b395420ad65c3b0cf

# Preserve the release image's nginx configuration and startup script.
COPY --chown=101:0 build/ /usr/share/nginx/html/
LABEL org.opencontainers.image.revision="c4235698cba093958c02281cd20dbe0ab380230e" \
      mlrun.local.ui.patch="workflow-permissions-1"
