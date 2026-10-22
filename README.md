# Enterprise Authorization Architecture

Kiến trúc tham chiếu và đặc tả triển khai cho hệ thống phân quyền (authorization) trong ứng dụng doanh nghiệp đa tenant.

> **Lưu ý:** Đây là tài liệu đặc tả (specification), không phải hệ thống đã được triển khai hay kiểm chứng trong môi trường thực tế. Xem mục "Document scope and evidence levels" trong tài liệu.

## Tài liệu

| File | Ngôn ngữ | Phiên bản |
|---|---|---|
| [enterprise-authorization-architecture-v1_4_1.md](enterprise-authorization-architecture-v1_4_1.md) | English | 1.4.1 |
| [enterprise-authorization-architecture-v1_4_1-vi.md](enterprise-authorization-architecture-v1_4_1-vi.md) | Tiếng Việt | 1.4.1 |

## Kiến trúc tổng quan

### Luồng xử lý một request

```mermaid
flowchart TD
    Client["Client"] -->|"1. Credential"| IdP["Identity Provider<br/>xác thực, cấp token"]
    IdP -->|"401 nếu sai"| PEP

    subgraph Enforce["Điểm thực thi (PEP)"]
        PEP["PEP<br/>áp dụng quyết định và obligation"]
        CB["Context Builder<br/>TrustedContext từ token và tra cứu phía server"]
        RR["Resource Resolver<br/>tải resource, truy vấn có tenant predicate"]
    end

    subgraph Decide["Điểm quyết định (PDP)"]
        PDP["PDP<br/>Phase A: ngữ cảnh<br/>Phase B: bất biến<br/>Phase C: ứng viên<br/>Phase D: kết hợp<br/>Phase E: obligation"]
        Data["Dữ liệu phân quyền<br/>membership, role, assignment,<br/>permission catalog, policy"]
    end

    subgraph Access["Truy cập dữ liệu"]
        DAL["Data-Access Layer<br/>tenant predicate + FilterPlan"]
        DB[("Database<br/>constraint, trigger, RLS tùy chọn")]
    end

    subgraph AuditSub["Audit"]
        Outbox["Audit Outbox<br/>cùng database với dữ liệu"]
        Relay["Relay"]
        Sink["Audit Sink"]
    end

    PEP --> CB --> RR --> PDP
    PDP --> Data
    PDP -->|"ALLOW / DENY + obligation + FilterPlan"| PEP
    PEP -->|"chỉ khi ALLOW"| DAL --> DB
    DB -.->|"cùng transaction"| Outbox
    PEP -.-> Outbox
    PDP -.-> Outbox
    Outbox --> Relay --> Sink

    Cache["Cache<br/>không phải nguồn sự thật"] -.-> PDP
```

Nguyên tắc chính:

- Deny-by-default: không có `ALLOW` tường minh thì từ chối; thiếu dữ liệu hoặc lỗi phụ thuộc thì **fail closed**.
- Authentication chỉ xác định danh tính, không đồng nghĩa với quyền.
- Giá trị từ client chỉ là gợi ý, không bao giờ là đầu vào của quyết định.
- Data-Access Layer luôn thêm tenant predicate và `FilterPlan` cho mọi truy vấn dữ liệu của tenant.
- PEP và PDP có thể là hai module trong cùng một ứng dụng, miễn là trách nhiệm được tách bạch.

### Mô hình dữ liệu phân quyền

```mermaid
erDiagram
    PRINCIPALS ||--o{ TENANT_MEMBERSHIPS : "có"
    TENANTS ||--o{ TENANT_MEMBERSHIPS : "có"
    TENANT_MEMBERSHIPS ||--o{ TENANT_ROLE_ASSIGNMENTS : "phải ACTIVE để nhận"
    ROLES ||--o{ TENANT_ROLE_ASSIGNMENTS : "được gán"
    PRINCIPALS ||--o{ PLATFORM_ROLE_ASSIGNMENTS : "nắm giữ"
    ROLES ||--o{ PLATFORM_ROLE_ASSIGNMENTS : "được gán"
    ROLES ||--o{ ROLE_PERMISSIONS : "gồm"
    PERMISSIONS ||--o{ ROLE_PERMISSIONS : "thuộc"
```

- **Hai bảng gán quyền riêng:** `tenant_role_assignments` (có tenant và scope) và `platform_role_assignments` (không có tenant, không có scope), để cơ sở dữ liệu bảo đảm quyền platform và quyền tenant không bao giờ lẫn nhau.
- **Role không mang scope.** Scope nằm ở assignment: `TENANT`, `COMPANY`, `DEPARTMENT`, `TEAM`, `RESOURCE` hoặc `SELF`.
- **Quyền hiệu lực** của một assignment cần đồng thời: trạng thái `ACTIVE`, trong thời hạn hiệu lực, role được phép dùng trong tenant, membership `ACTIVE` và tenant `ACTIVE`.

## Nội dung chính

- **Mục tiêu và baseline khuyến nghị:** least privilege, deny-by-default, fail-closed (mục 1)
- **Mô hình phân quyền:** permission catalog, role, assignment, scope (mục 6 - 9)
- **Tenant isolation:** mô hình tenant/company/department, database RLS (mục 5, 20)
- **Đánh giá quyền:** trusted context, PDP/PEP, thuật toán kết hợp quyết định, ma trận xử lý lỗi (mục 10 - 16)
- **Phân quyền cho collection và bulk:** `FilterPlan` có kiểu (mục 13)
- **Nâng cao (tùy chọn):** delegation, impersonation, break-glass, governance (mục 18 - 21)
- **Audit, caching, thu hồi quyền:** mục 22 - 23
- **Kiểm thử và triển khai:** threat model, test catalog, các giai đoạn và tiêu chí hoàn thành (mục 24 - 25)
- **Phụ lục:** change log, ma trận xử lý finding, giả định, bằng chứng kiểm chứng (Appendix A - D)

## Cách đọc

Các mục được gắn nhãn:

- **[Baseline]**: khuyến nghị cho hầu hết ứng dụng doanh nghiệp.
- **[Optional]**: chỉ áp dụng khi có yêu cầu cụ thể.
- **Assumption An**: lựa chọn thiết kế phụ thuộc yêu cầu nghiệp vụ, liệt kê ở Appendix C.

Tài liệu là baseline có thể tái sử dụng, không bắt buộc triển khai mọi pattern. Hãy chọn thiết kế đơn giản nhất đáp ứng yêu cầu và ghi lại các quyết định lớn bằng ADR.
