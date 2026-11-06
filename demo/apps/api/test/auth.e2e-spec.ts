import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { createApp, login, loginAs, withDb } from './helpers.js';

const WEB_LOGIN_DENIED = 'http://localhost:5173/login?error=login_denied';

describe('Đăng nhập dev-mock và cửa đăng nhập (SPEC §5)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it('lần đăng nhập đầu gắn sub của IdP vào user đã tạo trước và ghi audit lớp A', async () => {
    const result = await login(app, 'mock|sysadmin');
    expect(result.ok).toBe(true);

    const row = await withDb(async (c) =>
      (await c.query(`SELECT id, auth_provider, auth_subject FROM principals WHERE email = 'sysadmin@holding.test'`))
        .rows[0],
    );
    expect(row).toMatchObject({ auth_provider: 'dev-mock', auth_subject: 'mock|sysadmin' });

    const events = await withDb(async (c) =>
      (
        await c.query(
          `SELECT actor_id, actor_attributed, payload->>'reason' AS reason FROM audit_events
            WHERE event_type = 'principals.modified' AND target_id = $1`,
          [row.id],
        )
      ).rows,
    );
    expect(events).toEqual([{ actor_id: row.id, actor_attributed: true, reason: 'first SSO login: link identity' }]);
  });

  it.each([
    ['mock|outsider', 'DOMAIN_NOT_ALLOWED'],
    ['mock|partner', 'DOMAIN_NOT_ALLOWED'],
    ['mock|new-hire', 'NOT_PROVISIONED'],
    ['mock|unverified', 'EMAIL_UNVERIFIED'],
  ])('%s bị từ chối với cùng một trang lỗi; lý do thật (%s) chỉ nằm trong audit lớp B', async (sub, reason) => {
    const result = await login(app, sub);
    expect(result).toEqual({ ok: false, location: WEB_LOGIN_DENIED });

    await new Promise((r) => setTimeout(r, 50)); // audit lớp B ghi bất đồng bộ
    const events = await withDb(
      async (c) =>
        (
          await c.query(
            `SELECT payload->>'reason' AS reason FROM audit_events
              WHERE event_class = 'B' AND event_type = 'auth.login_denied' AND payload->>'subject' = $1`,
            [sub],
          )
        ).rows,
    );
    expect(events.map((e) => e.reason)).toContain(reason);
  });

  it('state sai thì đăng nhập thất bại', async () => {
    const res = await request(app.getHttpServer())
      .get('/auth/callback?code=x&state=forged-state-value')
      .set('Cookie', `authz_login=${encodeURIComponent(JSON.stringify({ state: 'other', nonce: 'n' }))}`)
      .expect(302);
    expect(res.headers.location).toBe('http://localhost:5173/login?error=login_failed');
  });

  it('IdP giả lập chỉ chấp nhận redirect_uri đã cấu hình', async () => {
    const res = await request(app.getHttpServer())
      .get('/dev-mock-idp/authorize')
      .query({ response_type: 'code', redirect_uri: 'https://evil.example/cb', state: 's'.repeat(20), nonce: 'n'.repeat(20) })
      .expect(400);
    expect(res.body.error).toBe('invalid_request');
  });

  it('không có session thì 401 với thân lỗi chuẩn', async () => {
    const res = await request(app.getHttpServer()).get('/documents').expect(401);
    expect(res.body).toEqual({
      error: 'unauthenticated',
      message: 'Authentication is required.',
      correlationId: expect.stringMatching(/^c-/),
    });
  });

  it('logout thu hồi session ngay', async () => {
    const cookie = await loginAs(app, 'mock|chi');
    await request(app.getHttpServer()).get('/me').set('Cookie', cookie).expect(200);
    await request(app.getHttpServer()).post('/auth/logout').set('Cookie', cookie).expect(204);
    await request(app.getHttpServer()).get('/me').set('Cookie', cookie).expect(401);
  });

  it('request thay đổi dữ liệu từ origin lạ bị chặn', async () => {
    const cookie = await loginAs(app, 'mock|chi');
    const res = await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Cookie', cookie)
      .set('Origin', 'https://evil.example')
      .expect(403);
    expect(res.body.error).toBe('forbidden');
  });
});
