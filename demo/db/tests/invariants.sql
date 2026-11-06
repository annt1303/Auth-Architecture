-- =====================================================================
-- Kiểm thử bất biến ở tầng DB. Cần chạy sau 0001, 0002, 0003.
--   docker compose exec -T db psql -U authz -d authz_demo -v ON_ERROR_STOP=1 < db/tests/invariants.sql
-- Mọi thay đổi bị ROLLBACK ở cuối, DB giữ nguyên.
-- Mã T-* trong ngoặc là mã kiểm thử tương ứng của tài liệu gốc (mục 24), nếu có.
-- =====================================================================
\set QUIET on
\o /dev/null
BEGIN;

CREATE FUNCTION pg_temp.uid(p_email text) RETURNS uuid LANGUAGE sql AS
  $$ SELECT id FROM principals WHERE email = p_email $$;
CREATE FUNCTION pg_temp.unit(p_code text) RETURNS uuid LANGUAGE sql AS
  $$ SELECT id FROM org_units WHERE code = p_code $$;
CREATE FUNCTION pg_temp.role(p_key text) RETURNS uuid LANGUAGE sql AS
  $$ SELECT id FROM roles WHERE key = p_key $$;
CREATE FUNCTION pg_temp.tenant() RETURNS uuid LANGUAGE sql AS
  $$ SELECT id FROM tenants WHERE key = 'nhg-demo' $$;

