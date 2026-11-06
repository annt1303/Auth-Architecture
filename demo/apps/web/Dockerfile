# Build context là thư mục demo/ (xem docker-compose.yml).
FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /app
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY packages/authz-types/package.json packages/authz-types/
RUN pnpm install --frozen-lockfile --filter @authz-demo/web...
COPY packages/authz-types packages/authz-types
COPY apps/web apps/web
RUN pnpm --filter @authz-demo/authz-types build && pnpm --filter @authz-demo/web build

FROM nginx:alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
