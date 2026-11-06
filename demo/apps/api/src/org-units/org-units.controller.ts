import { Body, Controller, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import type { AuthzPlan, OrgUnitTreeDto } from '@authz-demo/authz-types';
import { z } from 'zod';
import { parseInput } from '../common/api-error.js';
import { Authorize, AuthorizeCollection, AuthzContext, DataScope } from '../authz/decorators.js';
import type { BuiltContext } from '../authz/context-builder.service.js';
import { OrgUnitsService } from './org-units.service.js';

const Code = z.string().trim().regex(/^[A-Z0-9][A-Z0-9_-]*$/, 'Use A-Z, 0-9, _ and -').max(64);
const Name = z.string().trim().min(1).max(200);

const CreateBody = z.object({
  parentId: z.uuid().nullish(),
  unitType: z.enum(['COMPANY', 'DEPARTMENT', 'TEAM']),
  code: Code,
  name: Name,
});
const UpdateBody = z.object({ name: Name });

@Controller('org-units')
export class OrgUnitsController {
  constructor(private readonly orgUnits: OrgUnitsService) {}

  // Danh sách phẳng các đơn vị nhìn thấy được; client tự dựng cây từ parentId.
  // Đơn vị có cha không nhìn thấy được thì client coi là gốc.
  @Get()
  @AuthorizeCollection('org_unit.read', 'org_unit')
  list(@AuthzContext() built: BuiltContext, @DataScope() plan: AuthzPlan): Promise<OrgUnitTreeDto[]> {
    return this.orgUnits.listWithActions(built, plan);
  }

  // Cha là đích: quyền org_unit.manage phải bao phủ cha (SPEC §10.8). Không có cha = công ty gốc, chỉ TENANT.
  @Post()
  @Authorize('org_unit.manage', 'org_unit_parent')
  create(@AuthzContext() built: BuiltContext, @Body() body: unknown): Promise<OrgUnitTreeDto> {
    return this.orgUnits.create(built, parseInput(CreateBody, body));
  }

  @Patch(':id')
  @Authorize('org_unit.manage', 'org_unit')
  update(@AuthzContext() built: BuiltContext, @Param('id') id: string, @Body() body: unknown): Promise<OrgUnitTreeDto> {
    return this.orgUnits.rename(built, id, parseInput(UpdateBody, body).name);
  }

  @Post(':id/archive')
  @HttpCode(200)
  @Authorize('org_unit.manage', 'org_unit')
  archive(@AuthzContext() built: BuiltContext, @Param('id') id: string): Promise<OrgUnitTreeDto> {
    return this.orgUnits.archive(built, id);
  }
}