-- Câu lệnh phải bị DB từ chối
CREATE FUNCTION pg_temp.expect_error(p_label text, p_sql text, p_seed boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('app.seed_mode', CASE WHEN p_seed THEN 'on' ELSE '' END, true);
  BEGIN
    EXECUTE p_sql;
    RAISE EXCEPTION 'FAIL: % (statement was accepted)', p_label;
  EXCEPTION
    WHEN check_violation OR unique_violation OR foreign_key_violation OR not_null_violation THEN
      RAISE NOTICE 'PASS  %  [%]', p_label, SQLERRM;
  END;
  PERFORM set_config('app.seed_mode', '', true);
END $$;

-- Điều kiện phải đúng
CREATE FUNCTION pg_temp.expect(p_label text, p_ok boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: %', p_label; END IF;
  RAISE NOTICE 'PASS  %', p_label;
END $$;

-- Tập scope hiệu lực của một user cho một quyền, dạng 'SCOPE_TYPE:mã' đã sắp xếp
CREATE FUNCTION pg_temp.scopes(p_email text, p_perm text) RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(string_agg(DISTINCT g.scope_type || ':' || coalesce(o.code, d.title, '-'), ', '), '')
  FROM effective_grants(pg_temp.tenant(), pg_temp.uid(p_email), p_perm, now()) g
  LEFT JOIN org_units o ON o.id = g.scope_id
  LEFT JOIN documents d ON d.id = g.scope_id
$$;

-- Tài liệu mà user đọc được: hợp các scope, mở rộng qua closure (SPEC 8.2)
CREATE FUNCTION pg_temp.readable_docs(p_email text) RETURNS text LANGUAGE sql AS $$
  WITH g AS (SELECT * FROM effective_grants(pg_temp.tenant(), pg_temp.uid(p_email), 'document.read', now()))
  SELECT coalesce(string_agg(d.title, ' | ' ORDER BY d.title), '')
  FROM documents d
  WHERE d.tenant_id = pg_temp.tenant() AND d.deleted_at IS NULL AND (
       EXISTS (SELECT 1 FROM g WHERE g.scope_type = 'TENANT')
    OR d.org_unit_id IN (SELECT c.descendant_id FROM g JOIN org_unit_closure c ON c.ancestor_id = g.scope_id
                          WHERE g.scope_type IN ('COMPANY','DEPARTMENT','TEAM'))
    OR d.id IN (SELECT g.scope_id FROM g WHERE g.scope_type = 'RESOURCE' AND g.scope_resource_type = 'document')
    OR (d.owner_principal_id = pg_temp.uid(p_email) AND EXISTS (SELECT 1 FROM g WHERE g.scope_type = 'SELF')))
$$;

SELECT set_config('app.actor_id', pg_temp.uid('an.tenant@holding.test')::text, true);

\echo '--- Grant hiệu lực và phạm vi dữ liệu ---'
SELECT pg_temp.expect('Dũng: member @TEAM + @SELF',
  pg_temp.scopes('dung.ap@alpha.test', 'document.read') = 'SELF:-, TEAM:ALPHA_FIN_AP');
SELECT pg_temp.expect('Khánh: assignment hết hạn bị loại dù status vẫn ACTIVE (T-Z01)',
  pg_temp.scopes('khanh.temp@alpha.test', 'document.read') = 'DEPARTMENT:ALPHA_FIN');
SELECT pg_temp.expect('Hoa: membership SUSPENDED nên không có grant hiệu lực (R2)',
  pg_temp.scopes('hoa.log@alpha-log.test', 'document.read') = ''
  AND EXISTS (SELECT 1 FROM tenant_role_assignments
               WHERE principal_id = pg_temp.uid('hoa.log@alpha-log.test') AND status = 'ACTIVE'));
SELECT pg_temp.expect('Giang: @COMPANY BETA + @RESOURCE một tài liệu của Alpha',
  pg_temp.scopes('giang.beta@beta.test', 'document.read') = 'COMPANY:BETA, RESOURCE:Chính sách chung Alpha');
SELECT pg_temp.expect('Bình (@COMPANY ALPHA) đọc được tài liệu của công ty con ALPHA_LOG, không đọc được Beta',
  pg_temp.readable_docs('binh.alpha@alpha.test')
  = 'Bảng đối soát công nợ tháng 10 | Chính sách chung Alpha | Kế hoạch vận hành kho | Quy chế tài chính Alpha | Sơ đồ mạng văn phòng');
SELECT pg_temp.expect('Em (@DEPARTMENT ALPHA_IT) đọc được tài liệu ở team con ALPHA_IT_INFRA_NET và toàn Beta',
  pg_temp.readable_docs('em.multi@alpha.test')
  = 'Báo cáo doanh số miền Bắc | Ghi chú khách hàng của Em | Hướng dẫn đối soát chi phí công tác và tạm ứng cho đội kinh doanh khu vực miền Bắc năm 2026 | Sơ đồ mạng văn phòng');
SELECT pg_temp.expect('Dũng chỉ đọc tài liệu của team mình (và của chính mình)',
  pg_temp.readable_docs('dung.ap@alpha.test') = 'Bảng đối soát công nợ tháng 10');
SELECT pg_temp.expect('Quyền tenant_scope_only không được trao qua scope COMPANY',
  pg_temp.scopes('binh.alpha@alpha.test', 'tenant_membership.manage') = ''
  AND pg_temp.scopes('an.tenant@holding.test', 'tenant_membership.manage') = 'TENANT:-');

\echo '--- Role và catalog ---'
SELECT pg_temp.expect_error('Không tạo role SYSTEM ngoài seed',
  $q$ INSERT INTO roles (owner_kind, key, name, level) VALUES ('SYSTEM', 'hacker', 'x', 2) $q$);
SELECT pg_temp.expect_error('Không sửa role SYSTEM',
  $q$ UPDATE roles SET level = 4 WHERE key = 'company_admin' $q$);
SELECT pg_temp.expect_error('Không thêm quyền cho role SYSTEM',
  $q$ INSERT INTO role_permissions SELECT pg_temp.role('member'), id FROM permissions WHERE key = 'document.delete' $q$);
SELECT pg_temp.expect_error('Không đổi chủ sở hữu role (T-RO05)',
  $q$ UPDATE roles SET owner_company_id = pg_temp.unit('BETA') WHERE key = 'custom.finance_reviewer' $q$);
SELECT pg_temp.expect_error('Custom role phải có tiền tố custom. (T-RO06)',
  $q$ INSERT INTO roles (owner_kind, tenant_id, key, name, level) VALUES ('TENANT', pg_temp.tenant(), 'reviewer', 'x', 3) $q$);
SELECT pg_temp.expect_error('Custom role không được level 1',
  $q$ INSERT INTO roles (owner_kind, tenant_id, key, name, level) VALUES ('TENANT', pg_temp.tenant(), 'custom.boss', 'x', 1) $q$);
SELECT pg_temp.expect_error('Role công ty phải thuộc một COMPANY',
  $q$ INSERT INTO roles (owner_kind, tenant_id, owner_company_id, key, name, level)
      VALUES ('COMPANY', pg_temp.tenant(), pg_temp.unit('ALPHA_FIN'), 'custom.x', 'x', 4) $q$);
SELECT pg_temp.expect_error('Khóa quyền platform.* bị cấm',
  $q$ INSERT INTO permissions (key, resource_type, action, risk_level, description)
      VALUES ('platform.tenant.create', 'platform.tenant', 'create', 'HIGH', 'x') $q$);

\echo '--- Assignment ---'
SELECT pg_temp.expect_error('Không tự cấp quyền (7.8)',
  $q$ INSERT INTO tenant_role_assignments (tenant_id, principal_id, role_id, scope_type, created_by)
      VALUES (pg_temp.tenant(), pg_temp.uid('chi.fin@alpha.test'), pg_temp.role('member'), 'SELF',
              pg_temp.uid('chi.fin@alpha.test')) $q$);
SELECT pg_temp.expect_error('Role công ty Alpha không gán được ở Beta',
  $q$ INSERT INTO tenant_role_assignments (tenant_id, principal_id, role_id, scope_type, scope_id, created_by)
      VALUES (pg_temp.tenant(), pg_temp.uid('em.multi@alpha.test'), pg_temp.role('custom.finance_reviewer'),
              'COMPANY', pg_temp.unit('BETA'), pg_temp.uid('binh.alpha@alpha.test')) $q$);
SELECT pg_temp.expect_error('Role công ty không gán ở scope TENANT',
  $q$ INSERT INTO tenant_role_assignments (tenant_id, principal_id, role_id, scope_type, created_by)
      VALUES (pg_temp.tenant(), pg_temp.uid('em.multi@alpha.test'), pg_temp.role('custom.finance_reviewer'),
              'TENANT', pg_temp.uid('binh.alpha@alpha.test')) $q$);
INSERT INTO tenant_role_assignments (tenant_id, principal_id, role_id, scope_type, scope_id, created_by)
VALUES (pg_temp.tenant(), pg_temp.uid('em.multi@alpha.test'), pg_temp.role('custom.finance_reviewer'),
        'COMPANY', pg_temp.unit('ALPHA_LOG'), pg_temp.uid('binh.alpha@alpha.test'));
SELECT pg_temp.expect('Role công ty Alpha gán được ở công ty con ALPHA_LOG',
  pg_temp.scopes('em.multi@alpha.test', 'document.update') LIKE '%COMPANY:ALPHA_LOG%');
SELECT pg_temp.expect_error('scope_type phải khớp loại đơn vị',
  $q$ INSERT INTO tenant_role_assignments (tenant_id, principal_id, role_id, scope_type, scope_id, created_by)
      VALUES (pg_temp.tenant(), pg_temp.uid('em.multi@alpha.test'), pg_temp.role('member'),
              'TEAM', pg_temp.unit('ALPHA_FIN'), pg_temp.uid('an.tenant@holding.test')) $q$);
SELECT pg_temp.expect_error('Không cấp system_admin ngoài seed/CLI',
  $q$ INSERT INTO tenant_role_assignments (tenant_id, principal_id, role_id, scope_type, created_by)
      VALUES (pg_temp.tenant(), pg_temp.uid('an.tenant@holding.test'), pg_temp.role('system_admin'),
              'TENANT', pg_temp.uid('sysadmin@holding.test')) $q$);
SELECT pg_temp.expect_error('Membership SUSPENDED không nhận assignment mới (R1)',
  $q$ INSERT INTO tenant_role_assignments (tenant_id, principal_id, role_id, scope_type, created_by)
      VALUES (pg_temp.tenant(), pg_temp.uid('hoa.log@alpha-log.test'), pg_temp.role('member'), 'SELF',
              pg_temp.uid('an.tenant@holding.test')) $q$);
SELECT pg_temp.expect_error('Không trùng assignment ACTIVE (T-X14)',
  $q$ INSERT INTO tenant_role_assignments (tenant_id, principal_id, role_id, scope_type, created_by)
      VALUES (pg_temp.tenant(), pg_temp.uid('dung.ap@alpha.test'), pg_temp.role('member'), 'SELF',
              pg_temp.uid('an.tenant@holding.test')) $q$);
UPDATE tenant_role_assignments SET status = 'REVOKED', revoke_reason = 'test'
 WHERE principal_id = pg_temp.uid('dung.ap@alpha.test') AND scope_type = 'SELF';
SELECT pg_temp.expect_error('Assignment đã thu hồi không kích hoạt lại được (8.4)',
  $q$ UPDATE tenant_role_assignments SET status = 'ACTIVE', revoked_at = NULL
      WHERE principal_id = pg_temp.uid('dung.ap@alpha.test') AND scope_type = 'SELF' $q$);
SELECT pg_temp.expect_error('Không đổi scope của assignment; phải thu hồi rồi cấp mới',
  $q$ UPDATE tenant_role_assignments SET scope_id = pg_temp.unit('BETA')
      WHERE principal_id = pg_temp.uid('binh.alpha@alpha.test') $q$);

\echo '--- system_admin ---'
SELECT pg_temp.expect_error('Không tạm ngưng membership của system admin ngoài seed/CLI',
  $q$ UPDATE tenant_memberships SET status = 'SUSPENDED' WHERE principal_id = pg_temp.uid('sysadmin@holding.test') $q$);
SELECT pg_temp.expect_error('Không vô hiệu hóa principal của system admin ngoài seed/CLI',
  $q$ UPDATE principals SET status = 'DISABLED' WHERE email = 'sysadmin@holding.test' $q$);
SELECT pg_temp.expect_error('Không thu hồi domain mà system admin đang dùng để đăng nhập',
  $q$ UPDATE company_domains SET status = 'REVOKED' WHERE domain = 'holding.test' $q$);
SELECT pg_temp.expect_error('Kể cả qua CLI, không thu hồi system_admin cuối cùng',
  $q$ UPDATE tenant_role_assignments SET status = 'REVOKED'
      WHERE role_id = pg_temp.role('system_admin') $q$, true);

\echo '--- Vòng đời membership ---'
UPDATE tenant_memberships SET status = 'REMOVED' WHERE principal_id = pg_temp.uid('em.multi@alpha.test');
SELECT pg_temp.expect('REMOVED thu hồi mọi assignment trong cùng transaction (R4)',
  NOT EXISTS (SELECT 1 FROM tenant_role_assignments
               WHERE principal_id = pg_temp.uid('em.multi@alpha.test') AND status = 'ACTIVE')
  AND (SELECT ended_at IS NOT NULL FROM tenant_memberships WHERE principal_id = pg_temp.uid('em.multi@alpha.test')));
UPDATE tenant_memberships SET status = 'ACTIVE' WHERE principal_id = pg_temp.uid('em.multi@alpha.test');
SELECT pg_temp.expect('Thêm lại sau khi loại bỏ không khôi phục quyền cũ, ended_at được xóa (R4, R5)',
  pg_temp.scopes('em.multi@alpha.test', 'document.read') = ''
  AND (SELECT ended_at IS NULL FROM tenant_memberships WHERE principal_id = pg_temp.uid('em.multi@alpha.test')));
UPDATE tenant_memberships SET status = 'ACTIVE' WHERE principal_id = pg_temp.uid('hoa.log@alpha-log.test');
SELECT pg_temp.expect('Khôi phục SUSPENDED thì assignment cũ có hiệu lực lại (R3)',
  pg_temp.scopes('hoa.log@alpha-log.test', 'document.read') = 'COMPANY:ALPHA_LOG');
SELECT pg_temp.expect_error('ended_at phải khớp trạng thái (T-M13)',
  $q$ UPDATE tenant_memberships SET ended_at = now() WHERE principal_id = pg_temp.uid('chi.fin@alpha.test') $q$);

\echo '--- Tổ chức, affiliation, domain ---'
SELECT pg_temp.expect_error('TEAM không đặt trực tiếp dưới COMPANY',
  $q$ INSERT INTO org_units (tenant_id, unit_type, parent_id, code, name)
      VALUES (pg_temp.tenant(), 'TEAM', pg_temp.unit('ALPHA'), 'BAD_TEAM', 'x') $q$);
SELECT pg_temp.expect_error('Không tạo DEPARTMENT ở gốc',
  $q$ INSERT INTO org_units (tenant_id, unit_type, code, name) VALUES (pg_temp.tenant(), 'DEPARTMENT', 'BAD_DEPT', 'x') $q$);
SELECT pg_temp.expect_error('parent_id bất biến ở v1',
  $q$ UPDATE org_units SET parent_id = pg_temp.unit('BETA') WHERE code = 'ALPHA_FIN' $q$);
SELECT pg_temp.expect('Closure: ALPHA bao phủ team ALPHA_IT_INFRA_NET ở độ sâu 3',
  (SELECT depth FROM org_unit_closure
    WHERE ancestor_id = pg_temp.unit('ALPHA') AND descendant_id = pg_temp.unit('ALPHA_IT_INFRA_NET')) = 3);
SELECT pg_temp.expect('company_id của phòng ban con là công ty gần nhất',
  (SELECT company_id FROM org_units WHERE code = 'ALPHA_LOG_OPS') = pg_temp.unit('ALPHA_LOG'));
SELECT pg_temp.expect_error('Phòng ban của affiliation phải thuộc đúng công ty',
  $q$ UPDATE user_affiliations SET department_id = pg_temp.unit('BETA_SALES')
      WHERE principal_id = pg_temp.uid('chi.fin@alpha.test') $q$);
SELECT pg_temp.expect_error('Mỗi user tối đa một affiliation trong một công ty',
  $q$ INSERT INTO user_affiliations (tenant_id, principal_id, company_id, department_id)
      VALUES (pg_temp.tenant(), pg_temp.uid('chi.fin@alpha.test'), pg_temp.unit('ALPHA'), pg_temp.unit('ALPHA_IT')) $q$);
SELECT pg_temp.expect_error('Một domain chỉ thuộc một công ty',
  $q$ INSERT INTO company_domains (tenant_id, company_id, domain) VALUES (pg_temp.tenant(), pg_temp.unit('BETA'), 'alpha.test') $q$);
SELECT pg_temp.expect_error('Domain REVOKED không quay lại ACTIVE',
  $q$ UPDATE company_domains SET status = 'REVOKED' WHERE domain = 'alpha-log.test';
      UPDATE company_domains SET status = 'ACTIVE', revoked_at = NULL WHERE domain = 'alpha-log.test' $q$);
SELECT pg_temp.expect_error('Tài liệu không chuyển sang đơn vị khác (17.2)',
  $q$ UPDATE documents SET company_id = pg_temp.unit('BETA') WHERE title = 'Chính sách chung Alpha' $q$);

\echo '--- Audit ---'
SELECT pg_temp.expect('Thay đổi assignment sinh sự kiện lớp A có actor',
  EXISTS (SELECT 1 FROM audit_events
           WHERE event_type = 'tenant_role_assignments.status_changed'
             AND actor_id = pg_temp.uid('an.tenant@holding.test') AND actor_attributed));
SELECT pg_temp.expect('Audit của assignment ghi đơn vị scope; của membership là cấp tenant (NULL)',
  EXISTS (SELECT 1 FROM audit_events WHERE target_type = 'tenant_role_assignments'
           AND event_type = 'tenant_role_assignments.created' AND org_unit_id = pg_temp.unit('ALPHA_FIN'))
  AND NOT EXISTS (SELECT 1 FROM audit_events WHERE target_type = 'tenant_memberships' AND org_unit_id IS NOT NULL));
SELECT pg_temp.expect('Audit của assignment @RESOURCE ghi đơn vị của tài liệu',
  EXISTS (SELECT 1 FROM audit_events a JOIN tenant_role_assignments t ON t.id = a.target_id
           WHERE t.scope_type = 'RESOURCE' AND a.org_unit_id = pg_temp.unit('ALPHA')));
SELECT pg_temp.expect('Bình (@COMPANY ALPHA) có quyền đọc audit; scope bao phủ audit của Alpha Logistics, không bao phủ Beta',
  pg_temp.scopes('binh.alpha@alpha.test', 'authorization_audit.read') = 'COMPANY:ALPHA'
  AND EXISTS (SELECT 1 FROM audit_events a JOIN org_unit_closure c
                ON c.ancestor_id = pg_temp.unit('ALPHA') AND c.descendant_id = a.org_unit_id
               WHERE a.org_unit_id = pg_temp.unit('ALPHA_LOG'))
  AND NOT EXISTS (SELECT 1 FROM org_unit_closure
                   WHERE ancestor_id = pg_temp.unit('ALPHA') AND descendant_id = pg_temp.unit('BETA')));
SELECT pg_temp.expect_error('audit_events chỉ được thêm',
  $q$ DELETE FROM audit_events $q$);

ROLLBACK;
\echo 'ALL INVARIANT TESTS PASSED'
