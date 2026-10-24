# syntax=docker/dockerfile:1
# One image recipe for every backend service:
#   docker build --build-arg SERVICE=booking-service -t evently-booking .
ARG NODE_VERSION=22-alpine

FROM node:${NODE_VERSION} AS build
ARG SERVICE
WORKDIR /app
COPY . .
RUN test -n "$SERVICE" || (echo "Pass --build-arg SERVICE=<service-name>" && exit 1)
RUN npm ci -w @evently/shared -w @evently/${SERVICE} --include-workspace-root --ignore-scripts \
 && npm run build -w @evently/shared -w @evently/${SERVICE} \
 && rm -rf node_modules \
 && npm ci -w @evently/shared -w @evently/${SERVICE} --include-workspace-root=false --omit=dev --ignore-scripts

FROM node:${NODE_VERSION}
ARG SERVICE
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
# Whole workspace dirs: dist/, migrations/, openapi.yaml and any nested node_modules.
COPY --from=build /app/packages/shared ./packages/shared
COPY --from=build /app/services/${SERVICE} ./services/${SERVICE}
WORKDIR /app/services/${SERVICE}
USER node
CMD ["node", "dist/index.js"]
