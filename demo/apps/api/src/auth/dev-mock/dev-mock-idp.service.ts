import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { CONFIG, type Config } from '../../config/config.js';
import type { AuthProvider, IdpIdentity, LoginStart } from '../auth-provider.js';

const DirectorySchema = z.object({
  issuer: z.string(),
  identities: z.array(
    z.object({
      sub: z.string().min(1),
      email: z.string().min(3),
      email_verified: z.boolean(),
      name: z.string(),
    }),
  ),
});

export type MockIdentity = z.infer<typeof DirectorySchema>['identities'][number];

type PendingCode = { identity: MockIdentity; nonce: string; redirectUri: string; expiresAt: number };

const CODE_TTL_MS = 60_000;

// IdP giả lập, mô phỏng OIDC Authorization Code (SPEC §5.2). Danh bạ nằm trong dev-mock-idp.json,
// tách khỏi DB của app. Code dùng một lần, sống 60 giây, chỉ trả về đúng redirect_uri đã cấu hình.
@Injectable()
export class DevMockIdp implements AuthProvider {
  readonly name = 'dev-mock';
  readonly identities: MockIdentity[];
  private readonly codes = new Map<string, PendingCode>();

  constructor(@Inject(CONFIG) private readonly config: Config) {
    const raw: unknown = JSON.parse(readFileSync(config.devMockIdpFile, 'utf8'));
    this.identities = DirectorySchema.parse(raw).identities;
  }

  // ---- phía app (client của IdP)

  startLogin({ state, nonce }: LoginStart): URL {
    const url = new URL('/dev-mock-idp/authorize', this.config.API_ORIGIN);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('redirect_uri', this.config.callbackUrl);
    url.searchParams.set('state', state);
    url.searchParams.set('nonce', nonce);
    return url;
  }

  async handleCallback(params: { code?: string; nonce: string; codeVerifier?: string }): Promise<IdpIdentity | null> {
    if (!params.code) return null;
    const pending = this.codes.get(params.code);
    this.codes.delete(params.code);
    if (!pending || pending.expiresAt < Date.now()) return null;
    if (pending.nonce !== params.nonce || pending.redirectUri !== this.config.callbackUrl) return null;
    const i = pending.identity;
    return { provider: this.name, sub: i.sub, email: i.email.toLowerCase(), emailVerified: i.email_verified, name: i.name };
  }

  // ---- phía IdP

  isAllowedRedirect(redirectUri: string): boolean {
    return redirectUri === this.config.callbackUrl;
  }

  issueCode(sub: string, nonce: string, redirectUri: string): string | null {
    const identity = this.identities.find((i) => i.sub === sub);
    if (!identity || !this.isAllowedRedirect(redirectUri)) return null;
    const code = randomBytes(24).toString('base64url');
    this.codes.set(code, { identity, nonce, redirectUri, expiresAt: Date.now() + CODE_TTL_MS });
    return code;
  }
}
