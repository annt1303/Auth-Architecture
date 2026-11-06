import { Inject, Injectable } from '@nestjs/common';
import type { TrustedContext } from '@authz-demo/authz-types';
import type { Request } from 'express';
import { CONFIG, type Config } from '../config/config.js';
import { Db } from '../db/db.js';
import type { ValidSession } from '../session/session.service.js';

// Thuộc tính của chủ thể, đọc từ nguồn có thẩm quyền (tài liệu gốc §10.2).
// null = không có dòng: đó là một giá trị đã xác định (PDP từ chối), không phải lỗi.
export type SubjectAttrs = {
  principalStatus: 'ACTIVE' | 'DISABLED' | null;
  tenantStatus: 'ACTIVE' | 'SUSPENDED';
  membershipStatus: 'ACTIVE' | 'SUSPENDED' | 'REMOVED' | null;
};

export type BuiltContext = { context: TrustedContext; subject: SubjectAttrs };

export class ContextUnavailableError extends Error {
  constructor(readonly reason: 'MISSING_REQUIRED_ATTRIBUTE' | 'EVALUATION_FAILURE') {
    super(reason);
  }
}

@Injectable()
export class ContextBuilder {
  constructor(
    private readonly db: Db,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  // Tenant lấy từ cấu hình (app chỉ có 1 tenant), nhưng membership vẫn được đọc lại mỗi request.
  // Một lần tra trả lời cả trạng thái principal, tenant và membership (tài liệu gốc §10.3).
  async build(session: ValidSession, req: Request): Promise<BuiltContext> {
    return this.buildFor(session.principalId, session.createdAt, req.correlationId, req.socket.remoteAddress);
  }

  // Dựng ngữ cảnh cho một principal bất kỳ, không cần session: Simulator đánh giá thay người khác (SPEC §12).
  async buildFor(principalId: string, authenticatedAt: Date, correlationId: string, sourceIp?: string): Promise<BuiltContext> {
    let rows: {
      tenant_id: string;
      tenant_status: SubjectAttrs['tenantStatus'];
      principal_status: SubjectAttrs['principalStatus'];
      membership_status: SubjectAttrs['membershipStatus'];
    }[];
    try {
      rows = await this.db.query(
        `SELECT t.id AS tenant_id, t.status AS tenant_status,
                p.status AS principal_status, m.status AS membership_status
           FROM tenants t
           LEFT JOIN principals p ON p.id = $1
           LEFT JOIN tenant_memberships m ON m.tenant_id = t.id AND m.principal_id = $1
          WHERE t.key = $2`,
        [principalId, this.config.TENANT_KEY],
      );
    } catch {
      throw new ContextUnavailableError('EVALUATION_FAILURE');
    }
    const row = rows[0];
    if (!row) throw new ContextUnavailableError('MISSING_REQUIRED_ATTRIBUTE');

    return {
      context: {
        tenantId: row.tenant_id,
        principalId,
        principalType: 'USER',
        actorId: principalId,
        authentication: {
          method: this.config.AUTH_PROVIDER,
          authenticatedAt: authenticatedAt.toISOString(),
          assuranceLevel: 'BASIC',
        },
        environment: {
          requestTime: new Date().toISOString(),
          sourceIp,
        },
        correlationId,
      },
      subject: {
        principalStatus: row.principal_status,
        tenantStatus: row.tenant_status,
        membershipStatus: row.membership_status,
      },
    };
  }
}
