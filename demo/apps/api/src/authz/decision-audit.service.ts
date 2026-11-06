import { Injectable, Logger } from '@nestjs/common';
import type { EvaluationResult, ResourceAttrs } from '@authz-demo/authz-types';
import { Db } from '../db/db.js';
import type { BuiltContext } from './context-builder.service.js';

// Audit lớp B (SPEC §13): ghi sau khi đã có quyết định, tốt nhất có thể.
// Ghi thất bại không đổi kết quả: sự từ chối vẫn giữ nguyên.
@Injectable()
export class DecisionAudit {
  private readonly logger = new Logger('DecisionAudit');
  lostEvents = 0;

  constructor(private readonly db: Db) {}

  recordDenied(input: {
    built: BuiltContext | null;
    correlationId: string;
    action: string | null;
    resource: ResourceAttrs | null;
    evaluation: EvaluationResult;
    httpStatus: number;
  }): void {
    const { built, evaluation } = input;
    this.insert({
      eventType: evaluation.state === 'INDETERMINATE' ? 'access.evaluation_failed' : 'access.denied',
      tenantId: built?.context.tenantId ?? null,
      orgUnitId: input.resource?.units[0] ?? null,
      actorId: built?.context.principalId ?? null,
      correlationId: input.correlationId,
      targetType: input.resource?.type ?? null,
      targetId: input.resource?.id ?? null,
      payload: {
        action: input.action,
        state: evaluation.state,
        reason_code: evaluation.reasonCode,
        failed_dependency: evaluation.failedDependency ?? null,
        http_status: input.httpStatus,
      },
    });
  }

  // Ràng buộc quản trị (SPEC §10) trượt: DENY / CONSTRAINT_FAILED, kèm id ràng buộc (chỉ nằm trong audit).
  recordConstraintFailed(input: {
    built: BuiltContext;
    correlationId: string;
    action: string;
    resource: ResourceAttrs | null;
    constraint: string;
    detail?: unknown;
  }): void {
    this.insert({
      eventType: 'access.denied',
      tenantId: input.built.context.tenantId,
      orgUnitId: input.resource?.units[0] ?? null,
      actorId: input.built.context.principalId,
      correlationId: input.correlationId,
      targetType: input.resource?.type ?? null,
      targetId: input.resource?.id ?? null,
      payload: {
        action: input.action,
        state: 'DENY',
        reason_code: 'CONSTRAINT_FAILED',
        constraint: input.constraint,
        detail: input.detail ?? null,
        http_status: 403,
      },
    });
  }

  recordLoginDenied(input: {
    tenantKey: string;
    correlationId: string;
    reason: string;
    provider: string;
    subject: string;
    email: string;
  }): void {
    this.insert({
      eventType: 'auth.login_denied',
      tenantKey: input.tenantKey,
      orgUnitId: null,
      actorId: null,
      correlationId: input.correlationId,
      targetType: 'principal',
      targetId: null,
      payload: { reason: input.reason, provider: input.provider, subject: input.subject, email: input.email },
    });
  }

  private insert(e: {
    eventType: string;
    tenantId?: string | null;
    tenantKey?: string;
    orgUnitId: string | null;
    actorId: string | null;
    correlationId: string;
    targetType: string | null;
    targetId: string | null;
    payload: Record<string, unknown>;
  }): void {
    this.db
      .query(
        `INSERT INTO audit_events (event_class, event_type, tenant_id, org_unit_id, actor_id, actor_attributed,
                                   correlation_id, target_type, target_id, payload)
         VALUES ('B', $1, coalesce($2::uuid, (SELECT id FROM tenants WHERE key = $3)), $4::uuid, $5::uuid, $5::uuid IS NOT NULL,
                 $6, $7, $8, $9)`,
        [
          e.eventType,
          e.tenantId ?? null,
          e.tenantKey ?? null,
          e.orgUnitId,
          e.actorId,
          e.correlationId,
          e.targetType,
          e.targetId,
          e.payload,
        ],
      )
      .catch((err: unknown) => {
        this.lostEvents += 1;
        this.logger.warn(`audit event lost (${e.eventType}, ${e.correlationId}): ${String(err)}`);
      });
  }
}
