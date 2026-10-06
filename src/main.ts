import './env.js';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';

const app = await NestFactory.create<NestExpressApplication>(AppModule);
configureApp(app);
// Only trust X-Forwarded-For from these hops (the Next.js server / nginx), so the
// login throttle sees real client IPs without letting callers spoof them.
app.set('trust proxy', process.env.TRUST_PROXY ?? 'loopback');
SwaggerModule.setup('api/docs', app, () =>
  SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('BongoMaker Control API')
      .addBearerAuth()
      .build(),
  ),
);
await app.listen(process.env.PORT ?? 4000);
