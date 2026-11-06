import { Global, Module } from '@nestjs/common';
import { APP_GUARD, DiscoveryModule } from '@nestjs/core';
import { SessionModule } from '../session/session.module.js';
import { AuthzGuard } from './authz.guard.js';
import { PermissionCatalog } from './catalog.service.js';
import { ContextBuilder } from './context-builder.service.js';
import { DecisionAudit } from './decision-audit.service.js';
import { Pdp } from './pdp.service.js';
import { AdminRules } from './admin-rules.service.js';
import { ResourceResolver } from './resources.js';
import { RouteCoverageCheck } from './route-coverage.js';

@Global()
@Module({
  imports: [DiscoveryModule, SessionModule],
  providers: [
    PermissionCatalog,
    ContextBuilder,
    Pdp,
    ResourceResolver,
    DecisionAudit,
    AdminRules,
    RouteCoverageCheck,
    { provide: APP_GUARD, useClass: AuthzGuard },
  ],
  exports: [PermissionCatalog, ContextBuilder, Pdp, DecisionAudit, AdminRules, ResourceResolver],
})
export class AuthzModule {}
