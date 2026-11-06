import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { DocumentDto, MeResponse } from '@authz-demo/authz-types';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { createApp, documentId, loginAs, unitId, withDb } from './helpers.js';

// Các kịch bản của SPEC §15 cho giai đoạn 1: Dũng, Em, Giang, Hoa, Khánh (và Bình, Chi để so sánh).
describe('Tài liệu: PEP, PDP, FilterPlan, 403/404 (SPEC §8, §9, §11)', () => {
  let app: INestApplication<App>;
  const as: Record<string, string> = {};
  const get = (who: string, path: string) => request(app.getHttpServer()).get(path).set('Cookie', as[who]!);
  const titles = (docs: DocumentDto[]) => docs.map((d) => d.title).sort();

  beforeAll(async () => {
    app = await createApp();
    for (const who of ['binh', 'chi', 'dung', 'em', 'giang', 'hoa', 'khanh', 'thao']) {
      as[who] = await loginAs(app, `mock|${who}`);
    }
  });
  afterAll(async () => {
    await app.close();
  });

  describe('danh sách chỉ trả tài liệu trong phạm vi', () => {
    it.each([
      ['binh', ['Bảng đối soát công nợ tháng 10', 'Chính sách chung Alpha', 'Kế hoạch vận hành kho',
                'Quy chế tài chính Alpha', 'Sơ đồ mạng văn phòng']],
      ['dung', ['Bảng đối soát công nợ tháng 10']],
      ['em', ['Báo cáo doanh số miền Bắc', 'Ghi chú khách hàng của Em', 'Hướng dẫn đối soát chi phí công tác và tạm ứng cho đội kinh doanh khu vực miền Bắc năm 2026',
              'Sơ đồ mạng văn phòng']],
      ['giang', ['Báo cáo doanh số miền Bắc', 'Chính sách chung Alpha', 'Ghi chú khách hàng của Em',
                 'Hướng dẫn đối soát chi phí công tác và tạm ứng cho đội kinh doanh khu vực miền Bắc năm 2026']],
      ['khanh', ['Bảng đối soát công nợ tháng 10', 'Quy chế tài chính Alpha']],
    ])('%s', async (who, expected) => {
      const res = await get(who, '/documents').expect(200);
      expect(titles(res.body)).toEqual(expected);
    });

    it('bộ lọc của người dùng chỉ thu hẹp thêm, không mở rộng phạm vi', async () => {
      const res = await get('binh', '/documents?status=DRAFT').expect(200);
      expect(titles(res.body)).toEqual(['Bảng đối soát công nợ tháng 10', 'Sơ đồ mạng văn phòng']);
    });

    it('_actions phản ánh đúng quyền trên từng dòng', async () => {
      const dung = (await get('dung', '/documents').expect(200)).body as DocumentDto[];
      expect(dung[0]!._actions).toEqual(['read', 'update']);
      const chi = (await get('chi', '/documents').expect(200)).body as DocumentDto[];
      expect(chi.every((d) => d._actions.includes('delete'))).toBe(true);
    });
  });

  describe('một tài liệu: 404 khi không nhìn thấy, 403 khi nhìn thấy nhưng không được làm', () => {
    it('không nhìn thấy và không tồn tại cho phản hồi giống hệt nhau trừ correlationId', async () => {
      const hidden = await get('dung', `/documents/${await documentId('Quy chế tài chính Alpha')}`).expect(404);
      const missing = await get('dung', `/documents/${randomUUID()}`).expect(404);
      const strip = (b: Record<string, unknown>) => ({ ...b, correlationId: undefined });
      expect(strip(hidden.body)).toEqual(strip(missing.body));
      expect(hidden.body.error).toBe('not_found');
    });

    it('từ chối ghi audit lớp B với reason code thật (client không thấy)', async () => {
      const id = await documentId('Quy chế tài chính Alpha');
      const res = await get('dung', `/documents/${id}`).expect(404);
      await new Promise((r) => setTimeout(r, 50));
      const [event] = await withDb(
        async (c) =>
          (
            await c.query(
              `SELECT payload->>'reason_code' AS reason, org_unit_id FROM audit_events
                WHERE event_class = 'B' AND correlation_id = $1`,
              [res.body.correlationId],
            )
          ).rows,
      );
      expect(event).toEqual({ reason: 'OUT_OF_SCOPE', org_unit_id: await unitId('ALPHA_FIN') });
      expect(JSON.stringify(res.body)).not.toContain('OUT_OF_SCOPE');
    });

    it('Dũng sửa được tài liệu của team nhưng không xóa được (403)', async () => {
      const id = await documentId('Bảng đối soát công nợ tháng 10');
      await request(app.getHttpServer())
        .patch(`/documents/${id}`)
        .set('Cookie', as.dung!)
        .send({ body: 'Đã đối soát' })
        .expect(200);
      const res = await request(app.getHttpServer()).delete(`/documents/${id}`).set('Cookie', as.dung!).expect(403);
      expect(res.body.error).toBe('forbidden');
    });

    it('Giang chỉ thấy đúng một tài liệu Alpha được cấp ở scope RESOURCE', async () => {
      await get('giang', `/documents/${await documentId('Chính sách chung Alpha')}`).expect(200);
      await get('giang', `/documents/${await documentId('Quy chế tài chính Alpha')}`).expect(404);
    });

    it('id sai định dạng là lỗi request (400), không phải 404', async () => {
      const res = await get('dung', '/documents/not-a-uuid').expect(400);
      expect(res.body.error).toBe('invalid_request');
    });
  });

  describe('tạo tài liệu: kiểm tra trên đơn vị đích', () => {
    const create = (who: string, orgUnitId: string) =>
      request(app.getHttpServer()).post('/documents').set('Cookie', as[who]!).send({ title: 'Tài liệu mới', orgUnitId });

    it('Dũng tạo được trong team của mình', async () => {
      const res = await create('dung', await unitId('ALPHA_FIN_AP')).expect(201);
      expect(res.body.owner.displayName).toContain('Dũng');
      expect(res.body.orgUnit.code).toBe('ALPHA_FIN_AP');
    });

    it('grant SELF không cho tạo ở đơn vị khác: phòng Tài chính không nhìn thấy với Dũng -> 404', async () => {
      await create('dung', await unitId('ALPHA_FIN')).expect(404);
    });

    it('Khánh nhìn thấy phòng Tài chính nhưng role không có quyền tạo -> 403', async () => {
      await create('khanh', await unitId('ALPHA_FIN')).expect(403);
    });
  });

  describe('membership và thời hạn (R2, R3, T-Z01)', () => {
    it('Hoa (SUSPENDED) đăng nhập được nhưng mọi API nghiệp vụ trả tenant_access_denied, kể cả với id có thật', async () => {
      const list = await get('hoa', '/documents').expect(403);
      expect(list.body.error).toBe('tenant_access_denied');
      const one = await get('hoa', `/documents/${await documentId('Kế hoạch vận hành kho')}`).expect(403);
      expect(one.body.error).toBe('tenant_access_denied');
    });

    it('Hoa vẫn xem được /me: assignment lưu ACTIVE nhưng không có hiệu lực', async () => {
      const me = (await get('hoa', '/me').expect(200)).body as MeResponse;
      expect(me.membership.status).toBe('SUSPENDED');
      expect(me.assignments.map((a) => a.ineffectiveReason)).toEqual(['MEMBERSHIP_INACTIVE']);
      expect(me.effectivePermissions).toEqual([]);
    });

    it('Khánh: assignment hết hạn là EXPIRED, chưa tới ngày là NOT_YET_VALID, role công ty vẫn có hiệu lực', async () => {
      const me = (await get('khanh', '/me').expect(200)).body as MeResponse;
      const byRole = Object.fromEntries(me.assignments.map((a) => [a.role.key, a.ineffectiveReason]));
      expect(byRole).toEqual({
        'custom.finance_reviewer': null,
        department_manager: 'NOT_YET_VALID',
        member: 'EXPIRED',
      });
    });

    it('tạm ngưng có hiệu lực ngay ở request kế tiếp, khôi phục thì quyền cũ quay lại', async () => {
      const setStatus = (status: string) =>
        withDb((c) =>
          c.query(
            `UPDATE tenant_memberships SET status = $1
              WHERE principal_id = (SELECT id FROM principals WHERE email = 'chi.fin@alpha.test')`,
            [status],
          ),
        );
      await get('chi', '/documents').expect(200);
      await setStatus('SUSPENDED');
      try {
        expect((await get('chi', '/documents').expect(403)).body.error).toBe('tenant_access_denied');
      } finally {
        await setStatus('ACTIVE');
      }
      await get('chi', '/documents').expect(200);
    });
  });

  it('Thảo chưa có vai trò: đăng nhập được, /me không có quyền nào, danh sách tài liệu 403', async () => {
    const me = (await get('thao', '/me').expect(200)).body as MeResponse;
    expect(me.membership.status).toBe('ACTIVE');
    expect(me.assignments).toEqual([]);
    expect((await get('thao', '/documents').expect(403)).body.error).toBe('forbidden');
  });

  describe('đơn vị đích khi tạo tài liệu', () => {
    const codes = async (who: string, path: string) =>
      ((await get(who, path).expect(200)).body as { code: string }[]).map((u) => u.code);

    it('chỉ gồm đơn vị được tạo, không phải mọi đơn vị nhìn thấy', async () => {
      expect(await codes('giang', '/documents/destinations')).toEqual(['BETA', 'BETA_SALES', 'BETA_SALES_NORTH']);
      expect(await codes('dung', '/documents/destinations')).toEqual(['ALPHA_FIN_AP']);
      // Khánh nhìn thấy Alpha Tài chính (role duyệt tài chính) nhưng không được tạo ở đâu cả
      expect(await codes('khanh', '/org-units')).toEqual(['ALPHA_FIN', 'ALPHA_FIN_AP']);
      expect((await get('khanh', '/documents/destinations').expect(403)).body.error).toBe('forbidden');
    });
  });

  describe('đơn vị tổ chức', () => {
    it('Bình thấy cây Alpha kể cả công ty con; Dũng chỉ thấy team của mình', async () => {
      const codes = async (who: string) =>
        ((await get(who, '/org-units').expect(200)).body as { code: string }[]).map((u) => u.code);
      expect(await codes('binh')).toEqual([
        'ALPHA', 'ALPHA_FIN', 'ALPHA_FIN_AP', 'ALPHA_IT', 'ALPHA_IT_INFRA', 'ALPHA_IT_INFRA_NET',
        'ALPHA_LOG', 'ALPHA_LOG_OPS',
      ]);
      expect(await codes('dung')).toEqual(['ALPHA_FIN_AP']);
    });
  });
});
