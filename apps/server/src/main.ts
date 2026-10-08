import 'reflect-metadata'
import { Logger } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { DEFAULT_HOSPITAL_NAME } from '@hospital/shared'
import type { NestExpressApplication } from '@nestjs/platform-express'
import type { NextFunction, Request, Response } from 'express'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { AppModule } from './app.module'
import { config } from './config'

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap')
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['error', 'warn', 'log'],
  })

  app.setGlobalPrefix('api/v1')
  app.enableCors({ origin: true, credentials: true })
  app.disable('x-powered-by')

  /* ------------------------------------------------ 前端构建产物（一体化部署） */
  const adminDist = join(config.webRoot, 'admin-web', 'dist')
  const screenDist = join(config.webRoot, 'screen-web', 'dist')
  const hasAdmin = existsSync(join(adminDist, 'index.html'))
  const hasScreen = existsSync(join(screenDist, 'index.html'))

  if (hasScreen) app.useStaticAssets(screenDist, { prefix: '/screen/' })
  if (hasAdmin) app.useStaticAssets(adminDist, { prefix: '/admin/' })

  // SPA 前端路由回退：未知路径交还 index.html，由前端路由处理
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET' || req.path.startsWith('/api/')) return next()
    if (req.path === '/' || req.path === '') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.end(landingPage(hasScreen, hasAdmin))
      return
    }
    if (req.path.startsWith('/screen')) {
      if (!hasScreen) return next()
      res.sendFile(join(screenDist, 'index.html'))
      return
    }
    if (req.path.startsWith('/admin')) {
      if (!hasAdmin) return next()
      res.sendFile(join(adminDist, 'index.html'))
      return
    }
    next()
  })

  await app.listen(config.port, config.host)

  const base = `http://127.0.0.1:${config.port}`
  /* eslint-disable no-console */
  console.log('')
  console.log('  医院数据管理平台已启动')
  console.log(`  ├─ 后端接口   ${base}/api/v1`)
  console.log(`  ├─ 管理后台   ${hasAdmin ? `${base}/admin/` : '（未构建，可运行 pnpm dev:admin）'}`)
  console.log(`  ├─ 大屏终端   ${hasScreen ? `${base}/screen/` : '（未构建，可运行 pnpm dev:screen）'}`)
  console.log(`  ├─ 数据库     ${config.dbFile}`)
  console.log(`  └─ 演示模式   ${config.demoMode ? '开启（大屏可匿名访问）' : '关闭'}`)
  console.log('')
  /* eslint-enable no-console */
  logger.log(`服务已就绪：${base}`)
}

/** 根路径导航页（便于验收时直接点进两个前端） */
function landingPage(hasScreen: boolean, hasAdmin: boolean): string {
  const link = (href: string, title: string, desc: string, enabled: boolean) =>
    enabled
      ? `<a class="card" href="${href}"><h2>${title}</h2><p>${desc}</p><span class="go">进入 →</span></a>`
      : `<div class="card disabled"><h2>${title}</h2><p>${desc}</p><span class="go">尚未构建</span></div>`
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>医院数据管理平台</title>
<style>
  :root{color-scheme:dark}
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;
       background:radial-gradient(1200px 600px at 50% 0%,#0b2a52 0%,#041226 60%,#020a16 100%);
       color:#dbeaff;font-family:"Microsoft YaHei","PingFang SC",system-ui,sans-serif}
  h1{font-size:26px;letter-spacing:2px;margin:0 0 6px;color:#7fd9ff;text-shadow:0 0 18px rgba(24,224,255,.45)}
  .sub{color:#7f9dc4;margin-bottom:34px;font-size:14px;letter-spacing:1px}
  .cards{display:flex;gap:22px;flex-wrap:wrap;justify-content:center}
  .card{width:280px;padding:24px 22px;border-radius:14px;text-decoration:none;color:#dbeaff;
        background:linear-gradient(160deg,rgba(20,64,116,.85),rgba(8,26,52,.9));
        border:1px solid rgba(60,170,255,.35);box-shadow:0 10px 30px rgba(0,20,50,.5);transition:.2s}
  .card:hover{transform:translateY(-4px);border-color:rgba(24,224,255,.8);box-shadow:0 16px 40px rgba(0,120,200,.45)}
  .card h2{margin:0 0 8px;font-size:18px;color:#9fe6ff}
  .card p{margin:0 0 16px;font-size:13px;line-height:1.6;color:#8fb0d6}
  .go{font-size:13px;color:#18e0ff}
  .disabled{opacity:.45;pointer-events:none}
  footer{margin-top:38px;font-size:12px;color:#5d7ba3}
</style></head>
<body>
  <h1>医院数据管理平台</h1>
  <div class="sub">急救绿道数据平台 · ${DEFAULT_HOSPITAL_NAME}</div>
  <div class="cards">
    ${link('/screen/', '急救绿道大屏', '只读可视化终端，1920×1080 横屏常驻', hasScreen)}
    ${link('/admin/', '后台管理系统', '病例管理、字典维护、统计报表、系统设置', hasAdmin)}
  </div>
  <footer>接口文档前缀 /api/v1 ｜ 演示账号 admin / Hospital@123</footer>
</body></html>`
}

void bootstrap()
