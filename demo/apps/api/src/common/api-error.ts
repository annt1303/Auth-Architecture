import type { ErrorCode } from '@authz-demo/authz-types';
import type { z } from 'zod';

// Hợp đồng lỗi (tài liệu gốc §12.4, SPEC §11): thông điệp cố định theo mã,
// không bao giờ lặp lại id tenant, id tài nguyên, quyền hay chi tiết chính sách.
export const ERROR_STATUS: Record<ErrorCode, number> = {
  unauthenticated: 401,
  invalid_request: 400,
  tenant_access_denied: 403,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  authorization_unavailable: 503,
  internal_error: 500,
};

export const ERROR_MESSAGE: Record<ErrorCode, string> = {
  unauthenticated: 'Authentication is required.',
  invalid_request: 'The request is invalid.',
  tenant_access_denied: 'Access to the requested tenant is not permitted.',
  forbidden: 'You do not have permission to perform this action.',
  not_found: 'The requested resource was not found.',
  conflict: 'The request conflicts with existing data.',
  authorization_unavailable: 'Authorization is temporarily unavailable. Retry later.',
  internal_error: 'An internal error occurred.',
};

export type ErrorDetail = { field: string; issue: string };

export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly details?: ErrorDetail[],
  ) {
    super(code);
  }
}

// Kiểm tra đầu vào; chỉ báo lại các trường của chính client.
export function parseInput<S extends z.ZodType>(schema: S, value: unknown): z.infer<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ApiError(
      'invalid_request',
      result.error.issues.map((i) => ({ field: i.path.join('.') || '(root)', issue: i.message })),
    );
  }
  return result.data;
}

// Vi phạm bất biến do DB thực thi (trigger, CHECK, UNIQUE, FK) là xung đột với dữ liệu hiện có (SPEC §11).
// Thông điệp gốc của DB không bao giờ ra khỏi API.
const DB_CONFLICT_CODES = new Set(['23505', '23514', '23503', '23502', 'P0001']);

export function mapDbError(err: unknown): unknown {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' && DB_CONFLICT_CODES.has(code) ? new ApiError('conflict') : err;
}
