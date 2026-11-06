import { createHash, randomBytes } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { createApp, useIsolatedDb, withDb } from './helpers.js';

// OidcAuthProvider (SPEC §5.1, giai đoạn 3) chạy với một IdP OIDC giả dựng ngay trong test:
// discovery, authorize, token (kiểm PKCE) và JWKS, ký ID token bằng RS256 thật.
describe('Đăng nhập OIDC (Authorization Code + PKCE)', () => {
  let idp: http.Server;
  let issuer: string;
  let app: INestApplication<App>;
  let privateKey: CryptoKey;
  let publicJwk: JWK;

  // Mỗi lần authorize tạo một "phiên" nhớ challenge, nonce, và danh tính được chọn.
  const sessions = new Map<string, { challenge: string; nonce: string; claims: Record<string, unknown> }>();
  let nextClaims: Record<string, unknown> = {};
  let tamperAudience = false;
  let cleanup: () => Promise<void>;

  const sign = async (claims: Record<string, unknown>, nonce: string) => {
    const jwt = new SignJWT({ ...claims, nonce })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuer(issuer)
      .setAudience(tamperAudience ? 'someone-else' : 'authz-demo')
      .setIssuedAt()
      .setExpirationTime('5m');
    return jwt.sign(privateKey);
  };

  beforeAll(async () => {
    cleanup = await useIsolatedDb(); // spec này gắn sub OIDC vào user seed
    // Các spec trước đã đăng nhập bằng dev-mock và gắn sub; xóa liên kết để lần đăng nhập OIDC đầu tiên gắn lại (SPEC §5.3)
    await withDb((c) =>
      c.query('UPDATE principals SET auth_provider = NULL, auth_subject = NULL, linked_at = NULL'),
    );
    const pair = await generateKeyPair('RS256');
    privateKey = pair.privateKey;
    publicJwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };

    idp = http.createServer(async (req, res) => {
      const url = new URL(req.url!, issuer);
      const json = (body: unknown) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(body));
      };
      if (url.pathname === '/.well-known/openid-configuration') {
        return json({
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          jwks_uri: `${issuer}/jwks`,
        });
      }
      if (url.pathname === '/jwks') return json({ keys: [publicJwk] });
      if (url.pathname === '/authorize') {
        const code = randomBytes(12).toString('hex');
        sessions.set(code, {
          challenge: url.searchParams.get('code_challenge')!,
          nonce: url.searchParams.get('nonce')!,
          claims: nextClaims,
        });
        const back = new URL(url.searchParams.get('redirect_uri')!);
        back.searchParams.set('code', code);
        back.searchParams.set('state', url.searchParams.get('state')!);
        res.statusCode = 302;
        res.setHeader('Location', back.toString());
        return res.end();
      }
      if (url.pathname === '/token') {
        let raw = '';
        for await (const chunk of req) raw += chunk;
        const form = new URLSearchParams(raw);
        const s = sessions.get(form.get('code') ?? '');
        sessions.delete(form.get('code') ?? ''); // code dùng một lần
        const verifierOk =
          !!s && createHash('sha256').update(form.get('code_verifier') ?? '').digest('base64url') === s.challenge;
        if (!s || !verifierOk || form.get('client_secret') !== 'secret' || form.get('client_id') !== 'authz-demo') {
          res.statusCode = 400;
          return json({ error: 'invalid_grant' });
        }
        return json({ id_token: await sign(s.claims, s.nonce), token_type: 'Bearer' });
      }
      res.statusCode = 404;
      res.end();
    });
    await new Promise<void>((r) => idp.listen(0, '127.0.0.1', r));
    issuer = `http://127.0.0.1:${(idp.address() as AddressInfo).port}`;

    Object.assign(process.env, {
      AUTH_PROVIDER: 'oidc',
      OIDC_ISSUER_URL: issuer,
      OIDC_CLIENT_ID: 'authz-demo',
      OIDC_CLIENT_SECRET: 'secret',
      OIDC_REDIRECT_URI: 'http://localhost:3000/auth/callback',
    });
    app = await createApp();
  });

  afterAll(async () => {
    await app.close();
    await new Promise((r) => idp.close(r));
    delete process.env.AUTH_PROVIDER;
    await cleanup();
  });

  // Chạy luồng như trình duyệt: /auth/login -> IdP -> /auth/callback. Trả về nơi cuối cùng được chuyển hướng tới.
  async function signIn(claims: Record<string, unknown>, opts: { tamperState?: boolean } = {}) {
    nextClaims = claims;
    const agent = request(app.getHttpServer());
    const start = await agent.get('/auth/login').expect(302);
    expect(new URL(start.headers.location as string).origin).toBe(issuer); // đi tới IdP, không phải dev-mock
    const cookies = (start.headers['set-cookie'] as unknown as string[]).map((c) => c.split(';')[0]!);
    const authz = await fetch(start.headers.location as string, { redirect: 'manual' });
    const callback = new URL(authz.headers.get('location')!);
    if (opts.tamperState) callback.searchParams.set('state', 'forged-state-value-0000000000000');
    const done = await agent.get(`${callback.pathname}${callback.search}`).set('Cookie', cookies.join('; ')).expect(302);
    const session = ((done.headers['set-cookie'] ?? []) as unknown as string[]).find(
      (c) => c.startsWith('authz_sid=') && !c.startsWith('authz_sid=;'),
    );
    return { location: done.headers.location as string, session: session?.split(';')[0] };
  }

  it('startLogin dùng discovery và gửi PKCE S256', async () => {
    const res = await request(app.getHttpServer()).get('/auth/login').expect(302);
    const url = new URL(res.headers.location as string);
    expect(url.pathname).toBe('/authorize');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('scope')).toBe('openid email profile');
    expect(url.searchParams.get('client_id')).toBe('authz-demo');
  });

  it('đăng nhập thành công: gắn sub ở lần đầu, tạo session, /me trả đúng người', async () => {
    const out = await signIn({ sub: 'oidc|binh', email: 'Binh.Alpha@alpha.test', email_verified: true, name: 'Bình' });
    expect(out.session).toBeDefined();
    expect(new URL(out.location).pathname).toBe('/');
    const me = await request(app.getHttpServer()).get('/me').set('Cookie', out.session!).expect(200);
    expect(me.body.principal.email).toBe('binh.alpha@alpha.test');
    const linked = await withDb(async (c) =>
      (await c.query(`SELECT auth_provider, auth_subject FROM principals WHERE email = 'binh.alpha@alpha.test'`)).rows[0],
    );
    expect(linked).toEqual({ auth_provider: 'oidc', auth_subject: 'oidc|binh' });
  });

  it('lần sau đăng nhập theo (provider, sub), không theo email', async () => {
    const out = await signIn({ sub: 'oidc|binh', email: 'binh.alpha@alpha.test', email_verified: true });
    expect(out.session).toBeDefined();
  });

  it('cùng email nhưng sub khác: SUBJECT_MISMATCH, bị từ chối', async () => {
    const out = await signIn({ sub: 'oidc|impostor', email: 'binh.alpha@alpha.test', email_verified: true });
    expect(out.session).toBeUndefined();
    expect(out.location).toContain('/login?error=login_denied');
  });

  it('email chưa xác minh hoặc thiếu claim email_verified: bị từ chối', async () => {
    const a = await signIn({ sub: 'oidc|chi', email: 'chi.fin@alpha.test', email_verified: false });
    expect(a.session).toBeUndefined();
    const b = await signIn({ sub: 'oidc|chi', email: 'chi.fin@alpha.test' });
    expect(b.session).toBeUndefined();
    expect(b.location).toContain('error=login_denied');
  });

  it('domain không được phép: bị từ chối', async () => {
    const out = await signIn({ sub: 'oidc|x', email: 'someone@example.com', email_verified: true });
    expect(out.location).toContain('error=login_denied');
  });

  it('ID token sai audience: đăng nhập thất bại (login_failed), không tạo session', async () => {
    tamperAudience = true;
    try {
      const out = await signIn({ sub: 'oidc|dung', email: 'dung.ap@alpha.test', email_verified: true });
      expect(out.session).toBeUndefined();
      expect(out.location).toContain('error=login_failed');
    } finally {
      tamperAudience = false;
    }
  });

  it('state bị giả mạo: login_failed', async () => {
    const out = await signIn({ sub: 'oidc|dung', email: 'dung.ap@alpha.test', email_verified: true }, { tamperState: true });
    expect(out.session).toBeUndefined();
    expect(out.location).toContain('error=login_failed');
  });

  it('IdP giả lập dev-mock không được mở khi dùng OIDC thật', async () => {
    await request(app.getHttpServer()).get('/dev-mock-idp/authorize').expect(404);
  });
});
