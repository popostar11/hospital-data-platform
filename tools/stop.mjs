/**
 * 停止本地服务（由「停止.bat」调用，也可直接 `node tools/stop.mjs`）
 *
 * 顺序很重要：**必须先停守护进程，再停服务进程**。
 * 否则守护进程会在 3 秒内把服务重新拉起来，「停止」看起来没生效。
 *
 * 做三件事：
 *   1. 结束守护进程（tools/serve-daemon.mjs）
 *   2. 结束监听服务端口的进程（含子进程）
 *   3. 兜底结束任何在跑本项目 dist/main.js 的 node 进程
 */
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { findListeners, killTree, readEnvFile } from './lib/port.mjs'
import { pauseIfInteractive } from './lib/tty.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = Number(process.env.PORT ?? readEnvFile(ROOT, 'PORT') ?? 3000)
const SEP = '='.repeat(58)
const say = (m = '') => console.log(m)

say()
say(SEP)
say('  急诊专科中心数据平台  ·  停止服务')
say(SEP)
say()

let stopped = 0

/* ------------------------------------------------ 1. 先停守护进程 */
const pidFile = join(ROOT, 'data', 'daemon.pid')
if (existsSync(pidFile)) {
  const daemonPid = Number(readFileSync(pidFile, 'utf8').trim())
  if (Number.isFinite(daemonPid) && daemonPid > 0) {
    if (killTree(daemonPid)) {
      say(`  已停止守护进程（PID ${daemonPid}）`)
      stopped++
    }
  }
  rmSync(pidFile, { force: true })
}

/* ------------------------------------ 2. 再停占用端口的服务进程 */
const listeners = findListeners(PORT)
for (const pid of listeners) {
  if (killTree(pid)) {
    say(`  已停止占用端口 ${PORT} 的进程（PID ${pid}）`)
    stopped++
  } else {
    say(`  [警告] 无法结束进程 PID ${pid}，可能需要以管理员身份运行`)
  }
}

// 兜底：端口没查到但服务进程还在（例如换了端口启动）
if (process.platform === 'win32') {
  const r = spawnSync('wmic', ['process', 'where', "name='node.exe'", 'get', 'ProcessId,CommandLine', '/format:csv'], {
    encoding: 'utf8',
    windowsHide: true,
  })
  const marker = join('apps', 'server', 'dist', 'main.js')
  for (const line of (r.stdout ?? '').split(/\r?\n/)) {
    if (!line.includes(marker)) continue
    const cols = line.split(',')
    const pid = Number(cols[cols.length - 1])
    if (Number.isFinite(pid) && pid > 0 && !listeners.includes(pid) && killTree(pid)) {
      say(`  已停止服务进程（PID ${pid}）`)
      stopped++
    }
  }
}

say()
if (stopped === 0) {
  say(`  端口 ${PORT} 上没有正在运行的服务，无需停止。`)
} else {
  say(`  已停止 ${stopped} 个进程，端口 ${PORT} 现已释放。`)
}
say()
say(`  重新启动：双击「启动.bat」`)
say()
pauseIfInteractive()
