import { NestFactory } from '@nestjs/core'
import { ValidationPipe } from '@nestjs/common'
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger'
import { NestExpressApplication } from '@nestjs/platform-express'
import { join } from 'path'
import helmet from 'helmet'
import { AppModule } from './app.module'

async function bootstrap() {
  // 环境变量校验：必需配置
  const requiredEnvVars = ['DATABASE_URL', 'JWT_SECRET']
  for (const v of requiredEnvVars) {
    if (!process.env[v]) {
      console.error(`❌ 缺少必需环境变量: ${v}`)
      console.error(`   请在 .env 文件中配置 ${v}`)
      process.exit(1)
    }
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule)

  // 全局前缀
  app.setGlobalPrefix('api')

  // 全局验证管道
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  )

  // 2026-08-15: CORS 白名单 (从全开改成显式 allowlist)
  //   - 默认白名单: hksgtools.cn (prod) + localhost (本地 4in1 dev 8080)
  //   - 可通过 CORS_ALLOWED_ORIGINS 环境变量追加 (逗号分隔)
  //   - 不在白名单的 origin 不会收到 Access-Control-Allow-Origin 头 (浏览器自动拦截)
  //   - server-to-server 请求 (curl, 无 Origin header) 始终放行
  const defaultOrigins = [
    'https://hksgtools.cn',
    'http://localhost:8080',     // 本地 4in1-dev
    'http://localhost:3000',     // 本地 insurance-ppt
    'http://localhost:5173',     // Vite 默认
  ]
  const extraOrigins = (process.env.CORS_ALLOWED_ORIGINS ?? '')
    .split(',').map((s) => s.trim()).filter(Boolean)
  const allowedOrigins = Array.from(new Set([...defaultOrigins, ...extraOrigins]))
  app.enableCors({
    origin: allowedOrigins,        // 静态白名单, NestJS 自动处理 preflight
    credentials: false,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Accept'],
    maxAge: 86400,
  })

  // 静态文件服务（上传的文件）
  app.useStaticAssets(join(__dirname, '..', 'uploads'), {
    prefix: '/uploads',
  })

  // 2026-08-15: helmet 安全头 (X-Frame-Options, X-Content-Type-Options, Strict-Transport-Security, etc.)
  //   - CSP 留默认 (NestJS API 不需要严格 CSP, 但 helmet 会设 X-Content-Type-Options: nosniff 等)
  //   - crossOriginEmbedderPolicy 关掉 (影响 PDF / 图片 inline)
  app.use(helmet({
    contentSecurityPolicy: false,  // API 不返回 HTML, CSP 不需要
    crossOriginEmbedderPolicy: false,
  }))

  // Swagger 文档
  const config = new DocumentBuilder()
    .setTitle('培训系统 API')
    .setDescription('培训模块核心 API 文档')
    .setVersion('1.0')
    .build()
  const document = SwaggerModule.createDocument(app, config)
  SwaggerModule.setup('docs', app, document)

  await app.listen(process.env.PORT ?? 3000)
  console.log(`🚀 Training API running on http://localhost:${process.env.PORT ?? 3000}`)
}
bootstrap()
