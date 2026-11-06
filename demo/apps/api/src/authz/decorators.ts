import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthzPlan } from '@authz-demo/authz-types';
import type { Request } from 'express';
import type { BuiltContext } from './context-builder.service.js';
import type { ResolvedResource, ResourceKind } from './resources.js';
import type { ScopedResourceType } from './data-scope.js';

// Mỗi route phải có đúng một decorator dưới đây; route thiếu decorator làm app
// không khởi động được (route-coverage.ts, SPEC §4). Đây là "mặc định từ chối" ở tầng route.
export const AUTHZ_ROUTE = 'authz:route';

export type RouteAuthz =
  | { kind: 'public' }
  | { kind: 'authenticated' }
  | { kind: 'entity'; action: string; resource: ResourceKind }
  | { kind: 'collection'; action: string; resourceType: ScopedResourceType };

function defineRoute(meta: RouteAuthz): MethodDecorator {
  return (_target, propertyKey, descriptor) => {
    if (Reflect.getMetadata(AUTHZ_ROUTE, descriptor.value as object)) {
      throw new Error(`${String(propertyKey)} has more than one authorization decorator`);
    }
    Reflect.defineMetadata(AUTHZ_ROUTE, meta, descriptor.value as object);
  };
}

/** Không cần đăng nhập (luồng đăng nhập, IdP giả lập). */
export const Public = () => defineRoute({ kind: 'public' });

/** Chỉ cần session hợp lệ; không gọi PDP. Dùng cho dữ liệu của chính mình (/me, logout). */
export const AuthenticatedOnly = () => defineRoute({ kind: 'authenticated' });

/** Hành động trên một tài nguyên: nạp tài nguyên rồi gọi Pdp.check (tài liệu gốc §12.2). */
export const Authorize = (action: string, resource: ResourceKind) =>
  defineRoute({ kind: 'entity', action, resource });

/** Danh sách: gọi Pdp.resolveDataScope và đưa FilterPlan cho handler (tài liệu gốc §13). */
export const AuthorizeCollection = (action: string, resourceType: ScopedResourceType) =>
  defineRoute({ kind: 'collection', action, resourceType });

export type RequestAuthz = {
  built: BuiltContext;
  resource?: ResolvedResource;
  plan?: AuthzPlan;
};

declare global {
  namespace Express {
    interface Request {
      authz?: RequestAuthz;
    }
  }
}

function fromRequest<T>(pick: (req: Request) => T | undefined, what: string) {
  return createParamDecorator((_data: unknown, ctx: ExecutionContext): T => {
    const value = pick(ctx.switchToHttp().getRequest<Request>());
    if (value === undefined) throw new Error(`${what} is not available on this route`);
    return value;
  })();
}

export const AuthzContext = () => fromRequest((req) => req.authz?.built, 'Authorization context');
export const DataScope = () => fromRequest((req) => req.authz?.plan, 'FilterPlan');
export const Resolved = () => fromRequest((req) => req.authz?.resource, 'Resolved resource');
export const PrincipalId = () => fromRequest((req) => req.principalId, 'Principal');
