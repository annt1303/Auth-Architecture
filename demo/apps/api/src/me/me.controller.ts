import { Controller, Get, Inject } from '@nestjs/common';
import type { MeResponse } from '@authz-demo/authz-types';
import { ApiError } from '../common/api-error.js';
import { SCOPE_LABEL_COLUMN, SCOPE_LABEL_JOINS, toScopeDto } from '../common/scope-label.js';
import { AuthenticatedOnly, PrincipalId } from '../authz/decorators.js';
import { CONFIG, type Config } from '../config/config.js';
import { Db } from '../db/db.js';
import { EffectiveService } from './effective.service.js';

// Dữ liệu của chính người đang đăng nhập. Chỉ cần session (không gọi PDP), để cả người
// đang bị tạm ngưng cũng xem được trạng thái của mình (SPEC §12).
@Controller('me')
export class MeController {
  constructor(
    private readonly db: Db,
    private readonly effective: EffectiveService,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  @Get()
  @AuthenticatedOnly()
  async me(@PrincipalId() principalId: string): Promise<MeResponse> {
    const [head] = await this.db.query<{
      id: string;
      email: string;
      display_name: string;
      status: MeResponse['principal']['status'];
      tenant_id: string;
      tenant_key: string;
      tenant_name: string;
      tenant_status: MeResponse['tenant']['status'];
      membership_status: MeResponse['membership']['status'];
    }>(
      `SELECT p.id, p.email, p.display_name, p.status,
              t.id AS tenant_id, t.key AS tenant_key, t.name AS tenant_name, t.status AS tenant_status,
              m.status AS membership_status
         FROM principals p
         CROSS JOIN tenants t
         LEFT JOIN tenant_memberships m ON m.tenant_id = t.id AND m.principal_id = p.id
        WHERE p.id = $1 AND t.key = $2`,
      [principalId, this.config.TENANT_KEY],
    );
    if (!head) throw new ApiError('unauthenticated');
    const tenantId = head.tenant_id;

    const affiliations = await this.db.query<{
      c_id: string; c_code: string; c_name: string;
      d_id: string | null; d_code: string | null; d_name: string | null;
    }>(
      `SELECT c.id AS c_id, c.code AS c_code, c.name AS c_name, d.id AS d_id, d.code AS d_code, d.name AS d_name
         FROM user_affiliations a
         JOIN org_units c ON c.id = a.company_id
         LEFT JOIN org_units d ON d.id = a.department_id
        WHERE a.tenant_id = $1 AND a.principal_id = $2
        ORDER BY c.code`,
      [tenantId, principalId],
    );

    // Assignment đang lưu ACTIVE, kể cả cái đã hết hạn: để thấy "lưu ACTIVE" khác "có hiệu lực" (§8.5.1)
    const assignments = await this.db.query<{
      id: string; key: string; name: string; level: number; owner_kind: 'SYSTEM' | 'TENANT' | 'COMPANY';
      scope_type: string; scope_id: string | null; scope_resource_type: string | null; scope_name: string | null;
      valid_from: Date | null; valid_until: Date | null; not_yet_valid: boolean; expired: boolean;
    }>(
      `SELECT g.id, r.key, r.name, r.level, r.owner_kind,
              g.scope_type, g.scope_id, g.scope_resource_type, ${SCOPE_LABEL_COLUMN},
              g.valid_from, g.valid_until,
              coalesce(g.valid_from > now(), false) AS not_yet_valid,
              coalesce(g.valid_until <= now(), false) AS expired
         FROM tenant_role_assignments g
         JOIN roles r ON r.id = g.role_id
         ${SCOPE_LABEL_JOINS}
        WHERE g.tenant_id = $1 AND g.principal_id = $2 AND g.status = 'ACTIVE'
        ORDER BY r.level, r.key`,
      [tenantId, principalId],
    );

    const membershipActive = head.membership_status === 'ACTIVE';

    return {
      principal: { id: head.id, email: head.email, displayName: head.display_name, status: head.status },
      tenant: { key: head.tenant_key, name: head.tenant_name, status: head.tenant_status },
      membership: { status: head.membership_status },
      affiliations: affiliations.map((a) => ({
        company: { id: a.c_id, code: a.c_code, name: a.c_name, type: 'COMPANY' },
        department: a.d_id ? { id: a.d_id, code: a.d_code!, name: a.d_name!, type: 'DEPARTMENT' } : null,
      })),
      assignments: assignments.map((a) => {
        const ineffectiveReason = !membershipActive
          ? 'MEMBERSHIP_INACTIVE'
          : a.expired
            ? 'EXPIRED'
            : a.not_yet_valid
              ? 'NOT_YET_VALID'
              : null;
        return {
          id: a.id,
          role: { key: a.key, name: a.name, level: a.level, ownerKind: a.owner_kind },
          scope: toScopeDto(a),
          validFrom: a.valid_from?.toISOString() ?? null,
          validUntil: a.valid_until?.toISOString() ?? null,
          effective: ineffectiveReason === null,
          ineffectiveReason,
        };
      }),
      effectivePermissions: await this.effective.permissions(tenantId, principalId),
    };
  }
}
