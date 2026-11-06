import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import type { DecisionTrace, EffectiveMatrixDto, SimulateRequest, WhoCanDto } from '@authz-demo/authz-types';
import { z } from 'zod';
import { parseInput } from '../common/api-error.js';
import type { BuiltContext } from '../authz/context-builder.service.js';
import { Authorize, AuthzContext } from '../authz/decorators.js';
import { ScopeInput } from '../authz/resources.js';
import { AuthzToolsService } from './authz-tools.service.js';

const Resource = z.object({ type: z.string().trim().min(1).max(50), id: z.uuid().optional() });
const SimulateBody = z.object({
  principalId: z.uuid(),
  action: z.string().trim().min(1).max(100),
  resource: Resource,
  params: z
    .object({
      targetUserId: z.uuid().optional(),
      roleId: z.uuid().optional(),
      scope: ScopeInput.optional(),
      companyId: z.uuid().optional(),
      email: z.string().trim().max(254).optional(),
    })
    .optional(),
});
const EffectiveQuery = z.object({ principalId: z.uuid() });
const WhoCanQuery = z.object({
  action: z.string().trim().min(1).max(100),
  resourceType: z.string().trim().min(1).max(50),
  resourceId: z.uuid().optional(),
});

// Cả ba route chỉ dành cho người có authz_simulation.run (chỉ TENANT, SPEC §7.1)
@Controller('authz')
export class AuthzToolsController {
  constructor(private readonly tools: AuthzToolsService) {}

  @Post('simulate')
  @HttpCode(200)
  @Authorize('authz_simulation.run', 'tenant')
  simulate(@AuthzContext() built: BuiltContext, @Body() body: unknown): Promise<DecisionTrace> {
    return this.tools.simulate(built, parseInput(SimulateBody, body) as SimulateRequest);
  }

  @Get('effective')
  @Authorize('authz_simulation.run', 'tenant')
  effective(@AuthzContext() built: BuiltContext, @Query() query: unknown): Promise<EffectiveMatrixDto> {
    return this.tools.effective(built, parseInput(EffectiveQuery, query).principalId);
  }

  @Get('who-can')
  @Authorize('authz_simulation.run', 'tenant')
  whoCan(@AuthzContext() built: BuiltContext, @Query() query: unknown): Promise<WhoCanDto> {
    const q = parseInput(WhoCanQuery, query);
    return this.tools.whoCan(built, q.action, { type: q.resourceType, id: q.resourceId });
  }
}
