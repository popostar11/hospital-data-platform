/**
 * 环境诊断（由「诊断.bat」调用，也可直接 `node tools/diagnose.mjs`）
 *
 * 一次性打印：运行环境、文件完整性、端口占用、最近日志。
 * 双击启动出现异常时，把本脚本输出发给运维即可定位。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { findListeners, readEnvFile } from './lib/port.mjs'
import { pauseIfInteractive } from './lib/tty.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = Number(process.env.PORT ?? readEnvFile(ROOT, 'PORT') ?? 3000)
const SEP = '-'.repeat(58)
const say = (m = '') => console.log(m)

const mark = (ok) => (ok ? '[√]' : '[×]')

say()
say(SEP)
say('  医院数据管理平台  ·  环境诊断')
say(SEP)

/* ---------------------------------------------------------------- 环境 */
say()
say('【运行环境】')
say(`  Node.js      ${process.version}  ${process.execPath}`)
say(`  平台         ${process.platform} ${process.arch}`)
say(`  项目路径     ${ROOT}`)
const asciiPath = !/[^\x20-\x7E]/.test(ROOT)
say(`  ${mark(asciiPath)} 路径为纯英文（中文路径会导致开机自启失效）`)

const major = Number(process.version.replace(/^v/, '').split('.')[0])
say(`  ${mark(major >= 20)} Node 版本 ≥ 20`)

const hasPnpm = spawnSync('pnpm -v', { shell: true, stdio: 'ignore' }).status === 0
const hasCorepack = spawnSync('corepack -v', { shell: true, stdio: 'ignore' }).status === 0
const hasNpx = spawnSync('npx -v', { shell: true, stdio: 'ignore' }).status === 0
say(`  pnpm 在 PATH：${hasPnpm ? '是' : '否'} ｜ corepack：${hasCorepack ? '可用' : '不可用'} ｜ npx：${hasNpx ? '可用' : '不可用'}`)
say(`  ${mark(hasPnpm || hasCorepack || hasNpx)} 至少有一种包管理器可用`)

/* ------------------------------------------------------------ 文件检查 */
say()
say('【文件完整性】')
const files = [
  ['node_modules', join(ROOT, 'node_modules')],
  ['后端产物 apps/server/dist/main.js', join(ROOT, 'apps', 'server', 'dist', 'main.js')],
  ['播种脚本 apps/server/dist/db/seed.js', join(ROOT, 'apps', 'server', 'dist', 'db', 'seed.js')],
  ['管理后台 apps/admin-web/dist/index.html', join(ROOT, 'apps', 'admin-web', 'dist', 'index.html')],
  ['大屏 apps/screen-web/dist/index.html', join(ROOT, 'apps', 'screen-web', 'dist', 'index.html')],
  ['数据库 data/hospital.db', join(ROOT, 'data', 'hospital.db')],
  ['配置文件 .env（可选）', join(ROOT, '.env')],
]
for (const [label, file] of files) {
  const exists = existsSync(file)
  const size = exists ? statSync(file).size : 0
  const sizeText = exists && size > 1024 ? `  ${(size / 1024 / 1024).toFixed(1)} MB` : ''
  say(`  ${mark(exists)} ${label}${sizeText}`)
}

/* ------------------------------------------------------------ 端口检查 */
say()
say('【端口状态】')
const listeners = findListeners(PORT)
if (listeners.length) {
  say(`  [√] 端口 ${PORT} 正在被 PID ${listeners.join(', ')} 监听 —— 服务已在运行`)
  say(`      管理后台 http://127.0.0.1:${PORT}/admin/`)
  say(`      大屏终端 http://127.0.0.1:${PORT}/screen/`)
} else {
  say(`  [×] 端口 ${PORT} 空闲 —— 服务未启动`)
}

/* ---------------------------------------------------------------- 日志 */
say()
say('【最近日志】（logs/launch.log 末尾 30 行）')
const logFile = join(ROOT, 'logs', 'launch.log')
if (existsSync(logFile)) {
  const lines = readFileSync(logFile, 'utf8').split(/\r?\n/).filter(Boolean)
  for (const line of lines.slice(-30)) say(`  ${line}`)
} else {
  say('  （暂无日志，说明启动器尚未成功运行过）')
}

say()
say(SEP)
say('  把以上内容截图发给运维即可定位问题。')
say(SEP)
say()
pauseIfInteractive()
