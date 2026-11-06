-- =====================================================================
-- Mini app phân quyền: schema (PostgreSQL 16)
--
-- Dựa trên DDL tham chiếu mục 8.3 của enterprise-authorization-architecture v1.4.1,
-- rút gọn cho 1 tenant và mở rộng theo SPEC.md:
--   org_units có cấp bậc (closure table), role thuộc công ty, level role 1..5,
--   domain email theo công ty, user_affiliations.
-- Các điểm lệch so với tài liệu gốc: SPEC.md mục 17.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Bảng
-- ---------------------------------------------------------------------

CREATE TABLE tenants (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key        text NOT NULL UNIQUE CHECK (key ~ '^[a-z][a-z0-9-]*$'),
  name       text NOT NULL,
  status     text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Danh tính. auth_subject được gắn ở lần đăng nhập SSO đầu tiên (user được tạo trước, SPEC 5.3).
CREATE TABLE principals (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_type text NOT NULL DEFAULT 'USER' CHECK (principal_type = 'USER'),
  status         text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DISABLED')),
  email          text NOT NULL UNIQUE
                 CHECK (email = lower(email) AND email ~ '^[^@\s]+@([a-z0-9-]+\.)+[a-z]{2,}$'),
  email_domain   text GENERATED ALWAYS AS (split_part(email, '@', 2)) STORED,
  display_name   text NOT NULL,
  auth_provider  text,
  auth_subject   text,
  linked_at      timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (auth_provider, auth_subject),
  CHECK ((auth_provider IS NULL) = (auth_subject IS NULL)),
  CHECK ((auth_subject IS NULL) = (linked_at IS NULL))
);

-- ended_at được đặt khi và chỉ khi REMOVED (tài liệu 8.5.4)
CREATE TABLE tenant_memberships (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  principal_id uuid NOT NULL REFERENCES principals(id),
  status       text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED','REMOVED')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid,
  ended_at     timestamptz,
  UNIQUE (tenant_id, principal_id),
  CONSTRAINT memberships_ended_at_ck CHECK ((status = 'REMOVED') = (ended_at IS NOT NULL))
);

-- Cây tổ chức: COMPANY (có thể lồng nhau) > DEPARTMENT (có thể lồng nhau) > TEAM.
-- company_id là công ty sở hữu gần nhất (với COMPANY thì bằng chính id), do trigger điền.
-- parent_id bất biến ở v1: không chuyển đơn vị (tài liệu 17.2).
CREATE TABLE org_units (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id),
  unit_type  text NOT NULL CHECK (unit_type IN ('COMPANY','DEPARTMENT','TEAM')),
  parent_id  uuid,
  company_id uuid NOT NULL,
  code       text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]*$'),
  name       text NOT NULL,
  status     text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ARCHIVED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  UNIQUE (tenant_id, code),
  UNIQUE (id, tenant_id),
  FOREIGN KEY (parent_id, tenant_id) REFERENCES org_units (id, tenant_id),
  FOREIGN KEY (company_id, tenant_id) REFERENCES org_units (id, tenant_id),
  CHECK (parent_id IS DISTINCT FROM id),
  CHECK ((unit_type = 'COMPANY') = (company_id = id)),
  CHECK (unit_type = 'COMPANY' OR parent_id IS NOT NULL)
);

-- Mọi cặp (tổ tiên, hậu duệ), kể cả (u, u) với depth 0. Do trigger duy trì.
-- "Scope S bao phủ đơn vị U" <=> tồn tại dòng (ancestor_id = S, descendant_id = U).
CREATE TABLE org_unit_closure (
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  ancestor_id   uuid NOT NULL REFERENCES org_units(id),
  descendant_id uuid NOT NULL REFERENCES org_units(id),
  depth         integer NOT NULL CHECK (depth >= 0),
  PRIMARY KEY (ancestor_id, descendant_id)
);
CREATE INDEX org_unit_closure_descendant_idx ON org_unit_closure (descendant_id);

CREATE TABLE company_domains (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  company_id   uuid NOT NULL,
  domain       text NOT NULL CHECK (domain = lower(domain) AND domain ~ '^([a-z0-9-]+\.)+[a-z]{2,}$'),
  status       text NOT NULL DEFAULT 'PENDING'
               CHECK (status IN ('PENDING','ACTIVE','REJECTED','REVOKED')),
  requested_by uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  decided_by   uuid,
  decided_at   timestamptz,
  revoked_by   uuid,
  revoked_at   timestamptz,
  FOREIGN KEY (company_id, tenant_id) REFERENCES org_units (id, tenant_id),
  CHECK ((status = 'PENDING') = (decided_at IS NULL)),
  CHECK ((status = 'REVOKED') = (revoked_at IS NOT NULL))
);
-- Một domain chỉ thuộc một công ty tại một thời điểm
CREATE UNIQUE INDEX uq_company_domain_live
  ON company_domains (tenant_id, domain) WHERE status IN ('PENDING','ACTIVE');

