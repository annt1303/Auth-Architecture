import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';

export const CONFIG = Symbol('CONFIG');

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  TENANT_KEY: z.string().min(1),
  AUTH_PROVIDER: z.enum(['dev-mock', 'oidc']),
  DEV_MOCK_IDP_FILE: z.string().default('./dev-mock-idp.json'),
  SESSION_COOKIE_NAME: z.string().default('authz_sid'),
  SESSION_TTL_MINUTES: z.coerce.number().int().positive().default(480),
  API_ORIGIN: z.string().url(),
  WEB_ORIGIN: z.string().url(),
  OIDC_ISSUER_URL: z.string().url().optional(),
  OIDC_CLIENT_ID: z.string().min(1).optional(),
  OIDC_CLIENT_SECRET: z.string().min(1).optional(),
  OIDC_REDIRECT_URI: z.string().url().optional(),
  OIDC_SCOPES: z.string().default('openid email profile'),
});

export type Config = z.infer<typeof EnvSchema> & {
  rootDir: string;
  devMockIdpFile: string;
  callbackUrl: string;
};

// Tìm .env từ thư mục hiện tại đi lên (pnpm chạy API với cwd = apps/api).
// Biến đã có trong môi trường được ưu tiên hơn giá trị trong file.
function findEnvFile(start: string): string | undefined {
  let dir = resolve(start);
  for (;;) {
    const candidate = join(dir, '.env');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

function findRootDir(start: string): string {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return resolve(start);
    dir = parent;
  }
}

export function loadConfig(): Config {
  const envFile = findEnvFile(process.cwd());
  if (envFile) process.loadEnvFile(envFile);

  const env = EnvSchema.parse(process.env);
  const rootDir = envFile ? dirname(envFile) : findRootDir(process.cwd());

  if (env.AUTH_PROVIDER === 'dev-mock' && env.NODE_ENV === 'production') {
    throw new Error('AUTH_PROVIDER=dev-mock is not allowed when NODE_ENV=production');
  }
  if (env.AUTH_PROVIDER === 'oidc') {
    const missing = ['OIDC_ISSUER_URL', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'OIDC_REDIRECT_URI'].filter(
      (k) => !env[k as keyof typeof env],
    );
    if (missing.length) throw new Error(`AUTH_PROVIDER=oidc requires ${missing.join(', ')}`);
  }

  return {
    ...env,
    rootDir,
    devMockIdpFile: resolve(rootDir, env.DEV_MOCK_IDP_FILE),
    // OIDC: URL đã đăng ký với IdP; dev-mock: cùng origin với API
    callbackUrl:
      env.AUTH_PROVIDER === 'oidc' ? env.OIDC_REDIRECT_URI! : new URL('/auth/callback', env.API_ORIGIN).toString(),
  };
}
