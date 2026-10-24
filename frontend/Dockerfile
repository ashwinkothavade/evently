# syntax=docker/dockerfile:1
# Builds the SPA and serves it with nginx; /api is proxied to the gateway.
#   docker build -f frontend/Dockerfile -t evently-web .
FROM node:22-alpine AS build
WORKDIR /app
COPY . .
RUN npm ci -w @evently/frontend --include-workspace-root --ignore-scripts \
 && npm run build -w @evently/frontend

FROM nginx:1.27-alpine
ENV API_UPSTREAM=http://gateway:8080
COPY frontend/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/frontend/dist /usr/share/nginx/html
EXPOSE 80