-- User thuộc công ty nào, phòng ban nào. Không trao quyền gì (SPEC 6.4).
CREATE TABLE user_affiliations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  principal_id  uuid NOT NULL,
  company_id    uuid NOT NULL,
  department_id uuid,
  org_unit_id   uuid GENERATED ALWAYS AS (coalesce(department_id, company_id)) STORED,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid,
  UNIQUE (principal_id, company_id),
  FOREIGN KEY (tenant_id, principal_id) REFERENCES tenant_memberships (tenant_id, principal_id),
  FOREIGN KEY (company_id, tenant_id) REFERENCES org_units (id, tenant_id),
  FOREIGN KEY (department_id, tenant_id) REFERENCES org_units (id, tenant_id)
);
CREATE INDEX user_affiliations_unit_idx ON user_affiliations (org_unit_id);

-- Không có tầng platform nên không có context_kind; khóa platform.* bị cấm.
-- tenant_scope_only: chỉ assignment scope TENANT mới trao quyền này (SPEC 7.1).
CREATE TABLE permissions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key               text NOT NULL UNIQUE
                    CHECK (key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$' AND key NOT LIKE 'platform.%'),
  resource_type     text NOT NULL,
  action            text NOT NULL,
  risk_level        text NOT NULL CHECK (risk_level IN ('LOW','HIGH')),
  is_visibility     boolean NOT NULL DEFAULT false,
  tenant_scope_only boolean NOT NULL DEFAULT false,
  description       text NOT NULL,
  deprecated_at     timestamptz,
  CHECK (key = resource_type || '.' || action)
);

-- Ba loại chủ sở hữu role (SPEC 7.3). Không bao giờ suy ra chủ sở hữu từ tenant_id IS NULL.
-- level: 1 cao nhất, 5 thấp nhất. Custom role không được level 1.
CREATE TABLE roles (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_kind       text NOT NULL CHECK (owner_kind IN ('SYSTEM','TENANT','COMPANY')),
  tenant_id        uuid REFERENCES tenants(id),
  owner_company_id uuid,
  key              text NOT NULL CHECK (key ~ '^(custom\.)?[a-z][a-z0-9_]*$'),
  name             text NOT NULL,
  description      text,
  level            smallint NOT NULL CHECK (level BETWEEN 1 AND 5),
  status           text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ARCHIVED')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (owner_company_id, tenant_id) REFERENCES org_units (id, tenant_id),
  UNIQUE NULLS NOT DISTINCT (tenant_id, owner_company_id, key),
  CONSTRAINT roles_ownership_ck CHECK (
       (owner_kind = 'SYSTEM'  AND tenant_id IS NULL     AND owner_company_id IS NULL)
    OR (owner_kind = 'TENANT'  AND tenant_id IS NOT NULL AND owner_company_id IS NULL)
    OR (owner_kind = 'COMPANY' AND tenant_id IS NOT NULL AND owner_company_id IS NOT NULL)),
  CONSTRAINT roles_key_namespace_ck CHECK ((owner_kind = 'SYSTEM') = (key NOT LIKE 'custom.%')),
  CONSTRAINT roles_custom_level_ck CHECK (owner_kind = 'SYSTEM' OR level >= 2),
  CONSTRAINT roles_system_active_ck CHECK (owner_kind <> 'SYSTEM' OR status = 'ACTIVE')
);

CREATE TABLE role_permissions (
  role_id       uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES permissions(id),
  PRIMARY KEY (role_id, permission_id)
);

-- Tài nguyên nghiệp vụ demo. org_unit_id là đơn vị cụ thể nhất chứa tài liệu;
-- scope S bao phủ tài liệu <=> org_unit_id nằm trong cây con của S.
CREATE TABLE documents (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id),
  company_id         uuid NOT NULL,
  department_id      uuid,
  team_id            uuid,
  org_unit_id        uuid GENERATED ALWAYS AS (coalesce(team_id, department_id, company_id)) STORED,
  owner_principal_id uuid NOT NULL REFERENCES principals(id),
  title              text NOT NULL,
  body               text NOT NULL DEFAULT '',
  status             text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PUBLISHED')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz,
  FOREIGN KEY (company_id, tenant_id) REFERENCES org_units (id, tenant_id),
  FOREIGN KEY (department_id, tenant_id) REFERENCES org_units (id, tenant_id),
  FOREIGN KEY (team_id, tenant_id) REFERENCES org_units (id, tenant_id),
  CHECK (team_id IS NULL OR department_id IS NOT NULL)
);
CREATE INDEX documents_scope_idx ON documents (tenant_id, org_unit_id) WHERE deleted_at IS NULL;
CREATE INDEX documents_owner_idx ON documents (tenant_id, owner_principal_id) WHERE deleted_at IS NULL;

