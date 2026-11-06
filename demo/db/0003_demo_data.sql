-- =====================================================================
-- Dữ liệu demo (tùy chọn): cây tổ chức, user giả, role tùy chỉnh, tài liệu.
-- Mỗi user minh họa một tình huống phân quyền, xem SPEC.md mục 15.
-- Thảo chưa có vai trò nào (trạng thái rỗng của màn Tôi).
-- Toàn bộ là dữ liệu giả, domain .test; không chứa thông tin cá nhân thật.
-- Không chạy seed mode: mọi thao tác ở đây đi qua cùng trigger như API.
-- =====================================================================
BEGIN;
SET LOCAL app.reason = 'demo data';
SELECT set_config('app.actor_id', (SELECT id::text FROM principals WHERE email = 'sysadmin@holding.test'), true);

-- Cây tổ chức, mỗi câu lệnh một tầng để cha luôn có sẵn trong closure
--   HOLDING
--   ├── ALPHA (công ty)
--   │   ├── ALPHA_LOG (công ty con) ── ALPHA_LOG_OPS (phòng)
--   │   ├── ALPHA_FIN (phòng) ── ALPHA_FIN_AP (team)
--   │   └── ALPHA_IT (phòng) ── ALPHA_IT_INFRA (phòng con) ── ALPHA_IT_INFRA_NET (team)
--   └── BETA (công ty)
--       └── BETA_SALES (phòng) ── BETA_SALES_NORTH (team)
INSERT INTO org_units (tenant_id, unit_type, parent_id, code, name)
SELECT p.tenant_id, v.unit_type, p.id, v.code, v.name
FROM (VALUES
  ('HOLDING', 'COMPANY', 'ALPHA', 'Alpha Corp'),
  ('HOLDING', 'COMPANY', 'BETA',  'Beta Corp')
) AS v(parent_code, unit_type, code, name)
JOIN org_units p ON p.code = v.parent_code;

INSERT INTO org_units (tenant_id, unit_type, parent_id, code, name)
SELECT p.tenant_id, v.unit_type, p.id, v.code, v.name
FROM (VALUES
  ('ALPHA', 'COMPANY',    'ALPHA_LOG',  'Alpha Logistics'),
  ('ALPHA', 'DEPARTMENT', 'ALPHA_FIN',  'Alpha Tài chính'),
  ('ALPHA', 'DEPARTMENT', 'ALPHA_IT',   'Alpha CNTT'),
  ('BETA',  'DEPARTMENT', 'BETA_SALES', 'Beta Kinh doanh')
) AS v(parent_code, unit_type, code, name)
JOIN org_units p ON p.code = v.parent_code;

INSERT INTO org_units (tenant_id, unit_type, parent_id, code, name)
SELECT p.tenant_id, v.unit_type, p.id, v.code, v.name
FROM (VALUES
  ('ALPHA_LOG',  'DEPARTMENT', 'ALPHA_LOG_OPS',    'Alpha Logistics Vận hành'),
  ('ALPHA_FIN',  'TEAM',       'ALPHA_FIN_AP',     'Team Công nợ phải trả'),
  ('ALPHA_IT',   'DEPARTMENT', 'ALPHA_IT_INFRA',   'Hạ tầng'),
  ('BETA_SALES', 'TEAM',       'BETA_SALES_NORTH', 'Team Miền Bắc')
) AS v(parent_code, unit_type, code, name)
JOIN org_units p ON p.code = v.parent_code;

INSERT INTO org_units (tenant_id, unit_type, parent_id, code, name)
SELECT p.tenant_id, 'TEAM', p.id, 'ALPHA_IT_INFRA_NET', 'Team Mạng'
FROM org_units p WHERE p.code = 'ALPHA_IT_INFRA';

-- Domain email
INSERT INTO company_domains (tenant_id, company_id, domain, status, requested_by)
SELECT o.tenant_id, o.id, v.domain, 'ACTIVE', app_actor_id()
FROM (VALUES ('ALPHA', 'alpha.test'), ('ALPHA_LOG', 'alpha-log.test'), ('BETA', 'beta.test')) AS v(code, domain)
JOIN org_units o ON o.code = v.code;

-- User giả. Không seed auth_subject: lần đăng nhập đầu sẽ gắn (SPEC 5.3).
INSERT INTO principals (email, display_name, created_by)
SELECT v.email, v.name, app_actor_id()
FROM (VALUES
  ('an.tenant@holding.test', 'An (Tenant Admin)'),
  ('binh.alpha@alpha.test',  'Bình (Admin Alpha)'),
  ('chi.fin@alpha.test',     'Chi (Trưởng phòng Tài chính)'),
  ('dung.ap@alpha.test',     'Dũng (Nhân viên Công nợ)'),
  ('em.multi@alpha.test',    'Em (Alpha CNTT + Beta Kinh doanh)'),
  ('giang.beta@beta.test',   'Giang (Admin Beta)'),
  ('hoa.log@alpha-log.test', 'Hoa (đang bị tạm ngưng)'),
  ('khanh.temp@alpha.test',  'Khánh (assignment đã hết hạn)'),
  ('thao.ngo@alpha.test',    'Ngô Thị Phương Thảo')
) AS v(email, name);

