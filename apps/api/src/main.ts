import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { ValidationPipe } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import * as dotenv from "dotenv";

async function bootstrap() {
  dotenv.config();
  const isProd = process.env.NODE_ENV === "production";
  if (isProd) {
    const missing = ["MONGO_URI", "JWT_SECRET", "JWT_REFRESH_SECRET"].filter((key) => !process.env[key]);
    if (missing.length) {
      throw new Error(`Missing required env: ${missing.join(", ")}`);
    }
  }

  const corsOriginEnv = process.env.CORS_ORIGINS;
  const corsOrigins = corsOriginEnv
    ? corsOriginEnv.split(",").map((origin) => origin.trim()).filter(Boolean)
    : [];
  const cors = corsOrigins.length === 0 || corsOrigins.includes("*")
    ? true
    : { origin: corsOrigins, credentials: true };

  const app = await NestFactory.create(AppModule, { cors });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true
    })
  );

  const config = new DocumentBuilder()
    .setTitle("Signature Auto Care API")
    .setDescription("MVP API for service, inventory, and billing")
    .setVersion("0.1.0")
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup("/docs", app, document);

  const port = process.env.PORT || 3001;
  const host = process.env.HOST || "0.0.0.0";
  await app.listen(port, host);
  // eslint-disable-next-line no-console
  console.log(`API running on http://${host}:${port}`);
}

bootstrap();