CREATE TABLE tenant_role_assignments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id),
  principal_id        uuid NOT NULL,
  role_id             uuid NOT NULL REFERENCES roles(id),
  scope_type          text NOT NULL
                      CHECK (scope_type IN ('TENANT','COMPANY','DEPARTMENT','TEAM','RESOURCE','SELF')),
  scope_id            uuid,
  scope_resource_type text,
  status              text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','REVOKED')),
  valid_from          timestamptz,
  valid_until         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid,
  revoked_at          timestamptz,
  revoked_by          uuid,
  revoke_reason       text,
  FOREIGN KEY (tenant_id, principal_id) REFERENCES tenant_memberships (tenant_id, principal_id),
  CHECK ((scope_type IN ('TENANT','SELF')) = (scope_id IS NULL)),
  CHECK ((scope_type = 'RESOURCE') = (scope_resource_type IS NOT NULL)),
  CHECK (valid_from IS NULL OR valid_until IS NULL OR valid_until > valid_from),
  CHECK ((status = 'REVOKED') = (revoked_at IS NOT NULL)),
  -- không tự cấp quyền (tài liệu 7.8). created_by NULL chỉ dành cho seed.
  CONSTRAINT assignments_no_self_grant_ck CHECK (created_by IS DISTINCT FROM principal_id)
);
CREATE UNIQUE INDEX uq_active_tenant_assignment
  ON tenant_role_assignments (tenant_id, principal_id, role_id, scope_type, scope_id, scope_resource_type)
  NULLS NOT DISTINCT
  WHERE status = 'ACTIVE';
CREATE INDEX tenant_role_assignments_principal_idx
  ON tenant_role_assignments (tenant_id, principal_id) WHERE status = 'ACTIVE';

-- Session phía server. Cookie chỉ chứa token ngẫu nhiên; DB lưu hash của token.
CREATE TABLE auth_sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash   bytea NOT NULL UNIQUE,
  principal_id uuid NOT NULL REFERENCES principals(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  last_seen_at timestamptz,
  revoked_at   timestamptz,
  user_agent   text,
  source_ip    inet,
  CHECK (expires_at > created_at)
);

-- Audit gộp một bảng thay cho outbox + relay + sink (SPEC mục 13).
-- Lớp A: trigger ghi trong cùng transaction với thay đổi. Lớp B: ứng dụng ghi khi từ chối.
-- org_unit_id: đơn vị của sự kiện tại thời điểm ghi, dùng để lọc audit theo scope (SPEC 13.1).
-- NULL nghĩa là sự kiện cấp tenant, chỉ grant TENANT nhìn thấy.
CREATE TABLE audit_events (
  event_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_class      text NOT NULL CHECK (event_class IN ('A','B')),
  event_type       text NOT NULL,
  occurred_at      timestamptz NOT NULL DEFAULT now(),
  tenant_id        uuid,
  org_unit_id      uuid REFERENCES org_units(id),
  actor_id         uuid,
  actor_attributed boolean NOT NULL,
  correlation_id   text,
  target_type      text,
  target_id        uuid,
  payload          jsonb NOT NULL,
  db_user          text NOT NULL DEFAULT session_user
);
CREATE INDEX audit_events_time_idx ON audit_events (occurred_at DESC);
CREATE INDEX audit_events_unit_idx ON audit_events (org_unit_id, occurred_at DESC);
CREATE INDEX audit_events_target_idx ON audit_events (target_type, target_id);


-- ---------------------------------------------------------------------
-- 2. Hàm tiện ích
-- ---------------------------------------------------------------------

-- Seed mode: chỉ script seed/CLI bật (SET LOCAL app.seed_mode = 'on').
-- Đây là chốt chặn chống thao tác nhầm từ API, không phải ranh giới bảo mật (SPEC 17).
CREATE FUNCTION app_seed_mode() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('app.seed_mode', true), '') = 'on'
$$;

-- Actor do dịch vụ khẳng định bằng SET LOCAL app.actor_id (tài liệu 8.5.5)
CREATE FUNCTION app_actor_id() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.actor_id', true), '')::uuid
$$;

CREATE FUNCTION holds_system_admin(p_principal uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM tenant_role_assignments a JOIN roles r ON r.id = a.role_id
     WHERE a.principal_id = p_principal AND a.status = 'ACTIVE'
       AND r.owner_kind = 'SYSTEM' AND r.key = 'system_admin')
$$;

-- Các đơn vị mà một scope đơn vị (COMPANY / DEPARTMENT / TEAM) bao phủ
CREATE FUNCTION scope_covered_units(p_scope_id uuid) RETURNS SETOF uuid LANGUAGE sql STABLE AS $$
  SELECT descendant_id FROM org_unit_closure WHERE ancestor_id = p_scope_id
$$;