INSERT INTO tenant_memberships (tenant_id, principal_id, created_by)
SELECT t.id, p.id, app_actor_id()
FROM tenants t CROSS JOIN principals p
WHERE t.key = 'nhg-demo' AND p.email <> 'sysadmin@holding.test';

INSERT INTO user_affiliations (tenant_id, principal_id, company_id, department_id, created_by)
SELECT c.tenant_id, p.id, c.id, d.id, app_actor_id()
FROM (VALUES
  ('an.tenant@holding.test', 'HOLDING',   NULL),
  ('binh.alpha@alpha.test',  'ALPHA',     NULL),
  ('chi.fin@alpha.test',     'ALPHA',     'ALPHA_FIN'),
  ('dung.ap@alpha.test',     'ALPHA',     'ALPHA_FIN'),
  ('em.multi@alpha.test',    'ALPHA',     'ALPHA_IT'),
  ('em.multi@alpha.test',    'BETA',      'BETA_SALES'),
  ('giang.beta@beta.test',   'BETA',      NULL),
  ('hoa.log@alpha-log.test', 'ALPHA_LOG', 'ALPHA_LOG_OPS'),
  ('khanh.temp@alpha.test',  'ALPHA',     'ALPHA_IT'),
  ('thao.ngo@alpha.test',    'ALPHA',     'ALPHA_FIN')
) AS v(email, company_code, department_code)
JOIN principals p ON p.email = v.email
JOIN org_units c ON c.code = v.company_code
LEFT JOIN org_units d ON d.code = v.department_code;

-- Tài liệu
INSERT INTO documents (tenant_id, company_id, department_id, team_id, owner_principal_id, title, status)
SELECT c.tenant_id, c.id, d.id, tm.id, p.id, v.title, v.status
FROM (VALUES
  ('ALPHA',     NULL,            NULL,                 'binh.alpha@alpha.test',  'Chính sách chung Alpha',         'PUBLISHED'),
  ('ALPHA',     'ALPHA_FIN',     NULL,                 'chi.fin@alpha.test',     'Quy chế tài chính Alpha',        'PUBLISHED'),
  ('ALPHA',     'ALPHA_FIN',     'ALPHA_FIN_AP',       'dung.ap@alpha.test',     'Bảng đối soát công nợ tháng 10', 'DRAFT'),
  ('ALPHA',     'ALPHA_IT_INFRA','ALPHA_IT_INFRA_NET', 'em.multi@alpha.test',    'Sơ đồ mạng văn phòng',           'DRAFT'),
  ('ALPHA_LOG', 'ALPHA_LOG_OPS', NULL,                 'hoa.log@alpha-log.test', 'Kế hoạch vận hành kho',          'PUBLISHED'),
  ('BETA',      'BETA_SALES',    'BETA_SALES_NORTH',   'giang.beta@beta.test',   'Báo cáo doanh số miền Bắc',      'PUBLISHED'),
  ('BETA',      'BETA_SALES',    NULL,                 'em.multi@alpha.test',    'Ghi chú khách hàng của Em',      'DRAFT'),
  -- tên dài hai dòng, để thấy giao diện xử lý ca biên
  ('BETA',      'BETA_SALES',    'BETA_SALES_NORTH',   'giang.beta@beta.test',
   'Hướng dẫn đối soát chi phí công tác và tạm ứng cho đội kinh doanh khu vực miền Bắc năm 2026', 'DRAFT')
) AS v(company_code, department_code, team_code, owner_email, title, status)
JOIN org_units c ON c.code = v.company_code
LEFT JOIN org_units d ON d.code = v.department_code
LEFT JOIN org_units tm ON tm.code = v.team_code
JOIN principals p ON p.email = v.owner_email;

-- Assignment do system admin cấp
INSERT INTO tenant_role_assignments
  (tenant_id, principal_id, role_id, scope_type, scope_id, scope_resource_type, valid_from, valid_until, created_by)
SELECT p_t.id, p.id, r.id, v.scope_type,
       CASE v.scope_type WHEN 'RESOURCE' THEN doc.id ELSE o.id END,
       CASE v.scope_type WHEN 'RESOURCE' THEN 'document' END,
       v.valid_from, v.valid_until, app_actor_id()
