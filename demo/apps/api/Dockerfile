# Build context là thư mục demo/ (xem docker-compose.yml).
FROM node:24-alpine
RUN corepack enable
WORKDIR /app

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY packages/authz-types/package.json packages/authz-types/
RUN pnpm install --frozen-lockfile --filter @authz-demo/api...

COPY packages/authz-types packages/authz-types
COPY apps/api apps/api
COPY dev-mock-idp.json ./
RUN pnpm --filter @authz-demo/authz-types build && pnpm --filter @authz-demo/api build

# dev-mock không chạy được với NODE_ENV=production (SPEC §5.2), nên image demo này giữ development.
ENV NODE_ENV=development
EXPOSE 3000
WORKDIR /app/apps/api
CMD ["node", "dist/main"]