-- Định nghĩa tham chiếu của "grant hiệu lực" (tài liệu 8.5.1, 8.7), dùng chung cho PDP và Simulator.
-- Không kiểm tra principals.status và tenants.status: PDP kiểm ở bước B1, B2.
CREATE FUNCTION effective_grants(p_tenant uuid, p_principal uuid, p_permission text, p_now timestamptz)
RETURNS TABLE (assignment_id uuid, role_id uuid, role_key text, role_level smallint,
               scope_type text, scope_id uuid, scope_resource_type text)
LANGUAGE sql STABLE AS $$
  SELECT a.id, r.id, r.key, r.level, a.scope_type, a.scope_id, a.scope_resource_type
  FROM tenant_role_assignments a
  JOIN roles r ON r.id = a.role_id
              AND (r.owner_kind = 'SYSTEM' OR r.tenant_id = a.tenant_id)
  JOIN role_permissions rp ON rp.role_id = r.id
  JOIN permissions p ON p.id = rp.permission_id AND p.key = p_permission
  JOIN tenant_memberships m ON m.tenant_id = a.tenant_id AND m.principal_id = a.principal_id
                           AND m.status = 'ACTIVE'
  WHERE a.tenant_id = p_tenant AND a.principal_id = p_principal AND a.status = 'ACTIVE'
    AND (a.valid_from IS NULL OR a.valid_from <= p_now)
    AND (a.valid_until IS NULL OR p_now < a.valid_until)
    AND (NOT p.tenant_scope_only OR a.scope_type = 'TENANT')
$$;


-- ---------------------------------------------------------------------
-- 3. Trigger bảo vệ bất biến
-- ---------------------------------------------------------------------

-- principals: updated_at, và không vô hiệu hóa system admin ngoài seed/CLI
CREATE FUNCTION trg_principals_before() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status <> 'ACTIVE' AND OLD.status = 'ACTIVE'
     AND holds_system_admin(NEW.id) AND NOT app_seed_mode() THEN
    RAISE EXCEPTION 'a system admin can only be disabled via seed/CLI'
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER principals_before BEFORE UPDATE ON principals
  FOR EACH ROW EXECUTE FUNCTION trg_principals_before();

-- Vòng đời membership, quy tắc R1..R5 (tài liệu 8.5.2, 8.5.4)
CREATE FUNCTION trg_membership_before() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'REMOVED' AND NEW.ended_at IS NULL THEN NEW.ended_at := now(); END IF;
    RETURN NEW;
  END IF;
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.principal_id IS DISTINCT FROM OLD.principal_id THEN
    RAISE EXCEPTION 'tenant and principal of a membership are immutable'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'ACTIVE' AND NEW.status <> 'ACTIVE'
     AND holds_system_admin(NEW.principal_id) AND NOT app_seed_mode() THEN
    RAISE EXCEPTION 'the membership of a system admin can only be changed via seed/CLI'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'REMOVED' AND OLD.status <> 'REMOVED' THEN
    NEW.ended_at := coalesce(NEW.ended_at, now());
  ELSIF NEW.status = 'REMOVED' AND OLD.status = 'REMOVED' THEN
    IF NEW.ended_at IS DISTINCT FROM OLD.ended_at THEN
      RAISE EXCEPTION 'ended_at of a removed membership cannot be changed'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF OLD.status = 'REMOVED' AND NEW.status <> 'REMOVED' THEN
    IF EXISTS (SELECT 1 FROM tenant_role_assignments
                WHERE tenant_id = NEW.tenant_id AND principal_id = NEW.principal_id
                  AND status = 'ACTIVE') THEN
      RAISE EXCEPTION 'membership has ACTIVE assignments; revoke them before reinstatement'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.ended_at := NULL;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER membership_before BEFORE INSERT OR UPDATE ON tenant_memberships
  FOR EACH ROW EXECUTE FUNCTION trg_membership_before();

-- R4: loại bỏ membership thì thu hồi mọi assignment ACTIVE trong cùng transaction
CREATE FUNCTION trg_membership_ended() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'REMOVED' AND OLD.status <> 'REMOVED' THEN
    UPDATE tenant_role_assignments
       SET status = 'REVOKED', revoked_at = now(), revoked_by = app_actor_id(),
           revoke_reason = 'MEMBERSHIP_ENDED'
     WHERE tenant_id = NEW.tenant_id AND principal_id = NEW.principal_id AND status = 'ACTIVE';
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER membership_ended AFTER UPDATE OF status ON tenant_memberships
  FOR EACH ROW EXECUTE FUNCTION trg_membership_ended();

