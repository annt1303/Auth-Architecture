import type { INestApplication } from '@nestjs/common';
import type {
  AssignmentDto, AssignmentOptionsDto, AuditPageDto, DomainDto, OrgUnitTreeDto, RoleDto, UserDto,
} from '@authz-demo/authz-types';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { createApp, login, loginAs, principalId, roleId, unitId, useIsolatedDb, withDb } from './helpers.js';

// Giai đoạn 2 (SPEC §18): tổ chức, domain, user, role, assignment, audit. Chạy trên bản sao riêng của DB
// vì các kịch bản ghi lên danh tính seed (SPEC §15: new.hire, lan, Hoa).
describe('Quản trị (SPEC §10, §12, §15)', () => {
  let app: INestApplication<App>;
  let cleanup: () => Promise<void>;
  const as: Record<string, string> = {};
  const call = (who: string, method: 'get' | 'post' | 'patch' | 'put' | 'delete', path: string, body?: object) => {
    const r = request(app.getHttpServer())[method](path).set('Cookie', as[who]!);
    return body ? r.send(body) : r;
  };
  const lastDenied = async (action: string) =>
    withDb(async (c) => {
      const { rows } = await c.query(
        `SELECT payload FROM audit_events WHERE event_class = 'B' AND payload->>'action' = $1 ORDER BY occurred_at DESC LIMIT 1`,
        [action],
      );
      return rows[0]?.payload as { reason_code: string; constraint?: string; detail?: { failed: string[] } } | undefined;
    });
  const settle = () => new Promise((r) => setTimeout(r, 150)); // audit lớp B ghi bất đồng bộ

  let alpha: string, alphaFin: string, alphaFinAp: string, beta: string;
  let tester: UserDto;

  beforeAll(async () => {
    cleanup = await useIsolatedDb();
    app = await createApp();
    for (const who of ['sysadmin', 'an', 'binh', 'chi', 'dung', 'giang', 'hoa', 'khanh', 'thao']) {
      as[who] = await loginAs(app, `mock|${who}`);
    }
    [alpha, alphaFin, alphaFinAp, beta] = await Promise.all(['ALPHA', 'ALPHA_FIN', 'ALPHA_FIN_AP', 'BETA'].map(unitId));
  });
  afterAll(async () => {
    await app.close();
    await cleanup();
  });

  describe('tạo user (§10.5)', () => {
    it('Bình tạo user trong ALPHA: principal, membership ACTIVE, affiliation, không có role', async () => {
      const res = await call('binh', 'post', '/users', {
        email: 'tester.one@alpha.test', displayName: 'Tester Một', companyId: alpha, departmentId: alphaFin,
      }).expect(201);
      tester = res.body;
      expect(tester.membershipStatus).toBe('ACTIVE');
      expect(tester.affiliations).toHaveLength(1);
      expect(tester.highestRole).toBeNull();
    });

    it('email trùng: 409 conflict', async () => {
      await call('binh', 'post', '/users', { email: 'tester.one@alpha.test', displayName: 'X', companyId: alpha }).expect(409);
    });

    it('domain không thuộc công ty đích: 403 và audit ghi EMAIL_DOMAIN', async () => {
      await call('binh', 'post', '/users', { email: 'x@beta.test', displayName: 'X', companyId: alpha }).expect(403);
      await settle();
      expect((await lastDenied('user.create'))?.constraint).toBe('EMAIL_DOMAIN');
    });

    it('công ty đích không nhìn thấy: 404; không có quyền user.create: 403 hoặc 404', async () => {
      await call('binh', 'post', '/users', { email: 'x@beta.test', displayName: 'X', companyId: beta }).expect(404);
      const dung = await call('dung', 'post', '/users', { email: 'y@alpha.test', displayName: 'Y', companyId: alpha });
      expect([403, 404]).toContain(dung.status);
    });

    it('new.hire: bị từ chối đăng nhập, Bình tạo xong thì đăng nhập được (§15)', async () => {
      expect((await login(app, 'mock|new-hire')).ok).toBe(false);
      await call('binh', 'post', '/users', { email: 'new.hire@alpha.test', displayName: 'Người mới', companyId: alpha }).expect(201);
      expect((await login(app, 'mock|new-hire')).ok).toBe(true);
    });
  });

  describe('gán role (§10.1)', () => {
    const assign = async (who: string, userId: string, role: Promise<string>, scope: object) =>
      call(who, "post", "/assignments", { userId, roleId: await role, scope });
    const status = async (p: Promise<{ status: number; body: any }>, expected: number) => {
      const r = await p;
      expect(r.status).toBe(expected);
      return r;
    };

    it('Bình gán department_manager (level 4) tại ALPHA_FIN: được', async () => {
      const res = await status(assign('binh', tester.id, roleId('department_manager'), { type: 'DEPARTMENT', id: alphaFin }), 201);
      expect((res.body as AssignmentDto).effective).toBe(true);
    });

    it('company_admin (level 3) cùng cấp với Bình: RANK', async () => {
      await status(assign('binh', tester.id, roleId('company_admin'), { type: 'COMPANY', id: alpha }), 403);
      await settle();
      expect((await lastDenied('user_role.assign'))?.detail?.failed).toContain('RANK');
    });

    it('member tại BETA: Bình không nhìn thấy BETA nên 404, audit ghi OUT_OF_SCOPE', async () => {
      await status(assign('binh', tester.id, roleId('member'), { type: 'COMPANY', id: beta }), 404);
      await settle();
      expect((await lastDenied('user_role.assign'))?.reason_code).toBe('OUT_OF_SCOPE');
    });

    it('custom.auditor (level 3): RANK dù Bình có đủ quyền của role này', async () => {
      await status(assign('binh', tester.id, roleId('custom.auditor'), { type: 'DEPARTMENT', id: alphaFin }), 403);
      await settle();
      expect((await lastDenied('user_role.assign'))?.detail?.failed).toContain('RANK');
    });

    it('role cấp tổ chức level 4 có tenant_membership.manage: qua RANK, trượt PERMISSION_SUBSET', async () => {
      await call('an', 'post', '/roles', {
        ownerKind: 'TENANT', key: 'custom.member_mgr', name: 'Quản lý thành viên', level: 4,
        permissions: ['tenant_membership.manage', 'user.read'],
      }).expect(201);
      await status(assign('binh', tester.id, roleId('custom.member_mgr'), { type: 'DEPARTMENT', id: alphaFin }), 403);
      await settle();
      const denied = await lastDenied('user_role.assign');
      expect(denied?.detail?.failed).toEqual(['PERMISSION_SUBSET']);
    });

    it('thu hồi company_admin của chính Bình: NOT_SELF (và RANK)', async () => {
      const mine = (await call('binh', 'get', `/users/${await principalId('binh.alpha@alpha.test')}/assignments`).expect(200)).body as AssignmentDto[];
      const adminA = mine.find((a) => a.role.key === 'company_admin')!;
      await call('binh', 'post', `/assignments/${adminA.id}/revoke`).expect(403);
      await settle();
      expect((await lastDenied('user_role.revoke'))?.detail?.failed).toEqual(expect.arrayContaining(['NOT_SELF', 'RANK']));
      // An (level 2) thu hồi được assignment của Bình thì Bình mất quyền; ở đây chỉ thử người khác
    });

    it('Chi (level 4) gán member (level 5) trong phòng mình được, gán department_manager thì không', async () => {
      await status(assign('chi', tester.id, roleId('member'), { type: 'TEAM', id: alphaFinAp }), 201);
      await status(assign('chi', tester.id, roleId('department_manager'), { type: 'TEAM', id: alphaFinAp }), 403);
    });

    it('không tự cấp cho chính mình: NOT_SELF', async () => {
      await status(assign('chi', await principalId('chi.fin@alpha.test'), roleId('member'), { type: 'SELF' }), 403);
    });

    it('system_admin không bao giờ gán được qua API', async () => {
      await status(assign('an', tester.id, roleId('system_admin'), { type: 'TENANT' }), 403);
      await settle();
      expect((await lastDenied('user_role.assign'))?.detail?.failed).toContain('SYSTEM_ADMIN_PROTECTED');
    });

    it('role công ty chỉ gán trong cây công ty chủ sở hữu (ROLE_ASSIGNABLE_HERE)', async () => {
      const em = await principalId('em.multi@alpha.test');
      const betaSales = await unitId('BETA_SALES');
      await status(assign('sysadmin', em, roleId('custom.finance_reviewer'), { type: 'DEPARTMENT', id: betaSales }), 403);
      await settle();
      expect((await lastDenied('user_role.assign'))?.detail?.failed).toContain('ROLE_ASSIGNABLE_HERE');
    });

    it('thời hạn không hợp lệ: 400', async () => {
      await call('binh', 'post', '/assignments', {
        userId: tester.id, roleId: await roleId('member'), scope: { type: 'DEPARTMENT', id: alphaFin },
        validFrom: '2030-01-02T00:00:00Z', validUntil: '2030-01-01T00:00:00Z',
      }).expect(400);
    });

    it('sửa thời hạn: thỏa cả điều kiện thu hồi và gán; thu hồi để lại lý do', async () => {
      const list = (await call('binh', 'get', `/users/${tester.id}/assignments`).expect(200)).body as AssignmentDto[];
      const dm = list.find((a) => a.role.key === 'department_manager')!;
      expect(dm._actions).toEqual(expect.arrayContaining(['revoke', 'update']));
      const patched = await call('binh', 'patch', `/assignments/${dm.id}`, { validUntil: '2031-01-01T00:00:00Z' }).expect(200);
      expect((patched.body as AssignmentDto).validUntil).toBe('2031-01-01T00:00:00.000Z');
      const revoked = await call('binh', 'post', `/assignments/${dm.id}/revoke`, { reason: 'test' }).expect(200);
      expect((revoked.body as AssignmentDto)).toMatchObject({ status: 'REVOKED', effective: false, ineffectiveReason: 'REVOKED' });
      await call('binh', 'post', `/assignments/${dm.id}/revoke`).expect(409); // đã thu hồi là trạng thái cuối
    });
  });

  describe('/assignments/options (§12)', () => {
    it('Bình: không có company_admin, system_admin hay role level 3; có department_manager trong cây ALPHA', async () => {
      const res = await call('binh', 'get', `/assignments/options?userId=${tester.id}`).expect(200);
      const roles = (res.body as AssignmentOptionsDto).roles;
      const keys = roles.map((r) => r.role.key);
      expect(keys).toContain('department_manager');
      expect(keys).not.toContain('company_admin');
      expect(keys).not.toContain('system_admin');
      const dm = roles.find((r) => r.role.key === 'department_manager')!;
      expect(dm.scopes.map((s) => s.label)).toContain('Alpha Tài chính');
      expect(dm.scopes.map((s) => s.label)).not.toContain('Beta Kinh doanh');
      expect(dm.scopes.some((s) => s.type === 'TENANT')).toBe(false);
    });

    it('Chi: chỉ role level 5 và chỉ trong phòng của mình', async () => {
      const res = await call('chi', 'get', `/assignments/options?userId=${tester.id}`).expect(200);
      const roles = (res.body as AssignmentOptionsDto).roles;
      expect(roles.every((r) => r.role.level === 5)).toBe(true);
      const labels = roles.flatMap((r) => r.scopes.map((s) => s.label));
      expect(labels).toContain("Alpha Tài chính"); // Team Công nợ phải trả đã được gán ở bài test trên nên không còn trong lựa chọn
      expect(labels).not.toContain("Alpha CNTT");
      expect(labels).not.toContain("Alpha Corp");
    });

    it('mọi lựa chọn trong options đều được API chấp nhận (cùng một bộ quy tắc)', async () => {
      const res = await call('chi', 'get', `/assignments/options?userId=${tester.id}`).expect(200);
      const first = (res.body as AssignmentOptionsDto).roles[0]!;
      const scope = first.scopes[0]!;
      await call('chi', 'post', '/assignments', {
        userId: tester.id, roleId: first.role.id, scope: { type: scope.type, id: scope.id },
      }).expect(201);
    });
  });

  describe('membership (§10.4)', () => {
    it('Hoa đang bị tạm ngưng: An khôi phục thì quyền cũ có hiệu lực lại (§15)', async () => {
      await call('hoa', 'get', '/documents').expect(403);
      const hoa = await principalId('hoa.log@alpha-log.test');
      const res = await call('an', 'post', `/users/${hoa}/membership/restore`).expect(200);
      expect((res.body as UserDto).membershipStatus).toBe('ACTIVE');
      const docs = await call('hoa', 'get', '/documents').expect(200);
      expect(docs.body.map((d: { title: string }) => d.title)).toContain('Kế hoạch vận hành kho');
    });

    it('chỉ cấp tổ chức mới quản lý membership: Bình bị 403', async () => {
      await call('binh', 'post', `/users/${tester.id}/membership/suspend`).expect(403);
    });

    it('không tạm ngưng được người cùng cấp hoặc cao hơn, và system admin được bảo vệ', async () => {
      const sys = await principalId('sysadmin@holding.test');
      await call('an', 'post', `/users/${sys}/membership/suspend`).expect(403);
      await settle();
      expect((await lastDenied('tenant_membership.manage'))?.detail?.failed).toEqual(
        expect.arrayContaining(['RANK', 'SYSTEM_ADMIN_PROTECTED']),
      );
      await call('an', 'post', `/users/${await principalId('an.tenant@holding.test')}/membership/suspend`).expect(403); // chính mình
    });

    it('chuyển trạng thái sai: 409; loại bỏ thu hồi mọi assignment, thêm lại thì chưa có role', async () => {
      await call('an', 'post', `/users/${tester.id}/membership/restore`).expect(409); // đang ACTIVE
      await call('an', 'post', `/users/${tester.id}/membership/suspend`).expect(200);
      await call('an', 'post', `/users/${tester.id}/membership/remove`).expect(200);
      const list = (await call('an', 'get', `/users/${tester.id}/assignments`).expect(200)).body as AssignmentDto[];
      expect(list.every((a) => a.status === 'REVOKED')).toBe(true);
      const back = await call('an', 'post', `/users/${tester.id}/membership/readd`).expect(200);
      expect((back.body as UserDto).membershipStatus).toBe('ACTIVE');
      expect((back.body as UserDto).highestRole).toBeNull();
    });
  });

  describe('affiliation (§10.6)', () => {
    it('admin công ty không kéo user công ty khác về mình: TARGET_VISIBLE', async () => {
      const giangId = await principalId('giang.beta@beta.test');
      await call("binh", "post", `/users/${giangId}/affiliations`, { companyId: alpha }).expect(403); // có quyền với ALPHA nhưng Giang ngoài phạm vi user.read
      await settle();
      expect((await lastDenied("user_affiliation.manage"))?.detail?.failed).toEqual(["TARGET_VISIBLE"]);
    });

    it('tenant admin thêm user vào công ty khác, đổi phòng ban, rồi gỡ (thu hồi assignment trong cây)', async () => {
      const em = await principalId('em.multi@alpha.test');
      const alphaLog = await unitId('ALPHA_LOG');
      await call('an', 'post', `/users/${em}/affiliations`, { companyId: alphaLog }).expect(201);
      const moved = await call('an', 'patch', `/users/${em}/affiliations/${alphaLog}`, { departmentId: await unitId('ALPHA_LOG_OPS') }).expect(200);
      expect((moved.body as UserDto).affiliations.some((a) => a.department?.code === 'ALPHA_LOG_OPS')).toBe(true);
      await call('an', 'delete', `/users/${em}/affiliations/${alphaLog}`).expect(204);
    });

    it("gỡ affiliation: từ chối cả thao tác nếu có assignment không thu hồi được; nếu được thì thu hồi cùng lúc", async () => {
      const t2 = (await call("binh", "post", "/users", { email: "tester.two@alpha.test", displayName: "Tester Hai", companyId: alpha, departmentId: alphaFin }).expect(201)).body as UserDto;
      const high = await call("an", "post", "/assignments", { userId: t2.id, roleId: await roleId("company_admin"), scope: { type: "DEPARTMENT", id: alphaFin } }).expect(201);
      await call("binh", "post", "/assignments", { userId: t2.id, roleId: await roleId("member"), scope: { type: "DEPARTMENT", id: alphaFin } }).expect(201);
      await call("binh", "delete", `/users/${t2.id}/affiliations/${alpha}`).expect(403); // company_admin cùng cấp Bình
      await settle();
      expect((await lastDenied("user_affiliation.manage"))?.detail?.failed).toContain("RANK");
      const still = (await call("an", "get", `/users/${t2.id}/assignments`).expect(200)).body as AssignmentDto[];
      expect(still.filter((a) => a.status === "ACTIVE")).toHaveLength(2); // không thu hồi gì cả
      await call("an", "post", `/assignments/${(high.body as AssignmentDto).id}/revoke`).expect(200);
      await call("binh", "delete", `/users/${t2.id}/affiliations/${alpha}`).expect(204);
      const after = (await call("an", "get", `/users/${t2.id}/assignments`).expect(200)).body as AssignmentDto[];
      expect(after.filter((a) => a.status === "ACTIVE")).toHaveLength(0);
      expect(after.filter((a) => a.role.key === "member").every((a) => a.revokeReason === "AFFILIATION_ENDED")).toBe(true);
    });
  });

  describe('domain (§10.7), kịch bản lan', () => {
    it('lan chưa đăng nhập được; An duyệt domain, Giang tạo user thì lan đăng nhập được (§15)', async () => {
      expect((await login(app, 'mock|partner')).ok).toBe(false);
      const betaId = beta;
      const list = (await call('giang', 'get', `/companies/${betaId}/domains`).expect(200)).body as DomainDto[];
      const pending = list.find((d) => d.domain === 'beta-partner.test')!;
      expect(pending.status).toBe('PENDING');
      expect(pending._actions).toEqual([]); // Giang đề xuất nhưng không được tự duyệt
      await call('giang', 'post', `/domains/${pending.id}/approve`).expect(403);
      const approved = await call('an', 'post', `/domains/${pending.id}/approve`).expect(200);
      expect((approved.body as DomainDto).status).toBe('ACTIVE');
      await call('giang', 'post', '/users', { email: 'lan@beta-partner.test', displayName: 'Lan', companyId: betaId }).expect(201);
      expect((await login(app, 'mock|partner')).ok).toBe(true);
    });

    it('domain công cộng bị chặn; domain trùng 409; thu hồi domain kèm số user bị ảnh hưởng', async () => {
      await call('giang', 'post', `/companies/${beta}/domains`, { domain: 'gmail.com' }).expect(400);
      await call('giang', 'post', `/companies/${beta}/domains`, { domain: 'beta.test' }).expect(409);
      const created = await call('giang', 'post', `/companies/${beta}/domains`, { domain: 'beta-two.test' }).expect(201);
      expect((created.body as DomainDto).status).toBe('PENDING');
      const auto = await call('an', 'post', `/companies/${beta}/domains`, { domain: 'beta-three.test' }).expect(201);
      expect((auto.body as DomainDto).status).toBe('ACTIVE'); // có cả company_domain.approve nên ACTIVE ngay
      const list = (await call('giang', 'get', `/companies/${beta}/domains`).expect(200)).body as DomainDto[];
      const betaDomain = list.find((d) => d.domain === 'beta.test')!;
      expect(betaDomain.affectedUsers).toBeGreaterThan(0);
      expect(betaDomain._actions).toContain('revoke');
      const revoked = await call('giang', 'post', `/domains/${betaDomain.id}/revoke`).expect(200);
      expect((revoked.body as DomainDto).status).toBe('REVOKED');
      await call('giang', 'post', `/domains/${betaDomain.id}/revoke`).expect(409); // REVOKED là trạng thái cuối
    });
  });

  describe('tổ chức (§10.8)', () => {
    it('Bình tạo, đổi tên và lưu trữ đơn vị trong cây của mình; không tạo được công ty gốc', async () => {
      const created = await call('binh', 'post', '/org-units', { parentId: alphaFin, unitType: 'TEAM', code: 'ALPHA_FIN_AR', name: 'Team Công nợ phải thu' }).expect(201);
      const unit = created.body as OrgUnitTreeDto;
      expect(unit._actions).toEqual(['manage']);
      const renamed = await call('binh', 'patch', `/org-units/${unit.id}`, { name: 'Team Phải thu' }).expect(200);
      expect((renamed.body as OrgUnitTreeDto).name).toBe('Team Phải thu');
      await call('binh', 'post', `/org-units/${unit.id}/archive`).expect(200);
      await call('binh', 'post', '/org-units', { unitType: 'COMPANY', code: 'GAMMA', name: 'Gamma' }).expect(403);
      await call('an', 'post', '/org-units', { unitType: 'COMPANY', code: 'GAMMA', name: 'Gamma' }).expect(201);
    });

    it('quy tắc lồng nhau do DB bảo đảm (team dưới công ty): 409; không lưu trữ khi còn đơn vị con hoặc tài liệu', async () => {
      await call('binh', 'post', '/org-units', { parentId: alpha, unitType: 'TEAM', code: 'BAD_TEAM', name: 'Sai' }).expect(409);
      await call('binh', 'post', `/org-units/${alphaFin}/archive`).expect(409);
    });

    it('đơn vị ngoài tầm: 404', async () => {
      await call('binh', 'patch', `/org-units/${beta}`, { name: 'Hack' }).expect(404);
    });
  });

  describe('role (§10.3)', () => {
    it('Bình tạo role công ty level 4 với quyền mình có; level 3 hoặc quyền tenant-only thì bị chặn', async () => {
      const ok = await call('binh', 'post', '/roles', {
        ownerKind: 'COMPANY', ownerCompanyId: alpha, key: 'custom.alpha_reader', name: 'Người đọc Alpha', level: 4,
        permissions: ['document.read', 'user.read'],
      }).expect(201);
      const role = ok.body as RoleDto;
      expect(role).toMatchObject({ ownerKind: 'COMPANY', level: 4, assignmentCount: 0 });
      expect(role._actions).toEqual(['update', 'archive']);
      await call('binh', 'post', '/roles', { ownerKind: 'COMPANY', ownerCompanyId: alpha, key: 'custom.l3', name: 'L3', level: 3, permissions: [] }).expect(403);
      await call('binh', 'post', '/roles', { ownerKind: 'COMPANY', ownerCompanyId: alpha, key: 'custom.hi', name: 'Hi', level: 5, permissions: ['authz_simulation.run'] }).expect(403);
      await call('binh', 'post', '/roles', { ownerKind: 'TENANT', key: 'custom.t', name: 'T', level: 5, permissions: [] }).expect(403);
      await call('binh', 'post', '/roles', { ownerKind: 'COMPANY', ownerCompanyId: alpha, key: 'custom.alpha_reader', name: 'Trùng', level: 5, permissions: [] }).expect(409);
    });

    it('sửa quyền: thêm quyền mình không có bị chặn, bớt quyền thì được; role hệ thống chỉ đọc', async () => {
      const roles = (await call('binh', 'get', '/roles').expect(200)).body as RoleDto[];
      const reader = roles.find((r) => r.key === 'custom.alpha_reader')!;
      await call('binh', 'put', `/roles/${reader.id}/permissions`, { permissions: ['document.read', 'authz_simulation.run'] }).expect(403);
      const trimmed = await call('binh', 'put', `/roles/${reader.id}/permissions`, { permissions: ['document.read'] }).expect(200);
      expect((trimmed.body as RoleDto).permissions).toEqual(['document.read']);
      await call('binh', 'patch', `/roles/${reader.id}`, { name: 'Đọc Alpha', level: 5 }).expect(200);
      const system = roles.find((r) => r.key === 'member')!;
      expect(system._actions).toEqual([]);
      await call('an', 'patch', `/roles/${system.id}`, { name: 'Hack' }).expect(403);
      await call('binh', 'post', `/roles/${reader.id}/archive`).expect(200);
      await call('binh', 'patch', `/roles/${reader.id}`, { name: 'Sau lưu trữ' }).expect(409);
    });

    it('role lưu trữ không gán mới được (ROLE_ASSIGNABLE_HERE)', async () => {
      const roles = (await call('binh', 'get', '/roles?status=ARCHIVED').expect(200)).body as RoleDto[];
      const archived = roles.find((r) => r.key === 'custom.alpha_reader')!;
      await call('binh', 'post', '/assignments', { userId: tester.id, roleId: archived.id, scope: { type: 'DEPARTMENT', id: alphaFin } }).expect(403);
    });

    it('danh sách role theo phạm vi (§8.2): Bình thấy role Alpha và role hệ thống, không thấy role công ty khác', async () => {
      const bk = ((await call('binh', 'get', '/roles').expect(200)).body as RoleDto[]).map((r) => r.key);
      expect(bk).toEqual(expect.arrayContaining(['member', 'custom.auditor', 'custom.finance_reviewer']));
      const gk = ((await call('giang', 'get', '/roles').expect(200)).body as RoleDto[]).map((r) => r.key);
      expect(gk).toContain('member');
      expect(gk).not.toContain('custom.finance_reviewer');
      const fin = ((await call('binh', 'get', '/roles').expect(200)).body as RoleDto[]).find((r) => r.key === 'custom.finance_reviewer')!;
      await call('giang', 'get', `/roles/${fin.id}`).expect(404);
      await call("chi", "get", `/roles/${fin.id}`).expect(200); // department_manager@ALPHA_FIN nằm trong cây Alpha
    });

    it('catalog quyền', async () => {
      const res = await call('dung', 'get', '/permissions').expect(200);
      expect(res.body).toHaveLength(19);
    });
  });

  describe('user: danh sách, chi tiết, quyền hiệu lực', () => {
    it('danh sách theo phạm vi: Dũng chỉ thấy mình, Bình thấy Alpha và Alpha Logistics, không thấy Beta', async () => {
      const dung = ((await call('dung', 'get', '/users').expect(200)).body as UserDto[]).map((u) => u.email);
      expect(dung).toEqual(['dung.ap@alpha.test']);
      const binh = ((await call('binh', 'get', '/users').expect(200)).body as UserDto[]).map((u) => u.email);
      expect(binh).toContain('hoa.log@alpha-log.test');
      expect(binh).not.toContain('giang.beta@beta.test');
    });

    it('chi tiết: 404 khi ngoài tầm nhìn; thấy user nhưng không xem được assignment thì 403', async () => {
      const giang = await principalId('giang.beta@beta.test');
      await call('binh', 'get', `/users/${giang}`).expect(404);
      await call('dung', 'get', `/users/${await principalId('dung.ap@alpha.test')}/assignments`).expect(403); // member không có user_role.read
    });

    it('quyền hiệu lực của user', async () => {
      const res = await call('binh', 'get', `/users/${await principalId('chi.fin@alpha.test')}/permissions`).expect(200);
      expect(res.body.map((p: { permission: string }) => p.permission)).toContain('user_role.assign');
    });
  });

  describe('audit (§13)', () => {
    it('Bình thấy việc gán quyền trong Alpha nhưng không thấy việc tạm ngưng membership (cấp tenant)', async () => {
      const page = (await call('binh', 'get', '/audit-events?limit=100').expect(200)).body as AuditPageDto;
      const types = new Set(page.items.map((e) => e.eventType));
      expect(types.has('tenant_role_assignments.created')).toBe(true);
      expect(types.has('tenant_memberships.status_changed')).toBe(false);
      expect(page.items.every((e) => e.orgUnit !== null)).toBe(true);
    });

    it('tenant admin thấy cả sự kiện cấp tenant, kèm diff cũ/mới; lọc và phân trang theo con trỏ', async () => {
      const page = (await call('an', 'get', '/audit-events?eventClass=A&eventType=tenant_memberships.status_changed&limit=2').expect(200)).body as AuditPageDto;
      expect(page.items.length).toBeGreaterThan(0);
      const ev = page.items[0]!;
      expect(ev.eventClass).toBe('A');
      expect(ev.payload).toHaveProperty('old');
      expect(ev.payload).toHaveProperty('new');
      const first = (await call('an', 'get', '/audit-events?limit=3').expect(200)).body as AuditPageDto;
      expect(first.nextCursor).not.toBeNull();
      const second = (await call('an', 'get', `/audit-events?limit=3&cursor=${first.nextCursor}`).expect(200)).body as AuditPageDto;
      expect(second.items.map((e) => e.id).filter((id) => first.items.some((f) => f.id === id))).toEqual([]);
    });

    it('audit lớp B: reason code và constraint chỉ nằm trong audit, không bao giờ ra phản hồi lỗi', async () => {
      const res = await call('binh', 'post', '/assignments', {
        userId: tester.id, roleId: await roleId('company_admin'), scope: { type: 'COMPANY', id: alpha },
      }).expect(403);
      expect(JSON.stringify(res.body)).not.toMatch(/RANK|CONSTRAINT|reason|constraint/i);
      const page = (await call('binh', 'get', '/audit-events?eventClass=B&limit=20').expect(200)).body as AuditPageDto;
      expect(page.items.some((e) => e.payload.constraint === 'RANK' || e.payload.reason_code === 'CONSTRAINT_FAILED')).toBe(true);
    });

    it('không có quyền xem audit: 403 (Dũng có thể thấy tenant nhưng không có grant) hoặc 403 cho người chưa có role', async () => {
      await call('dung', 'get', '/audit-events').expect(403);
      await call('thao', 'get', '/audit-events').expect(403);
    });
  });
});
