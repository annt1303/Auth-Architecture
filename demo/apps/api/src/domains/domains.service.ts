import { Injectable } from '@nestjs/common';
import type { DomainAction, DomainDto, DomainStatus } from '@authz-demo/authz-types';
import { AdminRules } from '../authz/admin-rules.service.js';
import type { BuiltContext } from '../authz/context-builder.service.js';
import type { GrantSet } from '../authz/grants.js';
import { ApiError } from '../common/api-error.js';
import { Db } from '../db/db.js';

// Domain công cộng không được làm domain của công ty (SPEC §10.7). Khi dùng IdP thật, nên thêm bước
// xác minh sở hữu domain bằng bản ghi DNS TXT.
const PUBLIC_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'yahoo.com',
  'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com', 'zoho.com', 'example.com',
]);

type DomainRow = {
  id: string; company_id: string; domain: string; status: DomainStatus;
  requester_id: string | null; requester_name: string | null;
  created_at: Date; decided_at: Date | null; affected: string;
};

@Injectable()
export class DomainsService {
  constructor(
    private readonly db: Db,
    private readonly rules: AdminRules,
  ) {}

  async listForCompany(built: BuiltContext, companyId: string): Promise<DomainDto[]> {
    const grants = await this.rules.grantsOf(built);
    const rows = await this.query(built.context.tenantId, 'd.company_id = $2', [companyId]);
    return rows.map((r) => this.toDto(r, grants, built.context.tenantId));
  }

  async get(built: BuiltContext, id: string): Promise<DomainDto> {
    const grants = await this.rules.grantsOf(built);
    const [row] = await this.query(built.context.tenantId, 'd.id = $2', [id]);
    if (!row) throw new Error(`domain ${id} vanished after authorization`);
    return this.toDto(row, grants, built.context.tenantId);
  }

  // Có thêm company_domain.approve (chỉ TENANT) thì ACTIVE ngay, nếu không thì PENDING (SPEC §10.7)
  async propose(built: BuiltContext, companyId: string, rawDomain: string): Promise<DomainDto> {
    const { tenantId, principalId, correlationId } = built.context;
    const domain = rawDomain.trim().toLowerCase();
    if (PUBLIC_DOMAINS.has(domain)) {
      throw new ApiError('invalid_request', [{ field: 'domain', issue: 'Public email domains cannot be used' }]);
    }
    const grants = await this.rules.grantsOf(built);
    const auto = grants.has('company_domain.approve', { type: 'company_domain', tenantId, units: [companyId] });
    const id = await this.db.withActor({ principalId, correlationId }, async (tx) => {
      const [row] = await tx.query<{ id: string }>(
        `INSERT INTO company_domains (tenant_id, company_id, domain, status, requested_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [tenantId, companyId, domain, auto ? 'ACTIVE' : 'PENDING', principalId],
      );
      return row!.id;
    });
    return this.get(built, id);
  }

  // Chuyển trạng thái hợp lệ do trigger company_domains_before bảo đảm; sai thì 409.
  async transition(
    built: BuiltContext,
    id: string,
    to: Extract<DomainStatus, 'ACTIVE' | 'REJECTED' | 'REVOKED'>,
  ): Promise<DomainDto> {
    const { tenantId, principalId, correlationId } = built.context;
    await this.db.withActor({ principalId, correlationId }, async (tx) => {
      const from = to === 'REVOKED' ? 'ACTIVE' : 'PENDING';
      const rows = await tx.query(
        `UPDATE company_domains SET status = $3 WHERE tenant_id = $1 AND id = $2 AND status = $4 RETURNING id`,
        [tenantId, id, to, from],
      );
      if (rows.length === 0) throw new ApiError('conflict'); // không đúng trạng thái xuất phát (SPEC §6.5)
    });
    return this.get(built, id);
  }

  private query(tenantId: string, where: string, params: unknown[]): Promise<DomainRow[]> {
    return this.db.query<DomainRow>(
      `SELECT d.id, d.company_id, d.domain, d.status, d.requested_by AS requester_id, p.display_name AS requester_name,
              d.created_at, d.decided_at,
              (SELECT count(*) FROM principals u WHERE u.email_domain = d.domain) AS affected
         FROM company_domains d LEFT JOIN principals p ON p.id = d.requested_by
        WHERE d.tenant_id = $1 AND ${where}
        ORDER BY d.created_at DESC, d.domain`,
      [tenantId, ...params],
    );
  }

  private toDto(r: DomainRow, grants: GrantSet, tenantId: string): DomainDto {
    const attrs = { type: 'company_domain', id: r.id, tenantId, units: [r.company_id] };
    const actions: DomainAction[] = [];
    if (r.status === 'PENDING' && grants.has('company_domain.approve', attrs)) actions.push('approve', 'reject');
    if (r.status === 'ACTIVE' && grants.has('company_domain.manage', attrs)) actions.push('revoke');
    return {
      id: r.id,
      companyId: r.company_id,
      domain: r.domain,
      status: r.status,
      requestedBy: r.requester_id ? { id: r.requester_id, displayName: r.requester_name ?? '' } : null,
      createdAt: r.created_at.toISOString(),
      decidedAt: r.decided_at?.toISOString() ?? null,
      affectedUsers: Number(r.affected),
      _actions: actions,
    };
  }
}