-- org_units: quy tắc lồng nhau, điền company_id, cấu trúc bất biến
CREATE FUNCTION trg_org_units_before() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  p org_units%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.unit_type IS DISTINCT FROM OLD.unit_type
       OR NEW.parent_id IS DISTINCT FROM OLD.parent_id OR NEW.company_id IS DISTINCT FROM OLD.company_id THEN
      RAISE EXCEPTION 'org unit structure (tenant, type, parent, company) is immutable in v1'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.parent_id IS NULL THEN
    IF NEW.unit_type <> 'COMPANY' THEN
      RAISE EXCEPTION 'only a COMPANY can be a root unit' USING ERRCODE = 'check_violation';
    END IF;
    NEW.company_id := NEW.id;
    RETURN NEW;
  END IF;

  SELECT * INTO p FROM org_units WHERE id = NEW.parent_id AND tenant_id = NEW.tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'parent unit % not found in tenant', NEW.parent_id USING ERRCODE = 'check_violation';
  END IF;
  IF p.status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'parent unit % is archived', p.code USING ERRCODE = 'check_violation';
  END IF;
  IF NOT ((NEW.unit_type = 'COMPANY'    AND p.unit_type = 'COMPANY')
       OR (NEW.unit_type = 'DEPARTMENT' AND p.unit_type IN ('COMPANY','DEPARTMENT'))
       OR (NEW.unit_type = 'TEAM'       AND p.unit_type = 'DEPARTMENT')) THEN
    RAISE EXCEPTION 'a % cannot be placed under a %', NEW.unit_type, p.unit_type
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.company_id := CASE WHEN NEW.unit_type = 'COMPANY' THEN NEW.id ELSE p.company_id END;
  RETURN NEW;
END $$;
CREATE TRIGGER org_units_before BEFORE INSERT OR UPDATE ON org_units
  FOR EACH ROW EXECUTE FUNCTION trg_org_units_before();

CREATE FUNCTION trg_org_units_closure() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO org_unit_closure (tenant_id, ancestor_id, descendant_id, depth)
  SELECT NEW.tenant_id, NEW.id, NEW.id, 0
  UNION ALL
  SELECT NEW.tenant_id, c.ancestor_id, NEW.id, c.depth + 1
    FROM org_unit_closure c WHERE c.descendant_id = NEW.parent_id;
  RETURN NULL;
END $$;
CREATE TRIGGER org_units_closure AFTER INSERT ON org_units
  FOR EACH ROW EXECUTE FUNCTION trg_org_units_closure();

-- company_domains: chủ sở hữu là COMPANY, chuyển trạng thái hợp lệ
CREATE FUNCTION trg_company_domains_before() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM org_units WHERE id = NEW.company_id AND unit_type = 'COMPANY') THEN
      RAISE EXCEPTION 'company_id must reference a COMPANY unit' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status NOT IN ('PENDING','ACTIVE') THEN
      RAISE EXCEPTION 'a new domain must be PENDING or ACTIVE' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status = 'ACTIVE' THEN
      NEW.decided_at := coalesce(NEW.decided_at, now());
      NEW.decided_by := coalesce(NEW.decided_by, NEW.requested_by);
    END IF;
    RETURN NEW;
  END IF;

  IF (NEW.tenant_id, NEW.company_id, NEW.domain, NEW.requested_by)
     IS DISTINCT FROM (OLD.tenant_id, OLD.company_id, OLD.domain, OLD.requested_by) THEN
    RAISE EXCEPTION 'company, domain and requester are immutable' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'PENDING' AND NEW.status IN ('ACTIVE','REJECTED'))
    OR (OLD.status = 'ACTIVE'  AND NEW.status = 'REVOKED')) THEN
    RAISE EXCEPTION 'invalid domain transition % -> %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'PENDING' AND NEW.status <> 'PENDING' THEN
    NEW.decided_at := coalesce(NEW.decided_at, now());
    NEW.decided_by := coalesce(NEW.decided_by, app_actor_id());
  END IF;
  IF OLD.status = 'ACTIVE' AND NEW.status = 'REVOKED' THEN
    -- thu hồi domain sẽ chặn đăng nhập của mọi user dùng nó; không được khóa system admin ở ngoài
    IF NOT app_seed_mode() AND EXISTS (
         SELECT 1 FROM principals p WHERE p.email_domain = NEW.domain AND holds_system_admin(p.id)) THEN
      RAISE EXCEPTION 'domain % is used by a system admin; change it via seed/CLI', NEW.domain
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.revoked_at := coalesce(NEW.revoked_at, now());
    NEW.revoked_by := coalesce(NEW.revoked_by, app_actor_id());
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER company_domains_before BEFORE INSERT OR UPDATE ON company_domains
  FOR EACH ROW EXECUTE FUNCTION trg_company_domains_before();

