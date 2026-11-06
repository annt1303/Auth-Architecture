import type { INestApplication } from '@nestjs/common';
import type { DecisionTrace, DocumentDto, EffectiveMatrixDto, WhoCanDto } from '@authz-demo/authz-types';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { ContextBuilder } from '../src/authz/context-builder.service.js';
import { Pdp } from '../src/authz/pdp.service.js';
import { ResourceResolver } from '../src/authz/resources.js';
import { createApp, documentId, loginAs, principalId, roleId, unitId, withDb } from './helpers.js';

// Giai đoạn 3 (SPEC §18): Simulator giải thích đúng các ô của §15 bằng chính đường đánh giá của PEP.
describe('Simulator, ma trận quyền, "Ai có quyền" (SPEC §9, §12, §14)', () => {
  let app: INestApplication<App>;
  const as: Record<string, string> = {};
  const api = (who: string) => ({
    get: (p: string) => request(app.getHttpServer()).get(p).set('Cookie', as[who]!),
    post: (p: string, b: object) => request(app.getHttpServer()).post(p).set('Cookie', as[who]!).send(b),
  });
  const simulate = async (who: string, body: object) => (await api(who).post('/authz/simulate', body).expect(200)).body as DecisionTrace;
  const outcome = (t: DecisionTrace, id: string) => t.steps.find((s) => s.id === id)?.outcome;

  beforeAll(async () => {
    app = await createApp();
    for (const who of ['sysadmin', 'an', 'binh', 'chi', 'dung', 'giang', 'hoa', 'khanh', 'em']) {
      as[who] = await loginAs(app, `mock|${who}`);
    }
  });
  afterAll(async () => {
    await app.close();
  });

  const doc = (title: string) => documentId(title);
  const read = async (who: string, title: string) => ({
    principalId: await principalId(EMAIL[who]!),
    action: 'document.read',
    resource: { type: 'document', id: await doc(title) },
  });
  const EMAIL: Record<string, string> = {
    dung: 'dung.ap@alpha.test', hoa: 'hoa.log@alpha-log.test', khanh: 'khanh.temp@alpha.test', binh: 'binh.alpha@alpha.test',
    chi: 'chi.fin@alpha.test', giang: 'giang.beta@beta.test', em: 'em.multi@alpha.test', an: 'an.tenant@holding.test',
    sysadmin: 'sysadmin@holding.test',
  };

  describe('đọc tài liệu: các ô của §15', () => {
    it('Dũng mở "Quy chế tài chính": không nhìn thấy, 404 (D4 trượt, OUT_OF_SCOPE)', async () => {
      const t = await simulate('an', await read('dung', 'Quy chế tài chính Alpha'));
      expect(t.result).toMatchObject({ state: 'DENY', reasonCode: 'OUT_OF_SCOPE', httpStatus: 404, errorCode: 'not_found' });
      expect(outcome(t, 'D3')).toBe('PASS');
      expect(outcome(t, 'D4')).toBe('FAIL');
      expect(outcome(t, 'D6')).toBe('SKIP');
      expect(t.grants.length).toBeGreaterThan(0);
      expect(t.grants.every((g) => !g.coversResource)).toBe(true);
    });

    it('Dũng mở tài liệu của team mình: ALLOW qua grant TEAM và SELF', async () => {
      const t = await simulate('an', await read('dung', 'Bảng đối soát công nợ tháng 10'));
      expect(t.result).toMatchObject({ state: 'ALLOW', reasonCode: 'ALLOW_GRANT', httpStatus: 200, errorCode: null });
      expect(t.grants.filter((g) => g.coversResource).map((g) => g.scopeType).sort()).toEqual(['SELF', 'TEAM']);
      expect(t.steps.map((s) => s.id)).toEqual(['PA4', 'B1', 'B2', 'B4', 'C1', 'C2', 'D3', 'D4', 'D5', 'D6']);
    });

    it('Hoa bị tạm ngưng: B2 trượt, tenant_access_denied (403)', async () => {
      const t = await simulate('an', await read('hoa', 'Kế hoạch vận hành kho'));
      expect(outcome(t, 'B1')).toBe('PASS');
      expect(outcome(t, 'B2')).toBe('FAIL');
      expect(outcome(t, 'C1')).toBe('SKIP');
      expect(t.result).toMatchObject({ reasonCode: 'NOT_A_MEMBER', httpStatus: 403, errorCode: 'tenant_access_denied' });
    });

    it('Khánh: assignment hết hạn không phải grant; không có grant nào thì NO_GRANT, 404', async () => {
      const t = await simulate('an', await read('khanh', 'Sơ đồ mạng văn phòng'));
      expect(t.grants.map((g) => g.roleKey)).toEqual(["custom.finance_reviewer"]); // member@ALPHA_IT đã hết hạn nên không phải grant
      expect(t.grants[0]!.coversResource).toBe(false);
      expect(t.result).toMatchObject({ reasonCode: "OUT_OF_SCOPE", httpStatus: 404 });
      expect(outcome(t, "D4")).toBe("FAIL");
    });

    it('Giang đọc tài liệu Alpha qua grant RESOURCE: ALLOW; Em đọc tài liệu Beta qua COMPANY', async () => {
      const g = await simulate('an', await read('giang', 'Chính sách chung Alpha'));
      expect(g.result.state).toBe('ALLOW');
      expect(g.grants.find((x) => x.coversResource)?.scopeType).toBe('RESOURCE');
      const e = await simulate('an', await read('em', 'Báo cáo doanh số miền Bắc'));
      expect(e.result.state).toBe('ALLOW');
    });

    it('thấy nhưng không được làm: Dũng xóa tài liệu của team mình là 403, không phải 404', async () => {
      const t = await simulate('an', { ...(await read('dung', 'Bảng đối soát công nợ tháng 10')), action: 'document.delete' });
      expect(t.result).toMatchObject({ reasonCode: 'NO_GRANT', httpStatus: 403, errorCode: 'forbidden' });
    });

    it('action lạ: PA4 trượt, INDETERMINATE', async () => {
      const t = await simulate('an', { ...(await read('dung', 'Bảng đối soát công nợ tháng 10')), action: 'document.teleport' });
      expect(t.result).toMatchObject({ state: 'INDETERMINATE', reasonCode: 'UNKNOWN_PERMISSION', httpStatus: 500 });
      expect(outcome(t, 'PA4')).toBe('FAIL');
      expect(outcome(t, 'B1')).toBe('SKIP');
    });
  });

  describe('hành động quản trị: ràng buộc §10', () => {
    it('Bình gán company_admin cho Chi: trượt RANK ở D5, 403', async () => {
      const t = await simulate('an', {
        principalId: await principalId(EMAIL.binh!), action: 'user_role.assign',
        resource: { type: 'user', id: await principalId(EMAIL.chi!) },
        params: { roleId: await roleId('company_admin'), scope: { type: 'COMPANY', id: await unitId('ALPHA') } },
      });
      expect(t.result).toMatchObject({ state: 'DENY', reasonCode: 'CONSTRAINT_FAILED', httpStatus: 403 });
      expect(outcome(t, 'D4')).toBe('PASS');
      expect(outcome(t, 'D5')).toBe('FAIL');
      expect(t.constraints.find((c) => c.id === 'RANK')?.outcome).toBe('FAIL');
      expect(t.constraints.find((c) => c.id === 'NOT_SELF')?.outcome).toBe('PASS');
    });

    it('Bình gán department_manager cho Chi tại ALPHA_FIN: mọi ràng buộc đạt, ALLOW', async () => {
      const t = await simulate('an', {
        principalId: await principalId(EMAIL.binh!), action: 'user_role.assign',
        resource: { type: 'user', id: await principalId(EMAIL.chi!) },
        params: { roleId: await roleId('department_manager'), scope: { type: 'DEPARTMENT', id: await unitId('ALPHA_FIN') } },
      });
      expect(t.result.state).toBe('ALLOW');
      expect(t.constraints.map((c) => c.id).sort()).toEqual(
        ['NOT_SELF', 'PERMISSION_SUBSET', 'RANK', 'ROLE_ASSIGNABLE_HERE', 'SYSTEM_ADMIN_PROTECTED', 'TARGET_VISIBLE'],
      );
      expect(t.constraints.every((c) => c.outcome === 'PASS')).toBe(true);
    });

    it('Bình gán member tại BETA: OUT_OF_SCOPE (D4)', async () => {
      const t = await simulate('an', {
        principalId: await principalId(EMAIL.binh!), action: 'user_role.assign',
        resource: { type: 'user', id: await principalId(EMAIL.chi!) },
        params: { roleId: await roleId('member'), scope: { type: 'COMPANY', id: await unitId('BETA') } },
      });
      expect(t.result.reasonCode).toBe('OUT_OF_SCOPE');
      expect(outcome(t, 'D4')).toBe('FAIL');
      expect(outcome(t, 'C2')).toBe('SKIP');
    });

    it("custom.auditor level 3: trượt RANK dù Bình có đủ mọi quyền của role (PERMISSION_SUBSET đạt)", async () => {
      const t = await simulate('an', {
        principalId: await principalId(EMAIL.binh!), action: 'user_role.assign',
        resource: { type: 'user', id: await principalId(EMAIL.chi!) },
        params: { roleId: await roleId('custom.auditor'), scope: { type: 'DEPARTMENT', id: await unitId('ALPHA_FIN') } },
      });
      expect(t.constraints.find((c) => c.id === "RANK")?.outcome).toBe("FAIL");
      expect(t.constraints.find((c) => c.id === "PERMISSION_SUBSET")?.outcome).toBe("PASS");
    });

    it('An tạm ngưng system admin: RANK và SYSTEM_ADMIN_PROTECTED trượt', async () => {
      const t = await simulate('an', {
        principalId: await principalId(EMAIL.an!), action: 'tenant_membership.manage',
        resource: { type: 'user', id: await principalId(EMAIL.sysadmin!) },
      });
      expect(t.result.reasonCode).toBe('CONSTRAINT_FAILED');
      expect(t.constraints.filter((c) => c.outcome === 'FAIL').map((c) => c.id).sort()).toEqual(['RANK', 'SYSTEM_ADMIN_PROTECTED']);
    });

    it('Bình tạo user với domain lạ: EMAIL_DOMAIN trượt; domain đúng thì đạt', async () => {
      const alpha = await unitId('ALPHA');
      const bad = await simulate('an', {
        principalId: await principalId(EMAIL.binh!), action: 'user.create', resource: { type: 'org_unit', id: alpha },
        params: { companyId: alpha, email: 'x@beta.test' },
      });
      expect(bad.constraints).toEqual([{ id: 'EMAIL_DOMAIN', outcome: 'FAIL' }]);
      const good = await simulate('an', {
        principalId: await principalId(EMAIL.binh!), action: 'user.create', resource: { type: 'org_unit', id: alpha },
        params: { companyId: alpha, email: 'x@alpha.test' },
      });
      expect(good.result.state).toBe('ALLOW');
    });

    it('tạo tài liệu: Khánh nhìn thấy phòng Tài chính nhưng không tạo được ở đó (403)', async () => {
      const t = await simulate('an', {
        principalId: await principalId(EMAIL.khanh!), action: 'document.create', resource: { type: 'org_unit', id: await unitId('ALPHA_FIN') },
      });
      expect(t.result).toMatchObject({ httpStatus: 403, errorCode: 'forbidden' });
    });
  });

  describe('quyền truy cập các công cụ', () => {
    it('chỉ TENANT mới dùng được: Bình bị 403, Dũng bị 403', async () => {
      await api('binh').post('/authz/simulate', { principalId: await principalId(EMAIL.dung!), action: 'document.read', resource: { type: 'tenant' } }).expect(403);
      await api('dung').get(`/authz/effective?principalId=${await principalId(EMAIL.dung!)}`).expect(403);
      await api('chi').get('/authz/who-can?action=document.read&resourceType=tenant').expect(403);
    });

    it('principal hoặc tài nguyên không tồn tại: 404', async () => {
      await api('an').post('/authz/simulate', { principalId: '00000000-0000-4000-8000-000000000000', action: 'document.read', resource: { type: 'tenant' } }).expect(404);
      await api('an').post('/authz/simulate', { principalId: await principalId(EMAIL.dung!), action: 'document.read', resource: { type: 'document', id: '00000000-0000-4000-8000-000000000000' } }).expect(404);
    });
  });

  describe('ma trận quyền và "Ai có quyền"', () => {
    it('ma trận của Chi: đủ 19 quyền, user_role.assign kèm scope Alpha Tài chính, quyền tenant-only trống', async () => {
      const res = await api('an').get(`/authz/effective?principalId=${await principalId(EMAIL.chi!)}`).expect(200);
      const m = res.body as EffectiveMatrixDto;
      expect(m.rows).toHaveLength(19);
      expect(m.rows.find((r) => r.permission === 'user_role.assign')?.grants[0]?.scope.label).toBe('Alpha Tài chính');
      expect(m.rows.find((r) => r.permission === 'authz_simulation.run')).toMatchObject({ tenantScopeOnly: true, grants: [] });
    });

    it('Ai đọc được "Quy chế tài chính": cấp tổ chức, admin Alpha, Chi, Khánh (custom role); không có Dũng, Giang', async () => {
      const res = await api('an').get(`/authz/who-can?action=document.read&resourceType=document&resourceId=${await doc('Quy chế tài chính Alpha')}`).expect(200);
      const w = res.body as WhoCanDto;
      const names = w.principals.map((p) => p.email).sort();
      expect(names).toEqual(
        ['an.tenant@holding.test', 'binh.alpha@alpha.test', 'chi.fin@alpha.test', 'khanh.temp@alpha.test', 'sysadmin@holding.test'],
      );
      expect(w.resource.label).toBe('Quy chế tài chính Alpha');
      expect(w.principals.find((p) => p.email === 'khanh.temp@alpha.test')?.via[0]?.roleKey).toBe('custom.finance_reviewer');
    });
  });

  // Hai cách tính bao phủ (SQL của PDP, bộ nhớ của GrantSet) phải cho cùng kết quả; PEP thật cũng phải khớp.
  describe('nhất quán giữa các đường đánh giá', () => {
    it('Pdp.check, GrantSet và API thật khớp nhau trên mọi cặp (user, tài liệu)', async () => {
      const pdp = app.get(Pdp, { strict: false });
      const contexts = app.get(ContextBuilder, { strict: false });
      const resolver = app.get(ResourceResolver, { strict: false });
      const docs = await withDb(async (c) => (await c.query('SELECT id, title FROM documents')).rows as { id: string; title: string }[]);
      let compared = 0;
      for (const who of ['binh', 'chi', 'dung', 'em', 'giang', 'khanh']) {
        const built = await contexts.buildFor(await principalId(EMAIL[who]!), new Date(), 'consistency');
        const grants = await pdp.loadGrants(built.context.tenantId, built.context.principalId);
        for (const d of docs) {
          const resolved = (await resolver.byRef({ type: 'document', id: d.id }, built.context.tenantId))!;
          const viaSql = (await pdp.check(built, 'document.read', resolved.attrs)).state === 'ALLOW';
          const viaMemory = grants.has('document.read', resolved.attrs);
          const viaApi = (await api(who).get(`/documents/${d.id}`)).status === 200;
          expect({ who, doc: d.title, viaMemory, viaApi }).toEqual({ who, doc: d.title, viaMemory: viaSql, viaApi: viaSql });
          compared += 1;
        }
      }
      expect(compared).toBe(6 * docs.length);
      const list = (await api('binh').get('/documents').expect(200)).body as DocumentDto[];
      expect(list.length).toBeGreaterThan(0);
    });
  });
});
