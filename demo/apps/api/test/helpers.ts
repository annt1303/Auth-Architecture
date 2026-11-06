import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import pg from 'pg';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { loadConfig } from '../src/config/config.js';

export async function createApp(): Promise<INestApplication<App>> {
  const config = loadConfig();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.register(config)] }).compile();
  const app = moduleRef.createNestApplication<INestApplication<App>>();
  configureApp(app, config);
  await app.init();
  return app;
}

export type Login =
  | { ok: true; cookie: string }
  | { ok: false; location: string };

// Chạy đủ luồng đăng nhập dev-mock như trình duyệt: /auth/login -> trang IdP -> chọn danh tính
// -> /auth/callback. Trả về cookie session nếu thành công.
export async function login(app: INestApplication<App>, sub: string): Promise<Login> {
  const http = request(app.getHttpServer());
  const start = await http.get('/auth/login').expect(302);
  const loginCookie = cookiesOf(start).find((c) => c.startsWith('authz_login='))!;
  const authorize = new URL(start.headers.location as string);

  const picked = await http
    .post('/dev-mock-idp/authorize')
    .type('form')
    .send({
      sub,
      redirect_uri: authorize.searchParams.get('redirect_uri'),
      state: authorize.searchParams.get('state'),
      nonce: authorize.searchParams.get('nonce'),
    })
    .expect(302);

  const callback = new URL(picked.headers.location as string);
  const done = await http
    .get(`${callback.pathname}${callback.search}`)
    .set('Cookie', loginCookie.split(';')[0]!)
    .expect(302);
  const session = cookiesOf(done).find((c) => c.startsWith('authz_sid=') && !c.startsWith('authz_sid=;'));
  return session
    ? { ok: true, cookie: session.split(';')[0]! }
    : { ok: false, location: done.headers.location as string };
}

export async function loginAs(app: INestApplication<App>, sub: string): Promise<string> {
  const result = await login(app, sub);
  if (!result.ok) throw new Error(`login as ${sub} failed: ${result.location}`);
  return result.cookie;
}

function cookiesOf(res: request.Response): string[] {
  const raw = res.headers['set-cookie'] as unknown;
  return Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
}

export async function withDb<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export async function documentId(title: string): Promise<string> {
  return withDb(async (c) => (await c.query('SELECT id FROM documents WHERE title = $1', [title])).rows[0].id);
}

export async function unitId(code: string): Promise<string> {
  return withDb(async (c) => (await c.query('SELECT id FROM org_units WHERE code = $1', [code])).rows[0].id);
}

// Bản sao riêng của authz_test cho spec có ghi dữ liệu lên các danh tính seed (Bình, Hoa, lan, new.hire...),
// để các spec khác vẫn thấy đúng dữ liệu demo. Gọi trước createApp(); trả về hàm dọn.
export async function useIsolatedDb(): Promise<() => Promise<void>> {
  const base = new URL(process.env.DATABASE_URL!);
  const name = `authz_iso_${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
  const admin = new URL(base);
  admin.pathname = '/postgres';
  const run = async (sql: string) => {
    const c = new pg.Client({ connectionString: admin.toString() });
    await c.connect();
    try {
      await c.query(sql);
    } finally {
      await c.end();
    }
  };
  await run(`CREATE DATABASE ${name} TEMPLATE ${base.pathname.slice(1)}`);
  const original = process.env.DATABASE_URL!;
  const iso = new URL(base);
  iso.pathname = `/${name}`;
  process.env.DATABASE_URL = iso.toString();
  return async () => {
    process.env.DATABASE_URL = original;
    await run(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  };
}

export async function roleId(key: string): Promise<string> {
  return withDb(async (c) => (await c.query('SELECT id FROM roles WHERE key = $1', [key])).rows[0].id);
}

export async function principalId(email: string): Promise<string> {
  return withDb(async (c) => (await c.query('SELECT id FROM principals WHERE email = $1', [email])).rows[0].id);
}
