# Enterprise Authorization Architecture

Kiến trúc tham chiếu và đặc tả triển khai cho hệ thống phân quyền (authorization) trong ứng dụng doanh nghiệp đa tenant.

> **Lưu ý:** Đây là tài liệu đặc tả (specification), không phải hệ thống đã được triển khai hay kiểm chứng trong môi trường thực tế. Xem mục "Document scope and evidence levels" trong tài liệu.

## Tài liệu

| File | Ngôn ngữ | Phiên bản |
|---|---|---|
| [enterprise-authorization-architecture-v1_4_1.md](enterprise-authorization-architecture-v1_4_1.md) | English | 1.4.1 |
| [enterprise-authorization-architecture-v1_4_1-vi.md](enterprise-authorization-architecture-v1_4_1-vi.md) | Tiếng Việt | 1.4.1 |

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
