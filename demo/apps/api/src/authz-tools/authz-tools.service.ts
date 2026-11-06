import { Injectable } from '@nestjs/common';
import type {
  DecisionTrace, EffectiveMatrixDto, ErrorCode, EvaluationResult, ResourceAttrs, ResourceRef, ScopeType,
  SimulateRequest, TraceStepId, WhoCanDto,
} from '@authz-demo/authz-types';
import { AdminRules, type ConstraintResult } from '../authz/admin-rules.service.js';
import { toHttpError } from '../authz/authz.guard.js';
import { PermissionCatalog } from '../authz/catalog.service.js';
import { type BuiltContext, ContextBuilder } from '../authz/context-builder.service.js';
import { Pdp } from '../authz/pdp.service.js';
import { type ResolvedResource, ResourceResolver } from '../authz/resources.js';
import { ApiError, ERROR_STATUS } from '../common/api-error.js';
import { SCOPE_LABEL_COLUMN, SCOPE_LABEL_JOINS, toScopeDto } from '../common/scope-label.js';
import { Db } from '../db/db.js';

type Step = DecisionTrace['steps'][number];

// Simulator, ma trận quyền, "Ai có quyền" (SPEC §12, §14). Chạy đúng đường đánh giá của PEP
// (Pdp.evaluate, AdminRules, toHttpError) nên giải thích được mọi quyết định thật, không có luật riêng.
@Injectable()
export class AuthzToolsService {
  constructor(
    private readonly db: Db,
    private readonly pdp: Pdp,
    private readonly contexts: ContextBuilder,
    private readonly resources: ResourceResolver,
    private readonly rules: AdminRules,
    private readonly catalog: PermissionCatalog,
  ) {}