FROM (VALUES
  ('an.tenant@holding.test', 'tenant_admin',       'TENANT',     NULL,             NULL,                     NULL::timestamptz,         NULL::timestamptz),
  ('binh.alpha@alpha.test',  'company_admin',      'COMPANY',    'ALPHA',          NULL,                     NULL,                      NULL),
  ('chi.fin@alpha.test',     'department_manager', 'DEPARTMENT', 'ALPHA_FIN',      NULL,                     NULL,                      NULL),
  ('dung.ap@alpha.test',     'member',             'TEAM',       'ALPHA_FIN_AP',   NULL,                     NULL,                      NULL),
  ('dung.ap@alpha.test',     'member',             'SELF',       NULL,             NULL,                     NULL,                      NULL),
  ('em.multi@alpha.test',    'member',             'DEPARTMENT', 'ALPHA_IT',       NULL,                     NULL,                      NULL),
  ('em.multi@alpha.test',    'member',             'COMPANY',    'BETA',           NULL,                     NULL,                      NULL),
  ('giang.beta@beta.test',   'company_admin',      'COMPANY',    'BETA',           NULL,                     NULL,                      NULL),
  ('giang.beta@beta.test',   'member',             'RESOURCE',   NULL,             'Chính sách chung Alpha', NULL,                      NULL),
  ('hoa.log@alpha-log.test', 'member',             'COMPANY',    'ALPHA_LOG',      NULL,                     NULL,                      NULL),
  ('khanh.temp@alpha.test',  'member',             'DEPARTMENT', 'ALPHA_IT',       NULL,                     now() - interval '30 days', now() - interval '1 day'),
  ('khanh.temp@alpha.test',  'department_manager', 'DEPARTMENT', 'ALPHA_IT_INFRA', NULL,                     now() + interval '25 days', NULL)
) AS v(email, role_key, scope_type, unit_code, doc_title, valid_from, valid_until)
JOIN principals p ON p.email = v.email
JOIN roles r ON r.key = v.role_key AND r.owner_kind = 'SYSTEM'
CROSS JOIN (SELECT id FROM tenants WHERE key = 'nhg-demo') p_t
LEFT JOIN org_units o ON o.code = v.unit_code
LEFT JOIN documents doc ON doc.title = v.doc_title;

-- Role tùy chỉnh. Bình (admin Alpha) tạo role công ty và gán nó, nên actor là Bình.
SELECT set_config('app.actor_id', (SELECT id::text FROM principals WHERE email = 'binh.alpha@alpha.test'), true);

INSERT INTO roles (owner_kind, tenant_id, owner_company_id, key, name, level, description, created_by)
SELECT 'COMPANY', o.tenant_id, o.id, 'custom.finance_reviewer', 'Người duyệt tài chính (Alpha)', 4,
       'Xem và sửa tài liệu tài chính. Chỉ dùng trong Alpha và công ty con', app_actor_id()
FROM org_units o WHERE o.code = 'ALPHA';

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
  ON p.key IN ('org_unit.read', 'user.read', 'document.read', 'document.update')
WHERE r.key = 'custom.finance_reviewer';

INSERT INTO tenant_role_assignments (tenant_id, principal_id, role_id, scope_type, scope_id, created_by)
SELECT p.tenant_id, p.principal_id, r.id, 'DEPARTMENT', o.id, app_actor_id()
FROM tenant_memberships p
JOIN principals u ON u.id = p.principal_id AND u.email = 'khanh.temp@alpha.test'
JOIN roles r ON r.key = 'custom.finance_reviewer'
JOIN org_units o ON o.code = 'ALPHA_FIN';

-- Role cấp tổ chức do An (tenant admin) tạo, chưa gán cho ai
SELECT set_config('app.actor_id', (SELECT id::text FROM principals WHERE email = 'an.tenant@holding.test'), true);

INSERT INTO roles (owner_kind, tenant_id, key, name, level, description, created_by)
SELECT 'TENANT', t.id, 'custom.auditor', 'Kiểm toán viên', 3,
       'Chỉ đọc: user, role, assignment, audit. Gán ở scope TENANT', app_actor_id()
FROM tenants t WHERE t.key = 'nhg-demo';

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
  ON p.key IN ('org_unit.read', 'user.read', 'role.read', 'user_role.read', 'authorization_audit.read')
WHERE r.key = 'custom.auditor';

-- Giang (admin Beta) đề xuất một domain mới, đang chờ tenant admin duyệt
SELECT set_config('app.actor_id', (SELECT id::text FROM principals WHERE email = 'giang.beta@beta.test'), true);

INSERT INTO company_domains (tenant_id, company_id, domain, status, requested_by)
SELECT o.tenant_id, o.id, 'beta-partner.test', 'PENDING', app_actor_id()
FROM org_units o WHERE o.code = 'BETA';

-- Hoa bị tạm ngưng: assignment vẫn ACTIVE nhưng không còn hiệu lực (R2)
SELECT set_config('app.actor_id', (SELECT id::text FROM principals WHERE email = 'an.tenant@holding.test'), true);

UPDATE tenant_memberships SET status = 'SUSPENDED'
WHERE principal_id = (SELECT id FROM principals WHERE email = 'hoa.log@alpha-log.test');

COMMIT;
