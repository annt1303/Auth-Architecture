import type { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { correlationMiddleware, ErrorFilter, originGuardMiddleware } from './common/http.js';
import type { Config } from './config/config.js';

// Dùng chung cho main.ts và test, để test chạy đúng cấu hình như khi chạy thật.
export function configureApp(app: INestApplication, config: Config): void {
  app.use(correlationMiddleware);
  app.use(cookieParser());
  app.use(originGuardMiddleware([config.WEB_ORIGIN, config.API_ORIGIN]));
  app.useGlobalFilters(new ErrorFilter());
}
