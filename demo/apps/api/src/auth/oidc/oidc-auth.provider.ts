import { Injectable, Logger } from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { AuthProvider, IdpIdentity, LoginStart } from '../auth-provider.js';

export type OidcSettings = {
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string;
};

type Discovery = { authorization_endpoint: string; token_endpoint: string; jwks_uri: string; issuer: string };

// OIDC Authorization Code + PKCE với IdP thật (Entra ID, Google, Keycloak...). Dùng discovery để lấy endpoint,
// xác minh chữ ký ID token bằng JWKS và kiểm issuer, audience, hạn, nonce (SPEC §5.1, §18 giai đoạn 3).
@Injectable()
export class OidcAuthProvider implements AuthProvider {
  readonly name = 'oidc';
  private readonly logger = new Logger('OidcAuthProvider');
  private discovery: Promise<Discovery> | null = null;
  private jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

  constructor(private readonly settings: OidcSettings) {}

  async startLogin({ state, nonce, codeChallenge }: LoginStart): Promise<URL> {
    const d = await this.discover();
    const url = new URL(d.authorization_endpoint);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', this.settings.clientId);
    url.searchParams.set('redirect_uri', this.settings.redirectUri);
    url.searchParams.set('scope', this.settings.scopes);
    url.searchParams.set('state', state);
    url.searchParams.set('nonce', nonce);
    url.searchParams.set('code_challenge', codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    return url;
  }

  // Mọi thất bại trả null: caller coi như đăng nhập không thành công và không phân biệt nguyên nhân với người dùng.
  async handleCallback(params: { code?: string; nonce: string; codeVerifier: string }): Promise<IdpIdentity | null> {
    if (!params.code) return null;
    try {
      const d = await this.discover();
      const response = await fetch(d.token_endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: params.code,
          redirect_uri: this.settings.redirectUri,
          client_id: this.settings.clientId,
          client_secret: this.settings.clientSecret,
          code_verifier: params.codeVerifier,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) return null;
      const token = (await response.json()) as { id_token?: unknown };
      if (typeof token.id_token !== 'string') return null;

      this.jwks ??= createRemoteJWKSet(new URL(d.jwks_uri));
      const { payload } = await jwtVerify(token.id_token, this.jwks, {
        issuer: d.issuer,
        audience: this.settings.clientId,
        requiredClaims: ['sub', 'exp', 'iat'],
      });
      if (payload.nonce !== params.nonce) return null;
      if (typeof payload.sub !== 'string' || typeof payload.email !== 'string') return null;

      const name = [payload.name, payload.preferred_username, payload.email].find((v): v is string => typeof v === 'string' && !!v);
      return {
        provider: this.name,
        sub: payload.sub,
        email: payload.email.toLowerCase(),
        // Chỉ tin khi IdP khẳng định rõ; thiếu claim thì coi như chưa xác minh (SPEC §5.3 bước 1)
        emailVerified: payload.email_verified === true,
        name: name!,
      };
    } catch (err) {
      this.logger.warn(`OIDC callback rejected: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  private discover(): Promise<Discovery> {
    this.discovery ??= (async () => {
      const issuer = this.settings.issuerUrl.replace(/\/+$/, '');
      const response = await fetch(`${issuer}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error(`OIDC discovery failed (${response.status})`);
      return (await response.json()) as Discovery;
    })().catch((err: unknown) => {
      this.discovery = null; // thử lại ở lần đăng nhập sau thay vì kẹt vĩnh viễn
      throw err;
    });
    return this.discovery;
  }
}
