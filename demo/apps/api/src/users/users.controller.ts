import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import type { AuthzPlan, EffectivePermissionDto, UserDto } from '@authz-demo/authz-types';
import { z } from 'zod';
import { parseInput } from '../common/api-error.js';
import type { BuiltContext } from '../authz/context-builder.service.js';
import { Authorize, AuthorizeCollection, AuthzContext, DataScope } from '../authz/decorators.js';
import { EffectiveService } from '../me/effective.service.js';
import { type MembershipOp, UsersService } from './users.service.js';

const ListQuery = z.object({
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
const CreateBody = z.object({
  email: z.string().trim().toLowerCase().regex(/^[^@\s]+@([a-z0-9-]+\.)+[a-z]{2,}$/, 'Not a valid email address').max(254),
  displayName: z.string().trim().min(1).max(200),
  companyId: z.uuid(),
  departmentId: z.uuid().nullish(),
});
const AddAffiliationBody = z.object({ companyId: z.uuid(), departmentId: z.uuid().nullish() });
const MoveAffiliationBody = z.object({ departmentId: z.uuid().nullable() });
const Op = z.object({ op: z.enum(['suspend', 'restore', 'remove', 'readd']) });

@Controller('users')
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly effective: EffectiveService,
  ) {}

  @Get()
  @AuthorizeCollection('user.read', 'user')
  list(@AuthzContext() built: BuiltContext, @DataScope() plan: AuthzPlan, @Query() query: unknown): Promise<UserDto[]> {
    return this.users.list(built, plan, parseInput(ListQuery, query));
  }

  @Get(':id')
  @Authorize('user.read', 'user')
  get(@AuthzContext() built: BuiltContext, @Param('id') id: string): Promise<UserDto> {
    return this.users.get(built, id);
  }

  // Quyền hiệu lực của user, cho tab "Quyền hiệu lực" (SPEC §14). Cùng quyền với xem assignment.
  @Get(':id/permissions')
  @Authorize('user_role.read', 'user')
  permissions(@AuthzContext() built: BuiltContext, @Param('id') id: string): Promise<EffectivePermissionDto[]> {
    return this.effective.permissions(built.context.tenantId, id);
  }

  @Post()
  @Authorize('user.create', 'user_create_target')
  create(@AuthzContext() built: BuiltContext, @Body() body: unknown): Promise<UserDto> {
    return this.users.create(built, parseInput(CreateBody, body));
  }

  @Post(':id/affiliations')
  @Authorize('user_affiliation.manage', 'user_affiliation')
  addAffiliation(@AuthzContext() built: BuiltContext, @Param('id') id: string, @Body() body: unknown): Promise<UserDto> {
    return this.users.addAffiliation(built, id, parseInput(AddAffiliationBody, body));
  }

  @Patch(':id/affiliations/:companyId')
  @Authorize('user_affiliation.manage', 'user_affiliation')
  moveAffiliation(
    @AuthzContext() built: BuiltContext,
    @Param('id') id: string,
    @Param('companyId') companyId: string,
    @Body() body: unknown,
  ): Promise<UserDto> {
    return this.users.moveAffiliation(built, id, companyId, parseInput(MoveAffiliationBody, body).departmentId);
  }

  @Delete(':id/affiliations/:companyId')
  @HttpCode(204)
  @Authorize('user_affiliation.manage', 'user_affiliation')
  removeAffiliation(
    @AuthzContext() built: BuiltContext,
    @Param('id') id: string,
    @Param('companyId') companyId: string,
  ): Promise<void> {
    return this.users.removeAffiliation(built, id, companyId);
  }

  @Post(':id/membership/:op')
  @HttpCode(200)
  @Authorize('tenant_membership.manage', 'user_membership')
  membership(@AuthzContext() built: BuiltContext, @Param('id') id: string, @Param() params: unknown): Promise<UserDto> {
    const { op } = parseInput(Op, params);
    return this.users.membership(built, id, op satisfies MembershipOp);
  }
}
