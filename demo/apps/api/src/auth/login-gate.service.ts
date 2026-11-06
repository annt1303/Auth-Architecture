import { Inject, Injectable } from '@nestjs/common';
import { CONFIG, type Config } from '../config/config.js';
import { Db } from '../db/db.js';
import type { IdpIdentity } from './auth-provider.js';

export type LoginDeniedReason =
  | 'EMAIL_UNVERIFIED'
  | 'DOMAIN_NOT_ALLOWED'
  | 'NOT_PROVISIONED'
  | 'SUBJECT_MISMATCH'
  | 'PRINCIPAL_DISABLED';

export type LoginGateResult =
  | { allowed: true; principalId: string }
  | { allowed: false; reason: LoginDeniedReason };

// Cửa đăng nhập (SPEC §5.3). Đây là bước xác thực, không phải phân quyền:
// membership không ACTIVE vẫn đăng nhập được, nhưng mọi API sẽ trả tenant_access_denied.
@Injectable()
export class LoginGate {
  constructor(
    private readonly db: Db,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  async check(identity: IdpIdentity, correlationId: string): Promise<LoginGateResult> {
    const deny = (reason: LoginDeniedReason): LoginGateResult => ({ allowed: false, reason });
    const email = identity.email.toLowerCase();

    if (!identity.emailVerified) return deny('EMAIL_UNVERIFIED');

    const [domain] = await this.db.query(
      `SELECT 1 FROM company_domains d JOIN tenants t ON t.id = d.tenant_id
        WHERE t.key = $1 AND d.domain = $2 AND d.status = 'ACTIVE'`,
      [this.config.TENANT_KEY, email.split('@')[1] ?? ''],
    );
    if (!domain) return deny('DOMAIN_NOT_ALLOWED');

    type P = { id: string; status: string; auth_subject: string | null };
    let [principal] = await this.db.query<P>(
      `SELECT id, status, auth_subject FROM principals WHERE auth_provider = $1 AND auth_subject = $2`,
      [identity.provider, identity.sub],
    );
    if (!principal) {
      // Lần đăng nhập đầu: gắn sub vào user đã được tạo trước, khớp theo email (đã xác minh)
      [principal] = await this.db.query<P>(
        `SELECT id, status, auth_subject FROM principals WHERE email = $1`,
        [email],
      );
      if (!principal) return deny('NOT_PROVISIONED');
      if (principal.auth_subject !== null) return deny('SUBJECT_MISMATCH');
      const linked = await this.db.withActor(
        { principalId: principal.id, correlationId, reason: 'first SSO login: link identity' },
        (tx) =>
          tx.query(
            `UPDATE principals SET auth_provider = $2, auth_subject = $3, linked_at = now()
              WHERE id = $1 AND auth_subject IS NULL RETURNING id`,
            [principal!.id, identity.provider, identity.sub],
          ),
      );
      if (linked.length === 0) return deny('SUBJECT_MISMATCH'); // bị gắn đồng thời bởi lần đăng nhập khác
    }

    if (principal.status !== 'ACTIVE') return deny('PRINCIPAL_DISABLED');
    return { allowed: true, principalId: principal.id };
  }
}
