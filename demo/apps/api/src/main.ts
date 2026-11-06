import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import { loadConfig } from './config/config.js';

async function bootstrap() {
  const config = loadConfig();
  const app = await NestFactory.create(AppModule.register(config));
  configureApp(app, config);
  await app.listen(config.PORT);
}
await bootstrap();