-- user_affiliations: công ty là COMPANY, phòng ban thuộc đúng công ty đó
CREATE FUNCTION trg_user_affiliations_before() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  d_type text; d_company uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.tenant_id, NEW.principal_id, NEW.company_id)
     IS DISTINCT FROM (OLD.tenant_id, OLD.principal_id, OLD.company_id) THEN
    RAISE EXCEPTION 'only department_id of an affiliation can change' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM org_units WHERE id = NEW.company_id AND unit_type = 'COMPANY') THEN
    RAISE EXCEPTION 'company_id must reference a COMPANY unit' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.department_id IS NOT NULL THEN
    SELECT unit_type, company_id INTO d_type, d_company FROM org_units WHERE id = NEW.department_id;
    IF d_type IS DISTINCT FROM 'DEPARTMENT' OR d_company IS DISTINCT FROM NEW.company_id THEN
      RAISE EXCEPTION 'department_id must reference a DEPARTMENT of the same company'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER user_affiliations_before BEFORE INSERT OR UPDATE ON user_affiliations
  FOR EACH ROW EXECUTE FUNCTION trg_user_affiliations_before();

-- roles: role hệ thống chỉ đọc, chủ sở hữu và key bất biến (tài liệu 8.2.1)
CREATE FUNCTION trg_roles_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.owner_kind = 'SYSTEM' AND NOT app_seed_mode() THEN
      RAISE EXCEPTION 'system roles cannot be deleted' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF (NEW.owner_kind, NEW.tenant_id, NEW.owner_company_id, NEW.key)
       IS DISTINCT FROM (OLD.owner_kind, OLD.tenant_id, OLD.owner_company_id, OLD.key) THEN
      RAISE EXCEPTION 'role ownership and key are immutable; create a new role'
        USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.owner_kind = 'SYSTEM' AND NOT app_seed_mode() THEN
      RAISE EXCEPTION 'system roles are read-only' USING ERRCODE = 'check_violation';
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  IF NEW.owner_kind = 'SYSTEM' AND NOT app_seed_mode() THEN
    RAISE EXCEPTION 'system roles are created by seed only' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.owner_kind = 'COMPANY' AND NOT EXISTS (
       SELECT 1 FROM org_units WHERE id = NEW.owner_company_id AND unit_type = 'COMPANY') THEN
    RAISE EXCEPTION 'owner_company_id must reference a COMPANY unit' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER roles_guard BEFORE INSERT OR UPDATE OR DELETE ON roles
  FOR EACH ROW EXECUTE FUNCTION trg_roles_guard();

CREATE FUNCTION trg_role_permissions_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'role_permissions rows are insert/delete only' USING ERRCODE = 'check_violation';
  END IF;
  -- khi role bị xóa (cascade), dòng role không còn nên kiểm tra này bỏ qua
  IF (SELECT owner_kind FROM roles WHERE id = coalesce(NEW.role_id, OLD.role_id)) = 'SYSTEM'
     AND NOT app_seed_mode() THEN
    RAISE EXCEPTION 'permissions of a system role are read-only' USING ERRCODE = 'check_violation';
  END IF;
  RETURN coalesce(NEW, OLD);
END $$;
CREATE TRIGGER role_permissions_guard BEFORE INSERT OR UPDATE OR DELETE ON role_permissions
  FOR EACH ROW EXECUTE FUNCTION trg_role_permissions_guard();

-- documents: đơn vị đúng loại và cùng công ty; vị trí và chủ sở hữu bất biến (không chuyển tài nguyên)
CREATE FUNCTION trg_documents_before() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  u org_units%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.tenant_id, NEW.company_id, NEW.department_id, NEW.team_id, NEW.owner_principal_id)
       IS DISTINCT FROM (OLD.tenant_id, OLD.company_id, OLD.department_id, OLD.team_id, OLD.owner_principal_id) THEN
      RAISE EXCEPTION 'document placement and owner are immutable in v1' USING ERRCODE = 'check_violation';
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM org_units WHERE id = NEW.company_id AND unit_type = 'COMPANY') THEN
    RAISE EXCEPTION 'company_id must reference a COMPANY unit' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.team_id IS NOT NULL THEN
    SELECT * INTO u FROM org_units WHERE id = NEW.team_id;
    IF u.unit_type IS DISTINCT FROM 'TEAM' OR u.company_id IS DISTINCT FROM NEW.company_id THEN
      RAISE EXCEPTION 'team_id must reference a TEAM of the same company' USING ERRCODE = 'check_violation';
    END IF;
    -- phòng ban của tài liệu luôn là phòng ban trực tiếp chứa team
    IF NEW.department_id IS NOT NULL AND NEW.department_id <> u.parent_id THEN
      RAISE EXCEPTION 'department_id must be the parent department of team_id' USING ERRCODE = 'check_violation';
    END IF;
    NEW.department_id := u.parent_id;
  ELSIF NEW.department_id IS NOT NULL THEN
    SELECT * INTO u FROM org_units WHERE id = NEW.department_id;
    IF u.unit_type IS DISTINCT FROM 'DEPARTMENT' OR u.company_id IS DISTINCT FROM NEW.company_id THEN
      RAISE EXCEPTION 'department_id must reference a DEPARTMENT of the same company'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER documents_before BEFORE INSERT OR UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION trg_documents_before();

