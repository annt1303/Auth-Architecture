import { randomUUID } from 'node:crypto';
import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { ErrorBody } from '@authz-demo/authz-types';
import type { NextFunction, Request, Response } from 'express';
import { ApiError, ERROR_MESSAGE, ERROR_STATUS } from './api-error.js';

declare global {
  namespace Express {
    interface Request {
      correlationId: string;
      principalId?: string;
    }
  }
}

// Correlation id luôn do server sinh, không nhận từ client (tài liệu gốc §10.1).
export function correlationMiddleware(req: Request, res: Response, next: NextFunction): void {
  req.correlationId = `c-${randomUUID()}`;
  res.setHeader('X-Correlation-Id', req.correlationId);
  next();
}

// Chặn request thay đổi dữ liệu từ origin lạ (SPEC §5.4). Thiếu Origin (curl, test) thì cho qua:
// trình duyệt luôn gửi Origin với POST/PATCH/PUT/DELETE.
export function originGuardMiddleware(allowed: string[]) {
  const origins = new Set(allowed.map((o) => new URL(o).origin));
  return (req: Request, res: Response, next: NextFunction): void => {
    const origin = req.headers.origin;
    if (req.method !== 'GET' && req.method !== 'HEAD' && origin && !origins.has(origin)) {
      sendError(res, req.correlationId, new ApiError('forbidden'));
      return;
    }
    next();
  };
}

export function sendError(res: Response, correlationId: string, err: ApiError): void {
  const body: ErrorBody = {
    error: err.code,
    message: ERROR_MESSAGE[err.code],
    correlationId,
    ...(err.details?.length ? { details: err.details } : {}),
  };
  if (err.code === 'authorization_unavailable') res.setHeader('Retry-After', '5');
  // Ghi đè Content-Type mà handler có thể đã đặt (ví dụ trang HTML của IdP giả lập)
  res.status(ERROR_STATUS[err.code]).type('application/json').json(body);
}

@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger('ErrorFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    sendError(res, req.correlationId, this.toApiError(exception, req));
  }

  private toApiError(exception: unknown, req: Request): ApiError {
    if (exception instanceof ApiError) return exception;
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      if (status === 404) return new ApiError('not_found');
      if (status >= 400 && status < 500) return new ApiError('invalid_request');
    }
    this.logger.error(`[${req.correlationId}] ${String((exception as Error)?.stack ?? exception)}`);
    return new ApiError('internal_error');
  }
}
