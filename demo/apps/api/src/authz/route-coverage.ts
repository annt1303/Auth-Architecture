import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants.js';
import { DiscoveryService, MetadataScanner } from '@nestjs/core';
import { PermissionCatalog } from './catalog.service.js';
import { AUTHZ_ROUTE, type RouteAuthz } from './decorators.js';

// Mọi endpoint phải đi qua PEP (tài liệu gốc §25.1). Kiểm tra lúc khởi động:
//   - route nào thiếu decorator phân quyền -> app không khởi động;
//   - action nào không có trong permission catalog -> app không khởi động (tài liệu gốc §6.4).
@Injectable()
export class RouteCoverageCheck implements OnApplicationBootstrap {
  constructor(
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    private readonly catalog: PermissionCatalog,
  ) {}

  onApplicationBootstrap(): void {
    const problems = findRouteProblems(this.discovery, this.scanner, (a) => !!this.catalog.get(a));
    if (problems.length) {
      throw new Error(`Authorization coverage check failed:\n  - ${problems.join('\n  - ')}`);
    }
  }
}

export function findRouteProblems(
  discovery: DiscoveryService,
  scanner: MetadataScanner,
  inCatalog: (action: string) => boolean,
): string[] {
  const problems: string[] = [];
  for (const wrapper of discovery.getControllers()) {
    const proto = wrapper.metatype?.prototype as Record<string, unknown> | undefined;
    if (!proto) continue;
    for (const method of scanner.getAllMethodNames(proto)) {
      const handler = proto[method] as object;
      if (Reflect.getMetadata(PATH_METADATA, handler) === undefined) continue;
      const name = `${wrapper.name}.${method}`;
      const route = Reflect.getMetadata(AUTHZ_ROUTE, handler) as RouteAuthz | undefined;
      if (!route) {
        problems.push(`${name} has no authorization decorator`);
      } else if ((route.kind === 'entity' || route.kind === 'collection') && !inCatalog(route.action)) {
        problems.push(`${name} uses action "${route.action}" which is not in the permission catalog`);
      }
    }
  }
  return problems;
}
