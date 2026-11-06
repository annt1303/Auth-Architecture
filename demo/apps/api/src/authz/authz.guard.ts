import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { EvaluationResult, ResourceAttrs } from '@authz-demo/authz-types';
import type { Request } from 'express';
import { ApiError, ERROR_STATUS } from '../common/api-error.js';
import { SessionService } from '../session/session.service.js';
import {
  type BuiltContext,
  ContextBuilder,
  ContextUnavailableError,
} from './context-builder.service.js';
import { DecisionAudit } from './decision-audit.service.js';
import { AUTHZ_ROUTE, type RouteAuthz } from './decorators.js';
import { Pdp } from './pdp.service.js';
import { ResourceResolver } from './resources.js';

// Policy Enforcement Point: chạy cho mọi route (APP_GUARD), theo thứ tự của tài liệu gốc §12.2:
// xác thực -> ngữ cảnh và tenant -> nạp tài nguyên -> PDP -> ánh xạ HTTP.
// Không có ALLOW tường minh thì không có hành động nào.
@Injectable()
export class AuthzGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    private readonly contexts: ContextBuilder,
    private readonly pdp: Pdp,
    private readonly resources: ResourceResolver,
    private readonly audit: DecisionAudit,
  ) {}

  async canActivate(execution: ExecutionContext): Promise<boolean> {
    const route = this.reflector.get<RouteAuthz | undefined>(AUTHZ_ROUTE, execution.getHandler());
    if (!route) throw new ApiError('internal_error'); // route-coverage.ts ngăn trường hợp này lúc khởi động
    if (route.kind === 'public') return true;

    const req = execution.switchToHttp().getRequest<Request>();
    const session = await this.sessions.validate(req);
    if (!session) throw new ApiError('unauthenticated');
    req.principalId = session.principalId;
    if (route.kind === 'authenticated') return true;

    let built: BuiltContext;
    try {
      built = await this.contexts.build(session, req);
    } catch (err) {
      if (!(err instanceof ContextUnavailableError)) throw err;
      const failed: EvaluationResult = {
        state: 'INDETERMINATE',
        reasonCode: err.reason,
        matchedGrantIds: [],
        failedDependency: err.reason === 'EVALUATION_FAILURE' ? 'database' : undefined,
      };
      throw this.deny(null, req, route.action, null, failed, false);
    }
    req.authz = { built };

    // B1, B2 trước khi nạp tài nguyên: người không còn quyền vào tenant nhận
    // tenant_access_denied, không bao giờ nhận 404 tiết lộ tài nguyên có tồn tại hay không.
    const subjectDenied = this.pdp.evaluateSubject(built);
    if (subjectDenied) throw this.deny(built, req, route.action, null, subjectDenied, false);

    if (route.kind === 'collection') {
      const scope = await this.pdp.resolveDataScope(built, route.action);
      if (scope.result.state !== 'ALLOW' || !scope.plan) {
        // Hoàn toàn không có quyền liệt kê: 403 (tài liệu gốc §12.3)
        throw this.deny(built, req, route.action, null, scope.result, true);
      }
      req.authz.plan = scope.plan;
      return true;
    }

    let resolved;
    try {
      resolved = await this.resources.resolve(route.resource, req, built.context.tenantId);
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw this.deny(built, req, route.action, null, dbFailure(), false);
    }
    if (!resolved) throw new ApiError('not_found');

    const decision = await this.pdp.check(built, route.action, resolved.attrs);
    if (decision.state === 'ALLOW') {
      req.authz.resource = resolved;
      return true;
    }
    // Bị từ chối: nhìn thấy được thì 403, không nhìn thấy thì 404 giống hệt "không tồn tại".
    let visible = false;
    if (decision.state !== 'INDETERMINATE') {
      const v = await this.pdp.check(built, resolved.visibility.action, resolved.visibility.attrs);
      if (v.state === 'INDETERMINATE') throw this.deny(built, req, route.action, resolved.attrs, v, false);
      visible = v.state === 'ALLOW';
    }
    throw this.deny(built, req, route.action, resolved.attrs, decision, visible);
  }

  private deny(
    built: BuiltContext | null,
    req: Request,
    action: string,
    resource: ResourceAttrs | null,
    evaluation: EvaluationResult,
    visible: boolean,
  ): ApiError {
    const error = toHttpError(evaluation, visible);
    this.audit.recordDenied({
      built,
      correlationId: req.correlationId,
      action,
      resource,
      evaluation,
      httpStatus: ERROR_STATUS[error.code],
    });
    return error;
  }
}

const dbFailure = (): EvaluationResult => ({
  state: 'INDETERMINATE',
  reasonCode: 'EVALUATION_FAILURE',
  matchedGrantIds: [],
  failedDependency: 'database',
});

// Ánh xạ kết quả nội bộ sang HTTP (tài liệu gốc §12.3, SPEC §11). INDETERMINATE không bao giờ là 403/404.
export function toHttpError(evaluation: EvaluationResult, visible: boolean): ApiError {
  switch (evaluation.reasonCode) {
    case 'NOT_A_MEMBER':
    case 'TENANT_SUSPENDED':
      return new ApiError('tenant_access_denied');
    case 'PRINCIPAL_INACTIVE':
      return new ApiError('forbidden');
  }
  if (evaluation.state === 'INDETERMINATE') {
    return new ApiError(evaluation.failedDependency ? 'authorization_unavailable' : 'internal_error');
  }
  return new ApiError(visible ? 'forbidden' : 'not_found');
}
