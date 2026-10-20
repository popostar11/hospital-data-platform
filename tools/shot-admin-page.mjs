/**
 * 后台任意页面截图（用于目视核对，不参与验收断言）
 *
 * 用法：
 *   node tools/shot-admin-page.mjs [#/patients] [输出png] [宽] [高]
 * 默认：
 *   hash = #/patients
 *   输出 = docs/refs/admin-patients.png
 *   尺寸 = 1600 x 900
 *
 * 做法：先调接口拿到 token，写进 localStorage 再带 hash 重新加载，
 * 从而跳过登录表单直接落到目标页面。截图走 Chrome DevTools 协议。
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
]
const hash = process.argv[2] ?? '#/patients'
const outPath = resolve(ROOT, process.argv[3] ?? 'docs/refs/admin-patients.png')
const width = Number(process.argv[4] ?? 1600)
const height = Number(process.argv[5] ?? 900)
const BASE = process.env.ADMIN_BASE ?? 'http://127.0.0.1:3000'
/** 取 token 用的接口根；部署在子路径下时与页面 base 不同（如 Pages 的 /<repo>/admin/） */
const API_BASE = process.env.ADMIN_API_BASE ?? BASE
const PORT = 9336
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const chromeBin = CHROME_CANDIDATES.find((p) => existsSync(p))
if (!chromeBin) {
  console.error('未找到 Chrome / Edge')
  process.exit(1)
}

/* ---------------------------------------------------- 1. 拿 token */
const loginRes = await fetch(`${API_BASE}/api/v1/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: process.env.ADMIN_USER ?? 'admin', password: process.env.ADMIN_PASS ?? 'Hospital@123' }),
})
const login = await loginRes.json()
if (login.code !== 0) {
  console.error('登录失败：', login.message)
  process.exit(1)
}
const token = login.data.accessToken

/* ---------------------------------------------------- 2. 启动浏览器 */
const profile = mkdtempSync(join(tmpdir(), 'hud-shot-'))
const chrome = spawn(
  chromeBin,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    `--window-size=${width},${height}`,
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${PORT}`,
    `${BASE}/admin/`,
  ],
  { stdio: 'ignore' },
)

let ws
let msgId = 0
const pending = new Map()
function cdp(method, params = {}) {
  return new Promise((res, rej) => {
    const id = ++msgId
    pending.set(id, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)))
    ws.send(JSON.stringify({ id, method, params }))
  })
}
async function evaluate(expression) {
  const r = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text ?? '页面脚本异常')
  return r.result.value
}
async function waitFor(expression, timeoutMs = 20000, interval = 300) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      if (await evaluate(expression)) return true
    } catch {
      /* 页面切换中 */
    }
    await sleep(interval)
  }
  return false
}

try {
  let target
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      if (target) break
    } catch {
      /* retry */
    }
    await sleep(250)
  }
  if (!target) throw new Error('未能连接 DevTools')

  ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true })
    ws.addEventListener('error', rej, { once: true })
  })
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      const cb = pending.get(msg.id)
      pending.delete(msg.id)
      cb(msg)
    }
  })

  await cdp('Page.enable')
  await cdp('Runtime.enable')
  await cdp('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  })

  // 等应用启动
  await waitFor(`document.readyState === 'complete'`, 15000)

  // 先写登录态（同源，localStorage 在导航后依然有效）
  await evaluate(`
    localStorage.setItem('hospital_access_token', ${JSON.stringify(token)});
    localStorage.setItem('hospital_refresh_token', ${JSON.stringify(login.data.refreshToken ?? '')});
    true
  `)

  // 必须强制一次**真实文档加载**：只改 hash 的导航不会重新加载，SPA 会复用
  // 启动时（尚无 token）初始化的 store，于是路由守卫又把我们踢回登录页。
  // 加一个查询参数即可让 URL 变化到「同路径不同文档」，从而真正重新加载。
  const navUrl = `${BASE}/admin/?shot=${Date.now()}${hash}`
  await cdp('Page.navigate', { url: navUrl })
  await waitFor(`document.readyState === 'complete'`, 20000)

  // 等待目标页面真正渲染出表格行（不要用「包含某文字」这种会被登录页命中的条件）
  const ready = await waitFor(`document.querySelectorAll('.el-table__body tbody tr').length > 0`, 25000)
  await sleep(1200)

  // 诊断：定位「还停在登录页」这类问题，避免盲猜
  const diag = await evaluate(
    `JSON.stringify({ href: location.href, hash: location.hash, token: (localStorage.getItem('hospital_access_token')||'').length, rows: document.querySelectorAll('.el-table__body tbody tr').length, text: document.body.innerText.replace(/\\s+/g,' ').slice(0,60) })`,
  )
  console.log('  诊断:', diag)

  const shot = await cdp('Page.captureScreenshot', { format: 'png' })
  writeFileSync(outPath, Buffer.from(shot.data, 'base64'))
  const rows = await evaluate(`document.querySelectorAll('.el-table__body tbody tr').length`)
  console.log(`截图完成：${outPath}（${width}x${height}，表格行 ${rows}）`)
} finally {
  try {
    ws?.close()
  } catch {
    /* ignore */
  }
  spawnSync('taskkill', ['/pid', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' })
  try {
    rmSync(profile, { recursive: true, force: true })
  } catch {
    /* 文件被占用时忽略 */
  }
}
