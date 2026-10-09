/**
 * Cloudflare 一键部署脚本
 *
 * 前置：在环境变量里提供（不要贴在聊天里，避免泄露）
 *   CLOUDFLARE_API_TOKEN    控制台 → My Profile → API Tokens → Create Token
 *                           模板选「Edit Cloudflare Workers」，并额外勾选 D1 的编辑权限
 *   CLOUDFLARE_ACCOUNT_ID   控制台右侧栏的 Account ID
 *
 * 用法：
 *   node tools/deploy-cloudflare.mjs              # 全流程
 *   node tools/deploy-cloudflare.mjs --skip-build # 已构建过，跳过构建
 *
 * 做的事：
 *   1. 校验 token / 账号
 *   2. 找到或创建 D1 数据库，并把 database_id 写回 wrangler.toml
 *   3. 首次部署时生成并写入 JWT_SECRET（已存在则不覆盖，避免每次部署都让登录态失效）
 *   4. 构建 → 生成种子 SQL → 远端 D1 为空时才导入 → 汇总前端产物 → 部署
 *   5. 输出公网地址并对它跑一遍云端验收
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const WORKER_DIR = join(ROOT, 'apps', 'worker')
const DB_NAME = 'hospital_platform'
const SEP = '='.repeat(60)
const say = (m = '') => console.log(m)

const skipBuild = process.argv.includes('--skip-build')

const env = {
  ...process.env,
  CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN ?? process.env.CF_API_TOKEN,
  CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID ?? process.env.CF_ACCOUNT_ID,
}

/* ------------------------------------------------------------ 前置校验 */
say()
say(SEP)
say('  Cloudflare 一键部署')
say(SEP)
say()

if (!env.CLOUDFLARE_API_TOKEN || !env.CLOUDFLARE_ACCOUNT_ID) {
  say('[缺少凭据] 请先在环境变量里配置下面两项，再重新运行：')
  say()
  say('  CLOUDFLARE_API_TOKEN    控制台 → My Profile → API Tokens → Create Token')
  say('                          （模板选 Edit Cloudflare Workers，并额外勾选 D1 编辑权限）')
  say('  CLOUDFLARE_ACCOUNT_ID   控制台右侧栏 Account ID')
  say()
  say('  Windows 下设置一次即可（新开的终端也会生效）：')
  say('    setx CLOUDFLARE_API_TOKEN "你的token"')
  say('    setx CLOUDFLARE_ACCOUNT_ID "你的account id"')
  say()
  process.exit(1)
}
say('[1/7] 凭据已读取（长度校验通过，不打印明文）')

/* ------------------------------------------------------------- 工具函数 */
/** 解析可用的 pnpm（与 tools/launch.mjs 同样的回退策略：PATH → corepack → npx） */
function resolvePnpm() {
  for (const c of [
    { name: 'pnpm', cmd: 'pnpm' },
    { name: 'corepack pnpm', cmd: 'corepack pnpm' },
    { name: 'npx pnpm@11', cmd: 'npx --yes pnpm@11.26.0' },
  ]) {
    if (spawnSync(`${c.cmd} -v`, { cwd: ROOT, shell: true, stdio: 'ignore' }).status === 0) return c
  }
  return null
}

