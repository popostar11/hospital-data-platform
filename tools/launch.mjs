/**
 * 一键启动器（由「启动.bat」调用，也可直接 `node tools/launch.mjs`）
 *
 * 顺序（顺序很重要，见下方注释）：
 *   1. 解析可用的包管理器（PATH 上的 pnpm → Node 自带 corepack → npx 临时拉起）
 *   2. 保证子进程里也能调用到 `pnpm`（corepack 不会把它放进 PATH，需自建 shim）
 *   3. 没有 node_modules 就装依赖
 *   4. 缺构建产物就构建（必须先于播种）
 *   5. 没有数据库就导演示数据
 *   6. 启动服务，并把全部输出同时写入 logs/launch.log
 *
 * 环境变量：
 *   PORT=3000        服务端口（也可写在项目根 .env 里）
 *   NO_BROWSER=1     不自动打开浏览器（无人值守启动用）
 *   NO_PAUSE=1       由 bat 读取，这里不使用
 */
import { spawn, spawnSync } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { delimiter, dirname, join } from 'node:path'
import { findListeners, readEnvFile } from './lib/port.mjs'
import { pauseIfInteractive } from './lib/tty.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = Number(process.env.PORT ?? readEnvFile(ROOT, 'PORT') ?? 3000)
const BASE = `http://127.0.0.1:${PORT}`
const SEP = '='.repeat(58)

/* ------------------------------------------------------------------ 日志 */
// 双保险：窗口被关掉也能回溯发生了什么（双击场景用户看不到历史输出）
const LOG_DIR = join(ROOT, 'logs')
mkdirSync(LOG_DIR, { recursive: true })
const LOG_FILE = join(LOG_DIR, 'launch.log')
const logStream = createWriteStream(LOG_FILE, { flags: 'a' })

const say = (msg = '') => {
  console.log(msg)
  logStream.write(`${msg}\n`)
}

const stamp = () => new Date().toLocaleString('zh-CN', { hour12: false })

/* ------------------------------------------------------------------ 工具 */
function openBrowser() {
  if (process.env.NO_BROWSER) return
  try {
    spawn('cmd', ['/c', 'start', '""', BASE], { detached: true, stdio: 'ignore' }).unref()
    say(`  已在浏览器中打开 ${BASE}`)
  } catch {
    say(`  请手动打开浏览器访问 ${BASE}`)
  }
}

/** 统一用「命令字符串 + shell」执行，避免 Node 的 DEP0190 告警 */
function run(task, label) {
  say(`      ${label} …`)
  const r = spawnSync(`${pnpmCmd()} ${task}`, { cwd: ROOT, shell: true, stdio: 'inherit' })
  if (r.status !== 0) {
    say('')
    say(`[错误] 执行失败：${task}（退出码 ${r.status}）`)
    say(`       完整日志：${LOG_FILE}`)
    finish(1)
  }
}

/* ------------------------------------------------------------- 包管理器 */
const CANDIDATES = [
  { name: 'pnpm（已在 PATH）', cmd: 'pnpm', args: [] },
  { name: 'corepack pnpm（Node 自带）', cmd: 'corepack', args: ['pnpm'] },
  { name: 'npx pnpm@11（临时拉起）', cmd: 'npx', args: ['--yes', 'pnpm@11.26.0'] },
]
let pnpm = null

const pnpmCmd = () => `${pnpm.cmd} ${pnpm.args.join(' ')}`.trim()

function resolvePnpm() {
  for (const c of CANDIDATES) {
    const r = spawnSync(`${c.cmd} ${[...c.args, '-v'].join(' ')}`, { cwd: ROOT, shell: true, stdio: 'ignore' })
    if (r.status === 0) return c
  }
  return null
}

/**
 * 根 package.json 里的脚本会嵌套调用 `pnpm --filter ...`。
 * 通过 corepack / npx 拉起时，`pnpm` 并不在 PATH 上，嵌套调用会失败，
 * 因此在 data/.bin 下生成一个同名 shim 并前置到 PATH。
 */
function ensurePnpmShim() {
  if (pnpm.cmd === 'pnpm') return
  const binDir = join(ROOT, 'data', '.bin')
  mkdirSync(binDir, { recursive: true })
  const target = pnpmCmd()
  writeFileSync(join(binDir, 'pnpm.cmd'), `@echo off\r\n${target} %*\r\n`, 'utf8')
  writeFileSync(join(binDir, 'pnpm'), `#!/bin/sh\nexec ${target} "$@"\n`, 'utf8')
  process.env.PATH = `${binDir}${delimiter}${process.env.PATH ?? ''}`
  say(`      已生成 pnpm 转发脚本：${binDir}`)
}

function finish(code) {
  // 双击运行时等一次回车，避免窗口一闪而过（脚本调用时自动跳过）
  pauseIfInteractive(code === 0 ? '按回车键关闭本窗口...' : '出错了，按回车键关闭本窗口...')
  logStream.end()
  process.exit(code)
}

