/**
 * 一键构建并发布「静态演示」到 GitHub Pages（大屏 + 后台只读演示）
 *
 * 用法（必须用 pnpm 跑，脚本依赖 npm_execpath 定位 pnpm）：
 *   pnpm demo:publish
 *   pnpm demo:publish popostar11/hospital-data-platform
 *
 * 做的事：
 *   1. 导出后台演示快照（需本地服务在 3000 端口运行）
 *   2. 以 Pages 基准构建大屏     → <仓库>/screen/
 *   3. 以演示模式 + Pages 基准构建后台 → <仓库>/admin/
 *   4. 发布 gh-pages（overwrite 一个提交，不动 main）
 *   5. 把本地构建恢复成正常模式（/screen/ 与 /admin/），避免本地打不开
 *
 * 为什么要第 5 步：Pages 构建用的是绝对前缀（/<仓库名>/screen/），
 * 直接留在 dist 里会让本地 http://127.0.0.1:3000/screen/ 的资源 404。
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const REPO = process.argv[2] ?? 'popostar11/hospital-data-platform'
const REPO_NAME = REPO.split('/')[1]
const PAGES_ROOT = `/${REPO_NAME}/`

const PNPM = process.env.npm_execpath
if (!PNPM) {
  console.error('[错误] 请用 pnpm 运行：pnpm demo:publish')
  console.error('       （脚本需要 npm_execpath 才能找到 pnpm，直接 node 运行拿不到）')
  process.exit(1)
}

function step(title) {
  console.log(`\n\x1b[36m── ${title}\x1b[0m`)
}

function run(args, env = {}) {
  const res = spawnSync(process.execPath, [PNPM, ...args], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  })
  if (res.status !== 0) {
    console.error(`\n[失败] ${args.join(' ')} 退出码 ${res.status}`)
    process.exit(res.status ?? 1)
  }
}

function runNode(script, extra = []) {
  const res = spawnSync(process.execPath, [join(ROOT, 'tools', script), ...extra], {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env,
  })
  if (res.status !== 0) {
    console.error(`\n[失败] ${script} 退出码 ${res.status}`)
    process.exit(res.status ?? 1)
  }
}

step('1/5 导出后台演示快照')
runNode('export-admin-demo.mjs')

step(`2/5 构建大屏（基准 ${PAGES_ROOT}screen/）`)
run(['--filter', '@hospital/screen-web', 'build'], { PAGES_BASE: `${PAGES_ROOT}screen/` })

step(`3/5 构建后台演示（基准 ${PAGES_ROOT}admin/）`)
run(['--filter', '@hospital/admin-web', 'build'], {
  VITE_DEMO: '1',
  PAGES_BASE: `${PAGES_ROOT}admin/`,
})

step('4/5 发布到 gh-pages')
runNode('publish-pages.mjs', [REPO])

step('5/5 恢复本地构建（正常模式）')
run(['--filter', '@hospital/screen-web', 'build'], { PAGES_BASE: '' })
run(['--filter', '@hospital/admin-web', 'build'], { VITE_DEMO: '', PAGES_BASE: '' })

console.log(`
\x1b[32m完成。\x1b[0m
  公网首页：https://${REPO.split('/')[0]}.github.io/${REPO_NAME}/
  公网大屏：https://${REPO.split('/')[0]}.github.io/${REPO_NAME}/screen/
  公网后台：https://${REPO.split('/')[0]}.github.io/${REPO_NAME}/admin/   （只读快照）
  本地后台：http://127.0.0.1:3000/admin/                              （可写）
  Pages 首次生效约需 1~2 分钟。
`)
