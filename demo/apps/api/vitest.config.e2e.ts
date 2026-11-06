import { defineConfig } from 'vitest/config';

// Test tích hợp chạy trên Postgres thật: globalSetup tạo lại database authz_test
// từ db/*.sql trước mỗi lần chạy. Cần `pnpm db:up` trước.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['test/**/*.e2e-spec.ts'],
    globalSetup: ['./test/global-setup.ts'],
    fileParallelism: false,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgres://authz:authz@localhost:5433/authz_test',
      TENANT_KEY: 'nhg-demo',
      AUTH_PROVIDER: 'dev-mock',
      API_ORIGIN: 'http://localhost:3000',
      WEB_ORIGIN: 'http://localhost:5173',
    },
  },
});
