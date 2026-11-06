import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import type { AuthzPlan, PermissionDto, RoleDto } from '@authz-demo/authz-types';
import { z } from 'zod';
import { parseInput } from '../common/api-error.js';
import type { BuiltContext } from '../authz/context-builder.service.js';
import { Authorize, AuthorizeCollection, AuthzContext, DataScope } from '../authz/decorators.js';
import { RolesService } from './roles.service.js';

const ListQuery = z.object({
  ownerKind: z.enum(['SYSTEM', 'TENANT', 'COMPANY']).optional(),
  level: z.coerce.number().int().min(1).max(5).optional(),
  status: z.enum(['ACTIVE', 'ARCHIVED']).optional(),
});
const Level = z.number().int().min(2).max(5); // custom role có level 2 đến 5 (SPEC §7.3)
const Permissions = z.array(z.string().min(1)).max(100);
const CreateBody = z.object({
  ownerKind: z.enum(['TENANT', 'COMPANY']),
  ownerCompanyId: z.uuid().nullish(),
  key: z.string().trim().regex(/^custom\.[a-z][a-z0-9_]*$/, 'Use custom.<lowercase_name>').max(64),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(500).nullish(),
  level: Level,
  permissions: Permissions.default([]),
});
const UpdateBody = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    level: Level.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' });
const PermissionsBody = z.object({ permissions: Permissions });

@Controller()
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  // Catalog quyền (màn Catalog). Ai đọc được role thì đọc được catalog.
  @Get('permissions')
  @AuthorizeCollection('role.read', 'role')
  permissions(): Promise<PermissionDto[]> {
    return this.roles.permissions();
  }

  @Get('roles')
  @AuthorizeCollection('role.read', 'role')
  list(@AuthzContext() built: BuiltContext, @DataScope() plan: AuthzPlan, @Query() query: unknown): Promise<RoleDto[]> {
    return this.roles.list(built, plan, parseInput(ListQuery, query));
  }

  @Get('roles/:id')
  @Authorize('role.read', 'role_read')
  get(@AuthzContext() built: BuiltContext, @Param('id') id: string): Promise<RoleDto> {
    return this.roles.get(built, id);
  }

  @Post('roles')
  @Authorize('role.manage', 'role_create')
  create(@AuthzContext() built: BuiltContext, @Body() body: unknown): Promise<RoleDto> {
    return this.roles.create(built, parseInput(CreateBody, body));
  }

  @Patch('roles/:id')
  @Authorize('role.manage', 'role_manage')
  update(@AuthzContext() built: BuiltContext, @Param('id') id: string, @Body() body: unknown): Promise<RoleDto> {
    return this.roles.update(built, id, parseInput(UpdateBody, body));
  }

  @Put('roles/:id/permissions')
  @Authorize('role.manage', 'role_manage')
  setPermissions(@AuthzContext() built: BuiltContext, @Param('id') id: string, @Body() body: unknown): Promise<RoleDto> {
    return this.roles.setPermissions(built, id, parseInput(PermissionsBody, body).permissions);
  }

  @Post('roles/:id/archive')
  @HttpCode(200)
  @Authorize('role.manage', 'role_manage')
  archive(@AuthzContext() built: BuiltContext, @Param('id') id: string): Promise<RoleDto> {
    return this.roles.archive(built, id);
  }
}