/* ================================================================== 主流程 */
say('')
say(`启动时间：${stamp()}`)
say(SEP)
say('  医院数据管理平台  ·  急救绿道')
say('  急救绿道数据平台（演示数据）')
say(SEP)
say('')

try {
  pnpm = resolvePnpm()
  if (!pnpm) {
    say('[错误] 未找到可用的包管理器（pnpm / corepack / npx）。')
    say('       可先执行：corepack enable pnpm')
    finish(1)
  }
  say(`[1/5] 包管理器：${pnpm.name}`)
  ensurePnpmShim()

  /* ------------------------------------------------------------- 依赖 */
  if (!existsSync(join(ROOT, 'node_modules'))) {
    say('[2/5] 首次运行，安装依赖（约 1 分钟，需要联网）')
    run('install', '正在安装依赖')
  } else {
    say('[2/5] 依赖已就绪')
  }

  /* ------------------------------------------------------------- 构建 */
  // 必须先构建再播种：db:seed 跑的是编译产物 dist/db/seed.js
  const needBuild =
    !existsSync(join(ROOT, 'apps', 'server', 'dist', 'db', 'seed.js')) ||
    !existsSync(join(ROOT, 'apps', 'server', 'dist', 'main.js')) ||
    !existsSync(join(ROOT, 'apps', 'admin-web', 'dist', 'index.html')) ||
    !existsSync(join(ROOT, 'apps', 'screen-web', 'dist', 'index.html'))

  if (needBuild) {
    say('[3/5] 构建后端与前端（约 30 秒）')
    run('build', '正在构建')
  } else {
    say('[3/5] 构建产物已就绪')
  }

  /* ------------------------------------------------------------- 数据 */
  if (!existsSync(join(ROOT, 'data', 'hospital.db'))) {
    say('[4/5] 初始化演示数据')
    run('db:seed', '正在导入种子数据')
  } else {
    say('[4/5] 演示数据已就绪')
  }

  /**
   * 演示数据保鲜。
   * 种子数据锚定「生成当天」：隔几天再启动，大屏「24 小时内」表格会是空的（实测过）。
   * 这里启动时做一次检查，过期就按当前日期重新生成。
   * 代价是会覆盖手动新增的演示数据，需要保留时在 .env 里设 DEMO_AUTO_REFRESH=false。
   */
  if (String(process.env.DEMO_AUTO_REFRESH ?? 'true') !== 'false') {
    // 注意：process.execPath 通常是 "C:\Program Files\nodejs\node.exe"（含空格），
    // 走 shell 拼命令时必须加引号，否则 cmd 会在空格处断开
    const refresh = spawnSync(`"${process.execPath}" tools/refresh-demo.mjs`, { cwd: ROOT, shell: true, stdio: 'inherit' })
    if (refresh.status !== 0) {
      say('      ⚠ 演示数据保鲜检查未通过（不影响本次启动）')
    }
  }

  /* ------------------------------------------------------------- 启动 */
  // 端口被占用：服务大概率已在运行，不要再起一个（避免 EADDRINUSE 堆栈吓人）
  const busy = findListeners(PORT)
  if (busy.length) {
    say(`[5/5] 端口 ${PORT} 已被进程 ${busy.join(', ')} 占用，服务应该已经在运行。`)
    say('')
    say(`  管理后台   ${BASE}/admin/`)
    say(`  大屏终端   ${BASE}/screen/`)
    say(`  导航页     ${BASE}/`)
    say('')
    say('  如需重启：先双击「停止.bat」，再双击「启动.bat」。')
    say('')
    openBrowser()
    finish(0)
  }

  say('[5/5] 启动服务')
  say('')
  say(`  管理后台   ${BASE}/admin/`)
  say(`  大屏终端   ${BASE}/screen/`)
  say(`  导航页     ${BASE}/`)
  say('')
  say('  演示账号：admin / Hospital@123')
  say('  按 Ctrl+C 停止服务；或双击「停止.bat」')
  say('')

  const server = spawn(pnpmCmd() + ' start', { cwd: ROOT, shell: true, stdio: ['inherit', 'pipe', 'pipe'] })
  // 服务输出同时进控制台与日志文件
  server.stdout?.on('data', (d) => {
    process.stdout.write(d)
    logStream.write(d)
  })
  server.stderr?.on('data', (d) => {
    process.stderr.write(d)
    logStream.write(d)
  })

  if (!process.env.NO_BROWSER) {
    setTimeout(openBrowser, 6000)
  }

  const stop = () => {
    try {
      server.kill()
    } catch {
      /* ignore */
    }
    say('')
    say('服务已停止。')
    finish(0)
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)

  server.on('exit', (code) => {
    say('')
    if (code) {
      say(`[错误] 服务异常退出（退出码 ${code}），完整日志：${LOG_FILE}`)
    } else {
      say('服务已停止。')
    }
    finish(code ?? 0)
  })
} catch (err) {
  say('')
  say(`[错误] 启动器异常：${err instanceof Error ? err.message : String(err)}`)
  if (err instanceof Error && err.stack) logStream.write(`${err.stack}\n`)
  say(`       完整日志：${LOG_FILE}`)
  finish(1)
}
