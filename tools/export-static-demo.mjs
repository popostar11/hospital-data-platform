/**
 * 导出「静态演示快照」——供 GitHub Pages 等无后端环境使用
 *
 * 用法：先启动本地服务（双击 启动.bat 或 pnpm start），然后
 *   node tools/export-static-demo.mjs [baseUrl]
 * 产物：apps/screen-web/public/demo-screen.json
 *
 * 前端在拿不到后端时会自动降级读取这份快照（见 apps/screen-web/src/api/screen.ts），
 * 因此同一份构建产物：本地部署走真实接口，Pages 上走快照，无需两套代码。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BASE = (process.argv[2] ?? 'http://127.0.0.1:3000').replace(/\/$/, '')
const OUT = join(ROOT, 'apps', 'screen-web', 'public', 'demo-screen.json')

console.log(`\n【导出静态演示快照】数据源 ${BASE}`)

let body
try {
  const res = await fetch(`${BASE}/api/v1/screen/bootstrap?screenCode=main&force=1`, {
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  body = await res.json()
} catch (err) {
  console.error(`  无法从 ${BASE} 取到大屏数据：${err instanceof Error ? err.message : err}`)
  console.error('  请先启动本地服务（双击 启动.bat，或 pnpm start）后重试。')
  process.exit(1)
}

if (body?.code !== 0 || !body?.data) {
  console.error('  接口返回异常：', JSON.stringify(body).slice(0, 200))
  process.exit(1)
}

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify(body, null, 2), 'utf8')

const d = body.data
console.log(`  医院名称：${d.header?.hospitalName}`)
console.log(`  累计病例：${d.pie?.total} ｜ 24 小时表格 ${d.table?.rows?.length ?? 0} 行 ｜ 未闭环 ${d.footer?.total}`)
console.log(`  已写入：${OUT}（${Math.round(JSON.stringify(body).length / 1024)} KB）`)
console.log('\n接下来构建并发布到 GitHub Pages：')
console.log('  PAGES_BASE=/hospital-data-platform/ pnpm --filter @hospital/screen-web build')
console.log('  node tools/publish-pages.mjs\n')
