import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import type { DomainDto } from '@authz-demo/authz-types';
import { z } from 'zod';
import { parseInput } from '../common/api-error.js';
import type { BuiltContext } from '../authz/context-builder.service.js';
import { Authorize, AuthzContext } from '../authz/decorators.js';
import { DomainsService } from './domains.service.js';

const ProposeBody = z.object({
  domain: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^([a-z0-9-]+\.)+[a-z]{2,}$/, 'Not a valid domain name')
    .max(253),
});

// Vòng đời domain: PENDING -> ACTIVE | REJECTED; ACTIVE -> REVOKED (SPEC §6.5, §10.7)
@Controller()
export class DomainsController {
  constructor(private readonly domains: DomainsService) {}

  @Get('companies/:id/domains')
  @Authorize('org_unit.read', 'company')
  list(@AuthzContext() built: BuiltContext, @Param('id') id: string): Promise<DomainDto[]> {
    return this.domains.listForCompany(built, id);
  }

  @Post('companies/:id/domains')
  @Authorize('company_domain.manage', 'company')
  propose(@AuthzContext() built: BuiltContext, @Param('id') id: string, @Body() body: unknown): Promise<DomainDto> {
    return this.domains.propose(built, id, parseInput(ProposeBody, body).domain);
  }

  @Post('domains/:id/revoke')
  @HttpCode(200)
  @Authorize('company_domain.manage', 'company_domain')
  revoke(@AuthzContext() built: BuiltContext, @Param('id') id: string): Promise<DomainDto> {
    return this.domains.transition(built, id, 'REVOKED');
  }

  @Post('domains/:id/approve')
  @HttpCode(200)
  @Authorize('company_domain.approve', 'company_domain')
  approve(@AuthzContext() built: BuiltContext, @Param('id') id: string): Promise<DomainDto> {
    return this.domains.transition(built, id, 'ACTIVE');
  }

  @Post('domains/:id/reject')
  @HttpCode(200)
  @Authorize('company_domain.approve', 'company_domain')
  reject(@AuthzContext() built: BuiltContext, @Param('id') id: string): Promise<DomainDto> {
    return this.domains.transition(built, id, 'REJECTED');
  }
}