-- tenant_role_assignments: bất biến của assignment (tài liệu 7.5, 8.2.1, 8.4, R1; SPEC 7.3, 8.4)
CREATE FUNCTION trg_assignment_integrity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  r roles%ROWTYPE; m_status text; s_type text; s_unit uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'REVOKED' AND NEW.status <> 'REVOKED' THEN
      RAISE EXCEPTION 'a revoked assignment cannot be reactivated; create a new assignment'
        USING ERRCODE = 'check_violation';
    END IF;
    IF (NEW.tenant_id, NEW.principal_id, NEW.role_id, NEW.scope_type, NEW.scope_id,
        NEW.scope_resource_type, NEW.created_by)
       IS DISTINCT FROM (OLD.tenant_id, OLD.principal_id, OLD.role_id, OLD.scope_type, OLD.scope_id,
        OLD.scope_resource_type, OLD.created_by) THEN
      RAISE EXCEPTION 'who, what and where of an assignment are immutable; revoke and create a new one'
        USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.status = 'ACTIVE' AND NEW.status = 'REVOKED' THEN
      NEW.revoked_at := coalesce(NEW.revoked_at, now());
      NEW.revoked_by := coalesce(NEW.revoked_by, app_actor_id());
    END IF;
  END IF;

  SELECT * INTO r FROM roles WHERE id = NEW.role_id;

  IF TG_OP = 'INSERT' THEN
    IF r.status <> 'ACTIVE' THEN
      RAISE EXCEPTION 'role % is archived', r.key USING ERRCODE = 'check_violation';
    END IF;
    IF NOT (r.owner_kind = 'SYSTEM' OR r.tenant_id = NEW.tenant_id) THEN
      RAISE EXCEPTION 'role % is not assignable in tenant %', r.key, NEW.tenant_id
        USING ERRCODE = 'check_violation';
    END IF;

    -- scope trỏ tới đúng loại đối tượng
    IF NEW.scope_type IN ('COMPANY','DEPARTMENT','TEAM') THEN
      SELECT unit_type INTO s_type FROM org_units WHERE id = NEW.scope_id AND tenant_id = NEW.tenant_id;
      IF s_type IS DISTINCT FROM NEW.scope_type THEN
        RAISE EXCEPTION 'scope_id must reference a % unit of the tenant', NEW.scope_type
          USING ERRCODE = 'check_violation';
      END IF;
      s_unit := NEW.scope_id;
    ELSIF NEW.scope_type = 'RESOURCE' THEN
      IF NEW.scope_resource_type <> 'document' THEN
        RAISE EXCEPTION 'unsupported scope_resource_type %', NEW.scope_resource_type
          USING ERRCODE = 'check_violation';
      END IF;
      SELECT org_unit_id INTO s_unit FROM documents
       WHERE id = NEW.scope_id AND tenant_id = NEW.tenant_id AND deleted_at IS NULL;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'scope document % not found in tenant', NEW.scope_id USING ERRCODE = 'check_violation';
      END IF;
    END IF;

    -- role của công ty chỉ dùng được trong cây của công ty đó
    IF r.owner_kind = 'COMPANY' THEN
      IF NEW.scope_type IN ('TENANT','SELF') THEN
        RAISE EXCEPTION 'a company role cannot be assigned at scope %', NEW.scope_type
          USING ERRCODE = 'check_violation';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM org_unit_closure
                      WHERE ancestor_id = r.owner_company_id AND descendant_id = s_unit) THEN
        RAISE EXCEPTION 'role % can only be assigned inside its owner company', r.key
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;

    IF r.owner_kind = 'SYSTEM' AND r.key = 'system_admin' THEN
      IF NOT app_seed_mode() THEN
        RAISE EXCEPTION 'system_admin can only be granted via seed/CLI' USING ERRCODE = 'check_violation';
      END IF;
      IF NEW.scope_type <> 'TENANT' THEN
        RAISE EXCEPTION 'system_admin must be granted at scope TENANT' USING ERRCODE = 'check_violation';
      END IF;
    END IF;

    -- R1: chỉ membership ACTIVE mới nhận assignment mới. FOR SHARE tuần tự hóa với thay đổi membership.
    SELECT status INTO m_status FROM tenant_memberships
     WHERE tenant_id = NEW.tenant_id AND principal_id = NEW.principal_id FOR SHARE;
    IF m_status IS DISTINCT FROM 'ACTIVE' THEN
      RAISE EXCEPTION 'principal % has no ACTIVE membership', NEW.principal_id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status = 'ACTIVE' AND NEW.status = 'REVOKED'
     AND r.owner_kind = 'SYSTEM' AND r.key = 'system_admin' THEN
    IF NOT app_seed_mode() THEN
      RAISE EXCEPTION 'system_admin can only be revoked via seed/CLI' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM tenant_role_assignments a
          JOIN tenant_memberships m ON m.tenant_id = a.tenant_id AND m.principal_id = a.principal_id
         WHERE a.role_id = NEW.role_id AND a.status = 'ACTIVE' AND a.id <> NEW.id
           AND a.principal_id <> NEW.principal_id AND m.status = 'ACTIVE') THEN
      RAISE EXCEPTION 'at least one other active system_admin must remain' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END $$;
