import 'reflect-metadata';
import { Controller, Get } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { Authorize } from '../src/authz/decorators.js';
import { loadConfig } from '../src/config/config.js';
import { createApp } from './helpers.js';

@Controller('unguarded')
class UnguardedController {
  @Get()
  leak(): string {
    return 'should never be reachable';
  }
}

@Controller('typo')
class UnknownActionController {
  @Get(':id')
  @Authorize('document.raed', 'document')
  read(): string {
    return 'never';
  }
}

async function boot(controller: new () => unknown): Promise<void> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.register(loadConfig())],
    controllers: [controller],
  }).compile();
  const app = moduleRef.createNestApplication();
  try {
    await app.init();
  } finally {
    await app.close();
  }
}

// Mặc định từ chối ở tầng route (SPEC §4, tài liệu gốc §25.1)
describe('Kiểm tra độ bao phủ của PEP lúc khởi động', () => {
  it('app thật khởi động được: mọi route đều có decorator phân quyền', async () => {
    const app = await createApp();
    await app.close();
  });

  it('route thiếu decorator làm app không khởi động', async () => {
    await expect(boot(UnguardedController)).rejects.toThrow('UnguardedController.leak has no authorization decorator');
  });

  it('action không có trong catalog làm app không khởi động', async () => {
    await expect(boot(UnknownActionController)).rejects.toThrow('"document.raed" which is not in the permission catalog');
  });
});
