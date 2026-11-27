# ---- build ----
FROM node:26-alpine AS build
WORKDIR /app
COPY . .
# Until the React app lands (no package.json yet) a placeholder page is served so the stack still starts.
RUN if [ -f package.json ]; then \
      if [ -f package-lock.json ]; then npm ci; else npm install; fi && npm run build; \
    else \
      mkdir -p dist && printf '%s\n' \
        '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>ExpenseFlow</title></head>' \
        '<body><h1>ExpenseFlow</h1><p>Frontend not built yet.</p>' \
        '<p><a href="/api/swagger-ui.html">API (Swagger UI)</a></p></body></html>' > dist/index.html; \
    fi

# ---- runtime ----
FROM nginxinc/nginx-unprivileged:1.31-alpine
# base images lag behind Alpine security fixes: patch OS packages at build time, then drop back to the nginx user
USER root
RUN apk upgrade --no-cache
USER 101
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --retries=5 \
  CMD wget -qO- http://127.0.0.1:8080/ >/dev/null || exit 1