CREATE TRIGGER assignment_integrity BEFORE INSERT OR UPDATE ON tenant_role_assignments
  FOR EACH ROW EXECUTE FUNCTION trg_assignment_integrity();


-- ---------------------------------------------------------------------
-- 4. Audit lớp A bằng trigger (tài liệu 8.5.5, 22.6)
-- ---------------------------------------------------------------------

CREATE FUNCTION trg_audit_row() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  o jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
  n jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
  r jsonb := coalesce(n, o);
  ev text;
  unit uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND o - 'updated_at' = n - 'updated_at' THEN
    RETURN NULL;
  END IF;
  -- Đơn vị của sự kiện (SPEC 13.1). principals, tenant_memberships và role SYSTEM/TENANT là cấp tenant.
  unit := CASE TG_TABLE_NAME
    WHEN 'org_units'         THEN (r->>'id')::uuid
    WHEN 'company_domains'   THEN (r->>'company_id')::uuid
    WHEN 'user_affiliations' THEN coalesce(r->>'department_id', r->>'company_id')::uuid
    WHEN 'roles'             THEN (r->>'owner_company_id')::uuid
    WHEN 'role_permissions'  THEN (SELECT owner_company_id FROM roles WHERE id = (r->>'role_id')::uuid)
    WHEN 'tenant_role_assignments' THEN CASE
      WHEN r->>'scope_type' IN ('COMPANY','DEPARTMENT','TEAM') THEN (r->>'scope_id')::uuid
      WHEN r->>'scope_type' = 'RESOURCE'
        THEN (SELECT org_unit_id FROM documents WHERE id = (r->>'scope_id')::uuid) END
  END;
  ev := TG_TABLE_NAME || '.' || CASE
          WHEN TG_OP = 'INSERT' THEN 'created'
          WHEN TG_OP = 'DELETE' THEN 'deleted'
          WHEN o->>'status' IS DISTINCT FROM n->>'status' THEN 'status_changed'
          ELSE 'modified' END;
  INSERT INTO audit_events (event_class, event_type, tenant_id, org_unit_id, actor_id, actor_attributed,
                            correlation_id, target_type, target_id, payload)
  VALUES ('A', ev, (r->>'tenant_id')::uuid, unit, app_actor_id(), app_actor_id() IS NOT NULL,
          NULLIF(current_setting('app.correlation_id', true), ''),
          TG_TABLE_NAME, coalesce(r->>'id', r->>'role_id')::uuid,
          jsonb_build_object('old', o, 'new', n,
                             'reason', NULLIF(current_setting('app.reason', true), '')));
  RETURN NULL;
END $$;

CREATE TRIGGER audit_principals AFTER INSERT OR UPDATE OR DELETE ON principals
  FOR EACH ROW EXECUTE FUNCTION trg_audit_row();
CREATE TRIGGER audit_tenant_memberships AFTER INSERT OR UPDATE OR DELETE ON tenant_memberships
  FOR EACH ROW EXECUTE FUNCTION trg_audit_row();
CREATE TRIGGER audit_org_units AFTER INSERT OR UPDATE OR DELETE ON org_units
  FOR EACH ROW EXECUTE FUNCTION trg_audit_row();
CREATE TRIGGER audit_company_domains AFTER INSERT OR UPDATE OR DELETE ON company_domains
  FOR EACH ROW EXECUTE FUNCTION trg_audit_row();
CREATE TRIGGER audit_user_affiliations AFTER INSERT OR UPDATE OR DELETE ON user_affiliations
  FOR EACH ROW EXECUTE FUNCTION trg_audit_row();
CREATE TRIGGER audit_roles AFTER INSERT OR UPDATE OR DELETE ON roles
  FOR EACH ROW EXECUTE FUNCTION trg_audit_row();
CREATE TRIGGER audit_role_permissions AFTER INSERT OR DELETE ON role_permissions
  FOR EACH ROW EXECUTE FUNCTION trg_audit_row();
CREATE TRIGGER audit_tenant_role_assignments AFTER INSERT OR UPDATE OR DELETE ON tenant_role_assignments
  FOR EACH ROW EXECUTE FUNCTION trg_audit_row();

-- Audit chỉ được thêm, không sửa, không xóa
CREATE FUNCTION trg_audit_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only' USING ERRCODE = 'check_violation';
END $$;
CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION trg_audit_append_only();
CREATE TRIGGER audit_events_no_truncate BEFORE TRUNCATE ON audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION trg_audit_append_only();
