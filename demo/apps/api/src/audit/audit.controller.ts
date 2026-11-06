import { Controller, Get, Query } from '@nestjs/common';
import type { AuditPageDto, AuthzPlan } from '@authz-demo/authz-types';
import { z } from 'zod';
import { parseInput } from '../common/api-error.js';
import type { BuiltContext } from '../authz/context-builder.service.js';
import { AuthorizeCollection, AuthzContext, DataScope } from '../authz/decorators.js';
import { AuditService } from './audit.service.js';

const Time = z.iso.datetime({ offset: true });
const Query_ = z.object({
  eventClass: z.enum(['A', 'B']).optional(),
  eventType: z.string().trim().max(100).optional(),
  actorId: z.uuid().optional(),
  targetType: z.string().trim().max(100).optional(),
  targetId: z.uuid().optional(),
  from: Time.optional(),
  to: Time.optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

@Controller('audit-events')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @AuthorizeCollection('authorization_audit.read', 'audit_event')
  list(@AuthzContext() built: BuiltContext, @DataScope() plan: AuthzPlan, @Query() query: unknown): Promise<AuditPageDto> {
    return this.audit.list(built, plan, parseInput(Query_, query));
  }
}
