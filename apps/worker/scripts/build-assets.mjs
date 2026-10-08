/**
 * 汇总两个前端构建产物到 apps/worker/public，供 Workers 静态资源托管。
 *
 * 用法：pnpm --filter @hospital/worker assets
 * 产出：
 *   apps/worker/public/admin/   ← apps/admin-web/dist
 *   apps/worker/public/screen/  ← apps/screen-web/dist
 *
 * 为什么要汇总：两个前端的 vite `base` 分别是 /admin/ 与 /screen/，
 * 直接放到同一个 assets 目录下即可按子路径访问，无需两个独立部署。
 */
import { cpSync, existsSync, mkdirSync, rmSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const PUBLIC_DIR = join(ROOT, 'apps', 'worker', 'public')

const APPS = [
  { name: 'admin', from: join(ROOT, 'apps', 'admin-web', 'dist'), to: join(PUBLIC_DIR, 'admin') },
  { name: 'screen', from: join(ROOT, 'apps', 'screen-web', 'dist'), to: join(PUBLIC_DIR, 'screen') },
]

console.log('\n【汇总前端产物】')

const missing = APPS.filter((a) => !existsSync(join(a.from, 'index.html')))
if (missing.length) {
  console.error(`  缺少构建产物：${missing.map((m) => m.name).join(', ')}`)
  console.error('  请先在仓库根执行：pnpm build')
  process.exit(1)
}

rmSync(PUBLIC_DIR, { recursive: true, force: true })
mkdirSync(PUBLIC_DIR, { recursive: true })

for (const app of APPS) {
  cpSync(app.from, app.to, { recursive: true })
  const files = readdirSync(app.to)
  console.log(`  ✓ ${app.name}/ ← ${app.from.replace(`${ROOT}\\`, '')}（${files.length} 项）`)
}

console.log(`\n输出目录：${PUBLIC_DIR}`)
console.log('接下来可执行：pnpm --filter @hospital/worker dev\n')
