/**
 * 服务守护进程（supervisor）
 *
 * 为什么需要它：
 *   1. 前台控制台里跑服务，Ctrl+C（Windows 控制台里=复制）会直接把服务杀掉；
 *   2. 关掉那个窗口、误点关闭，服务也会没；
 *   3. 进程崩了不会自己起来。
 * 守护进程解决了这三点：它**忽略 SIGINT**、把服务日志重定向到文件、
 * 服务退出后 3 秒自动拉起，并保证同一时刻只有一个服务实例。
 *
 * 由 tools/autostart.mjs 通过「启动」文件夹里的隐藏 VBS 拉起（无窗口、无控制台）。
 * 也可手动前台运行用于观察：node tools/serve-daemon.mjs
 */
import { spawn, spawnSync } from 'node:child_process'
import { appendFileSync, mkdirSync, openSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = Number(process.env.PORT ?? 3000)
const LOG_DIR = join(ROOT, 'logs')
const LOG_FILE = join(LOG_DIR, 'server.log')
const DAEMON_LOG = join(LOG_DIR, 'daemon.log')
const PID_FILE = join(ROOT, 'data', 'daemon.pid')
const RESTART_DELAY_MS = 3000
const CHECK_INTERVAL_MS = 5000

mkdirSync(LOG_DIR, { recursive: true })
mkdirSync(join(ROOT, 'data'), { recursive: true })

const log = (msg) => {
  const line = `[${new Date().toLocaleString('zh-CN', { hour12: false })}] ${msg}`
  try {
    appendFileSync(DAEMON_LOG, `${line}\n`)
  } catch {
    /* ignore */
  }
  console.log(line)
}

/** 端口是否已被占用（被占用说明服务在跑，无需重复拉起） */
function portInUse(port) {
  return new Promise((resolve) => {
    const server = createServer()
    server.once('error', () => resolve(true))
    server.once('listening', () => server.close(() => resolve(false)))
    server.listen(port, '127.0.0.1')
  })
}

writeFileSync(PID_FILE, String(process.pid), 'utf8')
log(`守护进程已启动（PID ${process.pid}），目标端口 ${PORT}`)
log(`服务日志：${LOG_FILE}`)

/**
 * 关键：忽略 SIGINT。
 * Windows 控制台里 Ctrl+C 会向整个进程组发送 SIGINT，
 * 忽略它之后，误按「复制」不会再把服务带走。
 */
process.on('SIGINT', () => log('收到 SIGINT（可能是控制台里按了 Ctrl+C），已忽略；如需停止请用「停止.bat」'))

let child = null
let stopping = false

function startServer() {
  // 演示数据保鲜：种子数据锚定生成当天，隔天不处理的话大屏「24 小时内」表格会是空的。
  // 数据新鲜时这一步只有两条查询（约几十毫秒），可忽略。
  try {
    const refresh = spawnSync(`"${process.execPath}" tools/refresh-demo.mjs`, {
      cwd: ROOT,
      shell: true,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 60000,
    })
    const line = (refresh.stdout ?? '').trim().split(/\r?\n/).filter(Boolean).pop()
    if (line) log(`演示数据：${line}`)
  } catch (err) {
    log(`演示数据保鲜失败（不影响启动）：${err instanceof Error ? err.message : String(err)}`)
  }

  const out = openSync(LOG_FILE, 'a')
  child = spawn(process.execPath, ['dist/main.js'], {
    cwd: join(ROOT, 'apps', 'server'),
    stdio: ['ignore', out, out],
    windowsHide: true,
  })
  log(`已启动服务进程（PID ${child.pid}）`)
  child.on('exit', (code, signal) => {
    log(`服务进程退出：code=${code} signal=${signal ?? '无'}，${RESTART_DELAY_MS / 1000} 秒后自动重启`)
    child = null
  })
}

const tick = async () => {
  if (stopping) return
  try {
    if (child) return
    if (await portInUse(PORT)) return // 已有实例（可能是手动启动的），不重复起
    startServer()
  } catch (err) {
    log(`检查时出错：${err instanceof Error ? err.message : String(err)}`)
  }
}

void tick()
const timer = setInterval(() => void tick(), CHECK_INTERVAL_MS)

const shutdown = (reason) => {
  stopping = true
  clearInterval(timer)
  log(`守护进程退出（${reason}）`)
  if (child) {
    try {
      child.kill()
    } catch {
      /* ignore */
    }
  }
  process.exit(0)
}

process.on('SIGTERM', () => shutdown('收到 SIGTERM'))
process.on('SIGHUP', () => shutdown('收到 SIGHUP'))
