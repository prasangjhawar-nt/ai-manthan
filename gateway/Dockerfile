# 'resolve' in the upstream needs nginx >= 1.27.3 (devops.md 5); 1.29 = current mainline
FROM nginxinc/nginx-unprivileged:1.31-alpine
# base images lag behind Alpine security fixes: patch OS packages at build time, then drop back to the nginx user
USER root
RUN apk upgrade --no-cache
USER 101
COPY nginx.conf /etc/nginx/nginx.conf
COPY gateway.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --retries=5 \
  CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1
