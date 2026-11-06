import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import type { AuthzPlan, DocumentDto, OrgUnitDto } from '@authz-demo/authz-types';
import { z } from 'zod';
import { parseInput } from '../common/api-error.js';
import type { BuiltContext } from '../authz/context-builder.service.js';
import { Authorize, AuthorizeCollection, AuthzContext, DataScope } from '../authz/decorators.js';
import { OrgUnitsService } from '../org-units/org-units.service.js';
import { DocumentsService } from './documents.service.js';

const Status = z.enum(['DRAFT', 'PUBLISHED']);

const ListQuery = z.object({
  status: Status.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const CreateBody = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().max(20_000).default(''),
  status: Status.default('DRAFT'),
  orgUnitId: z.uuid(),
});

const UpdateBody = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    body: z.string().max(20_000).optional(),
    status: Status.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' });

// Mỗi handler chỉ chạy sau khi PEP (AuthzGuard) đã cho phép; :id đã được nạp và kiểm tra ở đó.
@Controller('documents')
export class DocumentsController {
  constructor(
    private readonly documents: DocumentsService,
    private readonly orgUnits: OrgUnitsService,
  ) {}

  @Get()
  @AuthorizeCollection('document.read', 'document')
  list(
    @AuthzContext() built: BuiltContext,
    @DataScope() plan: AuthzPlan,
    @Query() query: unknown,
  ): Promise<DocumentDto[]> {
    return this.documents.list(built, plan, parseInput(ListQuery, query));
  }

  // Đơn vị đích mà người dùng được tạo tài liệu (cây trong form tạo). Cùng FilterPlan với
  // document.create, đánh giá trên org_units: grant RESOURCE và SELF không cho đơn vị nào (SPEC §10.9).
  // Không có quyền tạo ở đâu thì 403, UI ẩn nút Tạo. Phải khai báo trước ':id'.
  @Get('destinations')
  @AuthorizeCollection('document.create', 'org_unit')
  destinations(@AuthzContext() built: BuiltContext, @DataScope() plan: AuthzPlan): Promise<OrgUnitDto[]> {
    return this.orgUnits.list(built, plan);
  }

  @Get(':id')
  @Authorize('document.read', 'document')
  get(@AuthzContext() built: BuiltContext, @Param('id') id: string): Promise<DocumentDto> {
    return this.documents.get(built, id);
  }

  @Post()
  @Authorize('document.create', 'document_destination')
  create(@AuthzContext() built: BuiltContext, @Body() body: unknown): Promise<DocumentDto> {
    return this.documents.create(built, parseInput(CreateBody, body));
  }

  @Patch(':id')
  @Authorize('document.update', 'document')
  update(@AuthzContext() built: BuiltContext, @Param('id') id: string, @Body() body: unknown): Promise<DocumentDto> {
    return this.documents.update(built, id, parseInput(UpdateBody, body));
  }

  @Delete(':id')
  @Authorize('document.delete', 'document')
  @HttpCode(204)
  remove(@AuthzContext() built: BuiltContext, @Param('id') id: string): Promise<void> {
    return this.documents.remove(built, id);
  }
}
