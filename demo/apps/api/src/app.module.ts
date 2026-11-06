import { type DynamicModule, Global, Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module.js';
import { AuthzModule } from './authz/authz.module.js';
import { CONFIG, type Config } from './config/config.js';
import { Db } from './db/db.js';
import { DocumentsController } from './documents/documents.controller.js';
import { DocumentsService } from './documents/documents.service.js';
import { MeController } from './me/me.controller.js';
import { OrgUnitsController } from './org-units/org-units.controller.js';
import { OrgUnitsService } from './org-units/org-units.service.js';
import { AssignmentsController } from './assignments/assignments.controller.js';
import { AssignmentsService } from './assignments/assignments.service.js';
import { AuditController } from './audit/audit.controller.js';
import { AuditService } from './audit/audit.service.js';
import { DomainsController } from './domains/domains.controller.js';
import { DomainsService } from './domains/domains.service.js';
import { EffectiveService } from './me/effective.service.js';
import { RolesController } from './roles/roles.controller.js';
import { RolesService } from './roles/roles.service.js';
import { UsersController } from './users/users.controller.js';
import { UsersService } from './users/users.service.js';
import { AuthzToolsController } from './authz-tools/authz-tools.controller.js';
import { AuthzToolsService } from './authz-tools/authz-tools.service.js';

@Global()
@Module({})
class CoreModule {
  static register(config: Config): DynamicModule {
    return {
      module: CoreModule,
      providers: [{ provide: CONFIG, useValue: config }, Db],
      exports: [CONFIG, Db],
    };
  }
}

@Module({})
export class AppModule {
  static register(config: Config): DynamicModule {
    return {
      module: AppModule,
      imports: [CoreModule.register(config), AuthzModule, AuthModule.register(config)],
      controllers: [
        MeController,
        OrgUnitsController,
        DocumentsController,
        DomainsController,
        UsersController,
        RolesController,
        AssignmentsController,
        AuditController,
        AuthzToolsController,
      ],
      providers: [
        DocumentsService,
        OrgUnitsService,
        EffectiveService,
        DomainsService,
        UsersService,
        RolesService,
        AssignmentsService,
        AuditService,
        AuthzToolsService,
      ],
    };
  }
}
