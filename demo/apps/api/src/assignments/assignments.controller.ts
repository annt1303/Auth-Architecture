import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import type { AssignmentDto, AssignmentOptionsDto } from '@authz-demo/authz-types';
import { z } from 'zod';
import { parseInput } from '../common/api-error.js';
import type { BuiltContext } from '../authz/context-builder.service.js';
import { Authorize, AuthzContext } from '../authz/decorators.js';
import { ScopeInput } from '../authz/resources.js';
import { AssignmentsService } from './assignments.service.js';

const Time = z.iso.datetime({ offset: true }).nullable();
const Validity = z
  .object({ validFrom: Time.optional(), validUntil: Time.optional() })
  .refine((v) => !v.validFrom || !v.validUntil || new Date(v.validUntil) > new Date(v.validFrom), {
    message: 'validUntil must be after validFrom',
    path: ['validUntil'],
  });
const CreateBody = z
  .object({
    userId: z.uuid(),
    roleId: z.uuid(),
    scope: ScopeInput,
    validFrom: Time.optional(),
    validUntil: Time.optional(),
  })
  .refine((v) => ['TENANT', 'SELF'].includes(v.scope.type) === !v.scope.id, {
    message: 'scope.id is required for COMPANY / DEPARTMENT / TEAM / RESOURCE and forbidden for TENANT / SELF',
    path: ['scope', 'id'],
  })
  .refine((v) => !v.validFrom || !v.validUntil || new Date(v.validUntil) > new Date(v.validFrom), {
    message: 'validUntil must be after validFrom',
    path: ['validUntil'],
  });
const RevokeBody = z.object({ reason: z.string().trim().max(200).optional() });
const OptionsQuery = z.object({ userId: z.uuid() });

@Controller()
export class AssignmentsController {
  constructor(private readonly assignments: AssignmentsService) {}

  @Get('users/:id/assignments')
  @Authorize('user_role.read', 'user')
  forUser(@AuthzContext() built: BuiltContext, @Param('id') id: string): Promise<AssignmentDto[]> {
    return this.assignments.listForUser(built, id);
  }

  // Các cặp (role, scope) hợp lệ để gán cho user này, tính bằng chính quy tắc §10.1
  @Get('assignments/options')
  @Authorize('user_role.assign', 'user_query')
  options(@AuthzContext() built: BuiltContext, @Query() query: unknown): Promise<AssignmentOptionsDto> {
    return this.assignments.options(built, parseInput(OptionsQuery, query).userId);
  }

  @Post('assignments')
  @Authorize('user_role.assign', 'assignment_create')
  create(@AuthzContext() built: BuiltContext, @Body() body: unknown): Promise<AssignmentDto> {
    return this.assignments.create(built, parseInput(CreateBody, body));
  }

  @Patch('assignments/:id')
  @Authorize('user_role.assign', 'assignment')
  update(@AuthzContext() built: BuiltContext, @Param('id') id: string, @Body() body: unknown): Promise<AssignmentDto> {
    return this.assignments.updateValidity(built, id, parseInput(Validity, body));
  }

  @Post('assignments/:id/revoke')
  @HttpCode(200)
  @Authorize('user_role.revoke', 'assignment')
  revoke(@AuthzContext() built: BuiltContext, @Param('id') id: string, @Body() body: unknown): Promise<AssignmentDto> {
    return this.assignments.revoke(built, id, parseInput(RevokeBody, body ?? {}).reason ?? null);
  }
}