function run(command, { cwd = ROOT, capture = false } = {}) {
  const r = spawnSync(command, {
    cwd,
    shell: true,
    env,
    encoding: 'utf8',
    stdio: capture ? 'pipe' : 'inherit',
  })
  if (r.status !== 0 && !capture) {
    say(`\n[错误] 执行失败：${command}`)
    process.exit(r.status ?? 1)
  }
  return { status: r.status ?? 0, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

function wrangler(args, opts) {
  return run(`npx wrangler ${args}`, { cwd: WORKER_DIR, ...opts })
}

/* --------------------------------------------------------- 校验账号权限 */
say('[2/7] 校验 Cloudflare 账号与 token')
const whoami = wrangler('whoami', { capture: true })
if (whoami.status !== 0 || !/Account|account/i.test(whoami.stdout + whoami.stderr)) {
  say('      ⚠ 未能确认账号信息，输出如下：')
  say(whoami.stdout || whoami.stderr)
  say('      继续尝试，若后续失败请检查 token 权限')
} else {
  const line = (whoami.stdout + whoami.stderr).split(/\r?\n/).filter(Boolean).slice(-3).join(' | ')
  say(`      ${line}`)
}

/* ------------------------------------------------------------ D1 数据库 */
say(`[3/7] 确认 D1 数据库 ${DB_NAME}`)
let databaseId = null

const list = wrangler('d1 list --json', { capture: true })
if (list.status === 0) {
  try {
    const items = JSON.parse(list.stdout.slice(list.stdout.indexOf('[')))
    const hit = items.find((d) => d.name === DB_NAME)
    if (hit) databaseId = hit.uuid ?? hit.database_id ?? hit.id
  } catch {
    /* 解析失败则走创建分支 */
  }
}

if (!databaseId) {
  say('      未找到，正在创建…')
  const created = wrangler(`d1 create ${DB_NAME}`, { capture: true })
  const text = created.stdout + created.stderr
  const m = text.match(/database_id\s*=\s*"([0-9a-f-]{36})"/i) ?? text.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i)
  if (m) databaseId = m[1]
  if (!databaseId) {
    say('      ✗ 创建失败或无法解析 id：')
    say(text)
    process.exit(1)
  }
}
say(`      database_id = ${databaseId}`)

const tomlPath = join(WORKER_DIR, 'wrangler.toml')
let toml = readFileSync(tomlPath, 'utf8')
const patched = toml.replace(/database_id\s*=\s*"[^"]*"/, `database_id = "${databaseId}"`)
if (patched !== toml) {
  writeFileSync(tomlPath, patched, 'utf8')
  say('      已把 database_id 写回 apps/worker/wrangler.toml')
}

/* --------------------------------------------------------------- 密钥 */
say('[4/7] 确认 JWT_SECRET')
const secretList = wrangler('secret list', { capture: true })
const hasJwt = /JWT_SECRET/.test(secretList.stdout + secretList.stderr)
if (hasJwt) {
  say('      已存在，保持不变（避免让已有登录态失效）')
} else {
  const secret = randomBytes(48).toString('base64url')
  const tmp = join(WORKER_DIR, '.secrets.tmp.json')
  writeFileSync(tmp, JSON.stringify({ JWT_SECRET: secret }), 'utf8')
  const r = wrangler(`secret bulk "${tmp}"`, { capture: true })
  rmSync(tmp, { force: true })
  if (r.status !== 0) {
    say('      ✗ 写入失败：')
    say(r.stdout + r.stderr)
    process.exit(1)
  }
  say('      已生成随机 JWT_SECRET 并写入（48 字节 base64url）')
}

/* --------------------------------------------------------------- 构建 */
const pnpm = resolvePnpm()
if (!pnpm) {
  say('[错误] 找不到可用的 pnpm（PATH / corepack / npx 均不可用）')
  process.exit(1)
}

if (!skipBuild) {
  say(`[5/7] 构建（${pnpm.name}）`)
  const r = spawnSync(`${pnpm.cmd} build`, { cwd: ROOT, shell: true, env, stdio: 'inherit' })
  if (r.status !== 0) {
    say('[错误] 构建失败')
    process.exit(r.status ?? 1)
  }
} else {
  say('[5/7] 跳过构建（--skip-build）')
}

/* ---------------------------------------------------------- 种子数据 */
say('[6/7] 准备演示数据')
const countRes = wrangler(`d1 execute ${DB_NAME} --remote --json --command="select count(*) as c from green_channel_case"`, { capture: true })
let remoteCount = null
try {
  const json = JSON.parse(countRes.stdout.slice(countRes.stdout.indexOf('[')))
  remoteCount = json?.[0]?.results?.[0]?.c ?? null
} catch {
  remoteCount = null
}

if (remoteCount !== null && Number(remoteCount) > 0) {
  say(`      远端已有 ${remoteCount} 条病例，跳过导入（避免覆盖线上数据）`)
} else {
  say('      远端为空，正在生成并导入种子数据…')
  const exp = spawnSync(`${process.execPath} tools/export-d1-seed.mjs`, { cwd: ROOT, shell: true, stdio: 'inherit' })
  if (exp.status !== 0) {
    say('[错误] 种子导出失败（需先成功构建 apps/server）')
    process.exit(exp.status ?? 1)
  }
  const seed = wrangler(`d1 execute ${DB_NAME} --remote --file=./seed.sql`, { capture: true })
  if (seed.status !== 0) {
    say('      ✗ 导入失败：')
    say((seed.stdout + seed.stderr).split(/\r?\n/).slice(-20).join('\n'))
    process.exit(1)
  }
  say('      导入完成')
}

/* ------------------------------------------------------------ 部署 */
say('[7/7] 汇总前端产物并部署')
const assets = spawnSync(`${process.execPath} apps/worker/scripts/build-assets.mjs`, { cwd: ROOT, shell: true, stdio: 'inherit' })
if (assets.status !== 0) {
  say('[错误] 前端产物汇总失败')
  process.exit(assets.status ?? 1)
}

const deploy = wrangler('deploy', { capture: true })
const out = deploy.stdout + deploy.stderr
if (deploy.status !== 0) {
  say('      ✗ 部署失败：')
  say(out.split(/\r?\n/).slice(-25).join('\n'))
  process.exit(1)
}
const urlMatch = out.match(/https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev/i)
const url = urlMatch?.[0]

say()
say(SEP)
say('  部署完成')
say(SEP)
if (url) {
  say(`  公网地址：${url}`)
  say(`  大屏：${url}/screen/`)
  say(`  后台：${url}/admin/    （admin / Hospital@123）`)
  say()
  say('  正在对其运行云端验收…')
  say()
  const verify = spawnSync(`${process.execPath} tools/verify-worker.mjs ${url}`, { cwd: ROOT, shell: true, stdio: 'inherit' })
  if (verify.status !== 0) {
    say()
    say('  ⚠ 验收存在失败项，请查看上面的输出')
  }
} else {
  say('  未能从输出里解析出地址，请查看 wrangler 的原始输出：')
  say(out.split(/\r?\n/).slice(-15).join('\n'))
}
say()
