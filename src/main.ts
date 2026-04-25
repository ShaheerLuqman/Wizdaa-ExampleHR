import 'dotenv/config';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ApiExceptionFilter } from './common/api-exception.filter';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const httpLogger = new Logger('HTTP');
  const app = await NestFactory.create(AppModule);

  app.use(
    (
      req: { method?: string; originalUrl?: string },
      res: { statusCode?: number; on: (event: 'finish', cb: () => void) => void },
      next: () => void,
    ) => {
      const method = req.method ?? 'UNKNOWN';
      const url = req.originalUrl ?? 'UNKNOWN_URL';
      const startedAt = Date.now();

      httpLogger.log(`--> ${method} ${url}`);
      res.on('finish', () => {
        const durationMs = Date.now() - startedAt;
        const statusCode = res.statusCode ?? 200;
        const completedLine = `<-- ${method} ${url} ${statusCode} +${durationMs}ms`;
        httpLogger.log(completedLine);
      });

      next();
    },
  );

  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      // Allow browser-less tools (Postman/curl) and localhost FE variants.
      if (!origin) {
        callback(null, true);
        return;
      }

      const allowedOrigins = new Set([
        process.env.FRONTEND_ORIGIN ?? 'http://localhost:3001',
        'http://127.0.0.1:3001',
        'http://localhost:3001',
      ]);

      callback(null, allowedOrigins.has(origin));
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: '*',
    preflightContinue: false,
    optionsSuccessStatus: 204,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new ApiExceptionFilter());
  logger.log('HTTP request logging enabled (main middleware).');

  await app.listen(process.env.PORT ?? 3000);
}

void bootstrap();
