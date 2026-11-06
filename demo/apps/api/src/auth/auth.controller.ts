import { createHash, randomBytes } from 'node:crypto';
import { Controller, Get, HttpCode, Inject, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthenticatedOnly, Public } from '../authz/decorators.js';
import { DecisionAudit } from '../authz/decision-audit.service.js';
import { CONFIG, type Config } from '../config/config.js';
import { SessionService } from '../session/session.service.js';
import { AUTH_PROVIDER, type AuthProvider } from './auth-provider.js';
import { LoginGate } from './login-gate.service.js';

const LOGIN_COOKIE = 'authz_login';
const LOGIN_COOKIE_MAX_AGE_MS = 10 * 60_000;

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AUTH_PROVIDER) private readonly provider: AuthProvider,
    @Inject(CONFIG) private readonly config: Config,
    private readonly gate: LoginGate,
    private readonly sessions: SessionService,
    private readonly audit: DecisionAudit,
  ) {}

  @Get('login')
  @Public()
  async login(@Res() res: Response): Promise<void> {
    const state = randomBytes(24).toString('base64url');
    const nonce = randomBytes(24).toString('base64url');
    // PKCE: verifier chỉ nằm trong cookie httpOnly của lần đăng nhập này; IdP chỉ thấy challenge
    const codeVerifier = randomBytes(32).toString('base64url');
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
    res.cookie(LOGIN_COOKIE, JSON.stringify({ state, nonce, codeVerifier }), {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.config.NODE_ENV === 'production',
      path: '/auth',
      maxAge: LOGIN_COOKIE_MAX_AGE_MS,
    });
    res.redirect(302, (await this.provider.startLogin({ state, nonce, codeChallenge })).toString());
  }

  // Mọi thất bại đều quay về cùng một trang lỗi; lý do thật chỉ nằm trong audit lớp B (SPEC §5.3).
  @Get('callback')
  @Public()
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const fail = (error: 'login_failed' | 'login_denied') =>
      res.redirect(302, new URL(`/login?error=${error}`, this.config.WEB_ORIGIN).toString());

    const pending = parseLoginCookie(req.cookies?.[LOGIN_COOKIE]);
    res.clearCookie(LOGIN_COOKIE, { path: '/auth' });
    if (!pending || !state || pending.state !== state) return fail('login_failed');

    const identity = await this.provider.handleCallback({
      code,
      nonce: pending.nonce,
      codeVerifier: pending.codeVerifier,
    });
    if (!identity) return fail('login_failed');

    const outcome = await this.gate.check(identity, req.correlationId);
    if (!outcome.allowed) {
      this.audit.recordLoginDenied({
        tenantKey: this.config.TENANT_KEY,
        correlationId: req.correlationId,
        reason: outcome.reason,
        provider: identity.provider,
        subject: identity.sub,
        email: identity.email,
      });
      return fail('login_denied');
    }

    await this.sessions.create(outcome.principalId, req, res);
    res.redirect(302, new URL('/', this.config.WEB_ORIGIN).toString());
  }

  @Post('logout')
  @AuthenticatedOnly()
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.sessions.revoke(req, res);
  }
}

function parseLoginCookie(raw: unknown): { state: string; nonce: string; codeVerifier: string } | null {
  if (typeof raw !== 'string') return null;
  try {
    const value = JSON.parse(raw) as { state?: unknown; nonce?: unknown; codeVerifier?: unknown };
    return typeof value.state === 'string' && typeof value.nonce === 'string' && typeof value.codeVerifier === 'string'
      ? { state: value.state, nonce: value.nonce, codeVerifier: value.codeVerifier }
      : null;
  } catch {
    return null;
  }
}
