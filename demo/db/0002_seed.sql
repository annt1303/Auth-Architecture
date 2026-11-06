-- =====================================================================
-- Seed bắt buộc: tenant, permission catalog, role hệ thống, công ty gốc, system admin.
-- Chạy trong seed mode vì role hệ thống và system_admin chỉ được tạo ở đây (SPEC 7.2, 8.5).
-- =====================================================================
BEGIN;
SET LOCAL app.seed_mode = 'on';
SET LOCAL app.reason = 'initial seed';

INSERT INTO tenants (key, name) VALUES ('nhg-demo', 'NHG Demo');

-- Permission catalog (SPEC 7.1)
INSERT INTO permissions (key, resource_type, action, risk_level, is_visibility, tenant_scope_only, description) VALUES
  ('org_unit.read',            'org_unit',            'read',    'LOW',  true,  false, 'Xem công ty, phòng ban, team'),
  ('org_unit.manage',          'org_unit',            'manage',  'HIGH', false, false, 'Tạo, sửa, lưu trữ đơn vị con trong phạm vi'),
  ('company_domain.manage',    'company_domain',      'manage',  'HIGH', false, false, 'Đề xuất thêm hoặc thu hồi domain email của công ty'),
  ('company_domain.approve',   'company_domain',      'approve', 'HIGH', false, true,  'Duyệt hoặc từ chối domain email đang chờ'),
  ('user.read',                'user',                'read',    'LOW',  true,  false, 'Xem user trong phạm vi'),
  ('user.create',              'user',                'create',  'HIGH', false, false, 'Tạo trước user vào một công ty'),
  ('user_affiliation.manage',  'user_affiliation',    'manage',  'HIGH', false, false, 'Thêm, gỡ, đổi phòng ban của user trong công ty'),
  ('tenant_membership.manage', 'tenant_membership',   'manage',  'HIGH', false, true,  'Tạm ngưng, khôi phục, loại bỏ membership'),
  ('role.read',                'role',                'read',    'LOW',  true,  false, 'Xem role và quyền của role'),
  ('role.manage',              'role',                'manage',  'HIGH', false, false, 'Tạo, sửa, lưu trữ custom role'),
  ('user_role.read',           'user_role',           'read',    'LOW',  true,  false, 'Xem assignment của user'),
  ('user_role.assign',         'user_role',           'assign',  'HIGH', false, false, 'Gán role cho user'),
  ('user_role.revoke',         'user_role',           'revoke',  'HIGH', false, false, 'Thu hồi assignment'),
  ('document.read',            'document',            'read',    'LOW',  true,  false, 'Xem tài liệu'),
  ('document.create',          'document',            'create',  'LOW',  false, false, 'Tạo tài liệu'),
  ('document.update',          'document',            'update',  'LOW',  false, false, 'Sửa tài liệu'),
  ('document.delete',          'document',            'delete',  'HIGH', false, false, 'Xóa tài liệu'),
  ('authorization_audit.read', 'authorization_audit', 'read',    'HIGH', false, false, 'Xem nhật ký audit phân quyền trong phạm vi'),
  ('authz_simulation.run',     'authz_simulation',    'run',     'HIGH', false, true,  'Dùng Simulator, ma trận quyền, "Ai có quyền"');

-- Role hệ thống, không sửa được ngoài seed (SPEC 7.2)
INSERT INTO roles (owner_kind, key, name, level, description) VALUES
  ('SYSTEM', 'system_admin',       'System Admin',       1, 'Toàn quyền. Chỉ quản lý qua seed/CLI'),
  ('SYSTEM', 'tenant_admin',       'Tenant Admin',       2, 'Quản trị toàn tổ chức'),
  ('SYSTEM', 'company_admin',      'Company Admin',      3, 'Quản trị một công ty và các công ty con'),
  ('SYSTEM', 'department_manager', 'Department Manager', 4, 'Quản lý phòng ban và các phòng con'),
  ('SYSTEM', 'member',             'Member',             5, 'Nhân viên: làm việc với tài liệu');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
 WHERE r.owner_kind = 'SYSTEM' AND r.key IN ('system_admin', 'tenant_admin');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM (VALUES
  ('company_admin', 'org_unit.read'), ('company_admin', 'org_unit.manage'),
  ('company_admin', 'company_domain.manage'),
  ('company_admin', 'user.read'), ('company_admin', 'user.create'),
  ('company_admin', 'user_affiliation.manage'),
  ('company_admin', 'role.read'), ('company_admin', 'role.manage'),
  ('company_admin', 'user_role.read'), ('company_admin', 'user_role.assign'),
  ('company_admin', 'user_role.revoke'),
  ('company_admin', 'document.read'), ('company_admin', 'document.create'),
  ('company_admin', 'document.update'), ('company_admin', 'document.delete'),
  ('company_admin', 'authorization_audit.read'),

  ('department_manager', 'org_unit.read'), ('department_manager', 'user.read'),
  ('department_manager', 'role.read'), ('department_manager', 'user_role.read'),
  ('department_manager', 'user_role.assign'), ('department_manager', 'user_role.revoke'),
  ('department_manager', 'document.read'), ('department_manager', 'document.create'),
  ('department_manager', 'document.update'), ('department_manager', 'document.delete'),

  ('member', 'org_unit.read'), ('member', 'user.read'), ('member', 'role.read'),
  ('member', 'document.read'), ('member', 'document.create'), ('member', 'document.update')
) AS m(role_key, perm_key)
JOIN roles r ON r.key = m.role_key AND r.owner_kind = 'SYSTEM'
JOIN permissions p ON p.key = m.perm_key;

-- Công ty gốc và domain của nó
INSERT INTO org_units (tenant_id, unit_type, code, name)
SELECT id, 'COMPANY', 'HOLDING', 'NHG Demo Holding' FROM tenants WHERE key = 'nhg-demo';

INSERT INTO company_domains (tenant_id, company_id, domain, status)
SELECT tenant_id, id, 'holding.test', 'ACTIVE' FROM org_units WHERE code = 'HOLDING';

-- System admin: tạo trước, gắn auth_subject ở lần đăng nhập đầu (khớp dev-mock-idp.json)
INSERT INTO principals (email, display_name) VALUES ('sysadmin@holding.test', 'System Admin');

INSERT INTO tenant_memberships (tenant_id, principal_id)
SELECT t.id, p.id FROM tenants t, principals p
 WHERE t.key = 'nhg-demo' AND p.email = 'sysadmin@holding.test';

INSERT INTO user_affiliations (tenant_id, principal_id, company_id)
SELECT o.tenant_id, p.id, o.id FROM org_units o, principals p
 WHERE o.code = 'HOLDING' AND p.email = 'sysadmin@holding.test';

INSERT INTO tenant_role_assignments (tenant_id, principal_id, role_id, scope_type)
SELECT t.id, p.id, r.id, 'TENANT'
  FROM tenants t, principals p, roles r
 WHERE t.key = 'nhg-demo' AND p.email = 'sysadmin@holding.test'
   AND r.owner_kind = 'SYSTEM' AND r.key = 'system_admin';

COMMIT;
