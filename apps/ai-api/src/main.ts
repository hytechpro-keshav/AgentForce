import "reflect-metadata";

import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

import { AppModule } from "./app.module";
import { AppConfigService } from "./config/app-config.service";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get(AppConfigService);
  const corsAllowedOrigins = new Set(config.cors.allowedOrigins);

  if (corsAllowedOrigins.size > 0) {
    app.enableCors({
      allowedHeaders: ["authorization", "content-type"],
      credentials: false,
      maxAge: 600,
      methods: ["GET", "POST", "OPTIONS"],
      origin(
        origin: string | undefined,
        callback: (error: Error | null, allow?: boolean) => void
      ) {
        callback(null, !origin || corsAllowedOrigins.has(origin));
      }
    });
  }

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false }
    })
  );

  await app.listen(config.port);
}

void bootstrap();