  async simulate(admin: BuiltContext, req: SimulateRequest): Promise<DecisionTrace> {
    const { tenantId, correlationId } = admin.context;
    const built = await this.memberContext(req.principalId, correlationId);
    const steps: Step[] = [];
    const grants: DecisionTrace['grants'] = [];
    const constraints: DecisionTrace['constraints'] = [];
    const trace = (evaluation: EvaluationResult, visible: boolean): DecisionTrace => {
      const done = new Set(steps.map((s) => s.id));
      for (const id of ORDER) if (!done.has(id)) steps.push({ id, outcome: 'SKIP' });
      steps.sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id));
      const error = evaluation.state === 'ALLOW' ? null : toHttpError(evaluation, visible);
      return {
        request: { principalId: req.principalId, action: req.action, resource: req.resource },
        steps,
        grants,
        constraints,
        result: {
          state: evaluation.state,
          reasonCode: evaluation.reasonCode,
          httpStatus: error ? ERROR_STATUS[error.code] : 200,
          errorCode: (error?.code ?? null) as ErrorCode | null,
        },
      };
    };
    const step = (id: TraceStepId, outcome: Step['outcome'], detail?: unknown) =>
      steps.push({ id, outcome, ...(detail === undefined ? {} : { detail }) });

    // PA4: action có trong catalog
    if (!this.catalog.get(req.action)) {
      step('PA4', 'FAIL', { action: req.action });
      return trace({ state: 'INDETERMINATE', reasonCode: 'UNKNOWN_PERMISSION', matchedGrantIds: [] }, false);
    }
    step('PA4', 'PASS');

    // B1, B2: chủ thể
    const subject = this.pdp.evaluateSubject(built);
    step('B1', subject?.reasonCode === 'PRINCIPAL_INACTIVE' ? 'FAIL' : 'PASS', { principalStatus: built.subject.principalStatus });
    if (subject?.reasonCode === 'PRINCIPAL_INACTIVE') return trace(subject, false);
    step('B2', subject ? 'FAIL' : 'PASS', { tenantStatus: built.subject.tenantStatus, membershipStatus: built.subject.membershipStatus });
    if (subject) return trace(subject, false);

    // B4: nạp tài nguyên (không có thì 404 như PEP)
    const target = await this.target(req.action, req.resource, req.params, tenantId);
    if (!target) throw new ApiError('not_found');
    step('B4', 'PASS', { type: target.attrs.type, units: target.attrs.units.length });

    // C1: grant hiệu lực
    const ev = await this.pdp.evaluate(built, req.action, target.attrs);
    grants.push(...ev.grants.map((g) => ({ ...g, coversResource: g.covers })).map(({ covers: _c, ...g }) => g));
    if (ev.result.state === 'INDETERMINATE') {
      step('C1', 'FAIL');
      return trace(ev.result, false);
    }
    step('C1', 'PASS', { grants: ev.grants.length });

    // D3, D4: có grant, grant bao phủ
    const hasGrant = ev.grants.length > 0;
    const covered = ev.grants.some((g) => g.covers);
    step('D3', hasGrant ? 'PASS' : 'FAIL');
    if (hasGrant) step('D4', covered ? 'PASS' : 'FAIL', { covering: ev.grants.filter((g) => g.covers).length });

    // C2 / D5: ràng buộc quản trị, chỉ khi đã qua D4
    let evaluation = ev.result;
    if (ev.result.state === 'ALLOW') {
      const found = await this.constraintsFor(req, built, target.attrs, tenantId);
      if (found) {
        constraints.push(...found);
        const failed = found.some((c) => c.outcome === 'FAIL');
        step('C2', 'PASS', { evaluated: found.map((c) => c.id) });
        step('D5', failed ? 'FAIL' : 'PASS', failed ? { failed: found.filter((c) => c.outcome === 'FAIL').map((c) => c.id) } : undefined);
        if (failed) evaluation = { state: 'DENY', reasonCode: 'CONSTRAINT_FAILED', matchedGrantIds: ev.result.matchedGrantIds };
      } else {
        step('C2', 'SKIP');
      }
      if (evaluation.state === 'ALLOW') step('D6', 'PASS');
      return trace(evaluation, true);
    }

    // Bị từ chối: nhìn thấy được thì 403, không thì 404 (SPEC §11)
    const seen = await this.pdp.check(built, target.visibility.action, target.visibility.attrs);
    return trace(evaluation, seen.state === 'ALLOW');
  }

  // ---- Ma trận quyền × scope của một user (SPEC §14)
  async effective(admin: BuiltContext, principalId: string): Promise<EffectiveMatrixDto> {
    const { tenantId } = admin.context;
    const [who] = await this.db.query<{ id: string; email: string; display_name: string }>(
      `SELECT p.id, p.email, p.display_name FROM principals p
         JOIN tenant_memberships m ON m.principal_id = p.id AND m.tenant_id = $1 WHERE p.id = $2`,
      [tenantId, principalId],
    );
    if (!who) throw new ApiError('not_found');
    const perms = await this.db.query<{ key: string; risk_level: 'LOW' | 'HIGH'; tenant_scope_only: boolean }>(
      `SELECT key, risk_level, tenant_scope_only FROM permissions WHERE deprecated_at IS NULL ORDER BY key`,
    );
    const rows = await this.db.query<{
      key: string; assignment_id: string; role_key: string; role_name: string; scope_type: string; scope_id: string | null;
      scope_resource_type: string | null; scope_name: string | null;
    }>(
      `SELECT p.key, g.assignment_id, g.role_key, r.name AS role_name, g.scope_type, g.scope_id, g.scope_resource_type,
              ${SCOPE_LABEL_COLUMN}
         FROM permissions p
         CROSS JOIN LATERAL effective_grants($1::uuid, $2::uuid, p.key, now()) g
         JOIN roles r ON r.id = g.role_id
         ${SCOPE_LABEL_JOINS}
        ORDER BY p.key, r.level`,
      [tenantId, principalId],
    );
    return {
      principal: { id: who.id, displayName: who.display_name, email: who.email },
      rows: perms.map((p) => ({
        permission: p.key,
        riskLevel: p.risk_level,
        tenantScopeOnly: p.tenant_scope_only,
        grants: rows
          .filter((r) => r.key === p.key)
          .map((r) => ({ scope: toScopeDto(r), roleKey: r.role_key, roleName: r.role_name, assignmentId: r.assignment_id })),
      })),
    };
  }

  // ---- "Ai có quyền X trên tài nguyên Y" (SPEC §14): chạy PDP cho từng thành viên đang hoạt động
  async whoCan(admin: BuiltContext, action: string, resource: ResourceRef): Promise<WhoCanDto> {
    const { tenantId, correlationId } = admin.context;
    if (!this.catalog.get(action)) throw new ApiError('invalid_request', [{ field: 'action', issue: 'Unknown action' }]);
    const target = await this.target(action, resource, undefined, tenantId);
    if (!target) throw new ApiError('not_found');
    const people = await this.db.query<{ id: string; email: string; display_name: string }>(
      `SELECT p.id, p.email, p.display_name FROM principals p
         JOIN tenant_memberships m ON m.principal_id = p.id AND m.tenant_id = $1 AND m.status = 'ACTIVE'
        WHERE p.status = 'ACTIVE' ORDER BY p.display_name`,
      [tenantId],
    );
    const principals: WhoCanDto['principals'] = [];
    for (const p of people) {
      const built = await this.contexts.buildFor(p.id, new Date(), correlationId);
      const ev = await this.pdp.evaluate(built, action, target.attrs);
      if (ev.result.state !== 'ALLOW') continue;
      principals.push({
        id: p.id,
        displayName: p.display_name,
        email: p.email,
        via: ev.grants.filter((g) => g.covers).map((g) => ({ roleKey: g.roleKey, scopeLabel: g.scopeLabel })),
      });
    }
    return { action, resource: { ...resource, label: await this.label(resource, tenantId) }, principals };
  }

  // ---- hỗ trợ

  private async memberContext(principalId: string, correlationId: string): Promise<BuiltContext> {
    const built = await this.contexts.buildFor(principalId, new Date(), correlationId);
    if (built.subject.principalStatus === null) throw new ApiError('not_found');
    return built;
  }

  // Thuộc tính tài nguyên cho đánh giá, theo cùng quy ước với PEP (resources.ts).
  private async target(
    action: string,
    ref: ResourceRef,
    params: SimulateRequest['params'] | undefined,
    tenantId: string,
  ): Promise<ResolvedResource | null> {
    if (action === 'user_role.assign') {
      const scope = params?.scope;
      if (!scope) throw new ApiError('invalid_request', [{ field: 'params.scope', issue: 'Required for user_role.assign' }]);
      const units = await this.resources.scopeUnits(scope, tenantId);
      if (!units) return null;
      const attrs: ResourceAttrs = { type: 'assignment', tenantId, units };
      return { attrs, visibility: { action: 'org_unit.read', attrs: { type: 'org_unit', tenantId, units, anyScope: !units.length } } };
    }
    if (action === 'user.create') {
      const companyId = params?.companyId ?? (ref.type === 'org_unit' ? ref.id : undefined);
      return companyId ? this.resources.byRef({ type: 'org_unit', id: companyId }, tenantId).then((r) => r && { ...r, attrs: { ...r.attrs, type: 'user' } }) : null;
    }
    if (action === 'tenant_membership.manage' && ref.type === 'user' && ref.id) {
      const user = await this.resources.byRef(ref, tenantId);
      return user && { attrs: { type: 'tenant_membership', id: ref.id, tenantId, units: [] }, visibility: user.visibility };
    }
    // Hành động "create" trên một đơn vị đích: đích là org_unit, tài nguyên chưa tồn tại (SPEC §10.9)
    if (action.endsWith('.create') && ref.type === 'org_unit' && ref.id) {
      const unit = await this.resources.byRef(ref, tenantId);
      return unit && { attrs: { ...unit.attrs, type: action.split('.')[0]!, id: undefined }, visibility: unit.visibility };
    }
    return this.resources.byRef(ref, tenantId, action === 'role.manage');
  }

  private async constraintsFor(
    req: SimulateRequest,
    built: BuiltContext,
    attrs: ResourceAttrs,
    tenantId: string,
  ): Promise<ConstraintResult[] | null> {
    const params = req.params;
    switch (req.action) {
      case 'user_role.assign': {
        const userId = params?.targetUserId ?? (req.resource.type === 'user' ? req.resource.id : undefined);
        if (!userId || !params?.roleId || !params.scope) {
          throw new ApiError('invalid_request', [{ field: 'params', issue: 'targetUserId, roleId and scope are required' }]);
        }
        const role = await this.rules.loadRole(params.roleId, tenantId);
        if (!role) throw new ApiError('not_found');
        return this.rules.assign(built, await this.rules.grantsOf(built), { userId, role, scope: params.scope as { type: ScopeType; id?: string } });
      }
      case 'user_role.revoke': {
        if (!req.resource.id) return null;
        const [a] = await this.db.query<{ principal_id: string; key: string; level: number }>(
          `SELECT g.principal_id, r.key, r.level FROM tenant_role_assignments g JOIN roles r ON r.id = g.role_id
            WHERE g.tenant_id = $1 AND g.id = $2`,
          [tenantId, req.resource.id],
        );
        return a ? this.rules.revoke(built, await this.rules.grantsOf(built), { principalId: a.principal_id, roleKey: a.key, roleLevel: Number(a.level) }, attrs) : null;
      }
      case 'tenant_membership.manage':
        return req.resource.id ? this.rules.membership(built, await this.rules.grantsOf(built), req.resource.id) : null;
      case 'user.create': {
        const companyId = params?.companyId ?? attrs.units[0];
        return params?.email && companyId ? [await this.rules.emailDomain(tenantId, params.email, companyId)] : null;
      }
      case 'role.manage': {
        const role = req.resource.id ? await this.rules.loadRole(req.resource.id, tenantId) : null;
        return role
          ? this.rules.roleManage(await this.rules.grantsOf(built), attrs, { levels: [role.level], addedPermissions: [], systemRole: role.ownerKind === 'SYSTEM' })
          : null;
      }
      default:
        return null;
    }
  }

  private async label(ref: ResourceRef, tenantId: string): Promise<string> {
    if (!ref.id) return 'Toàn tổ chức';
    const sql: Record<string, string> = {
      document: 'SELECT title AS l FROM documents WHERE tenant_id = $1 AND id = $2',
      org_unit: 'SELECT name AS l FROM org_units WHERE tenant_id = $1 AND id = $2',
      user: 'SELECT p.display_name AS l FROM principals p JOIN tenant_memberships m ON m.principal_id = p.id WHERE m.tenant_id = $1 AND p.id = $2',
      role: 'SELECT name AS l FROM roles WHERE id = $2 AND (owner_kind = \'SYSTEM\' OR tenant_id = $1)',
      company_domain: 'SELECT domain AS l FROM company_domains WHERE tenant_id = $1 AND id = $2',
    };
    const q = sql[ref.type];
    const [row] = q ? await this.db.query<{ l: string }>(q, [tenantId, ref.id]) : [];
    return row?.l ?? ref.id;
  }
}

const ORDER: TraceStepId[] = ['PA4', 'B1', 'B2', 'B4', 'C1', 'C2', 'D3', 'D4', 'D5', 'D6'];
