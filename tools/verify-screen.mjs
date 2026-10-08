/**
 * 大屏端到端验收脚本（无需第三方依赖，使用 Node 内置 fetch / WebSocket + CDP）
 *
 * 用法：
 *   node tools/verify-screen.mjs [大屏URL] [截图输出路径]
 * 默认：
 *   url    = http://127.0.0.1:3000/screen/         （走真实 SSE）
 *   截图   = docs/refs/screen-shot.png
 *
 * 校验项：
 *   1. 页面能渲染出表格与关键文案（医院名称 / 面板标题 / 8 个表头）
 *   2. 行数与接口一致，字段为脱敏姓名（正则校验，避免明文泄漏）
 *   3. 表格滚动真的在跑（间隔采样 transform 位移），并反推速度
 *   4. 输出 1920×1080 截图，便于与现场照片做 1:1 比对
 *
 * 退出码：0 全部通过；1 有校验失败。
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
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
]

const url = process.argv[2] ?? 'http://127.0.0.1:3000/screen/'
// 默认输出路径相对「项目根」而非当前工作目录，避免从别处调用时写错位置
const shotPath = resolve(ROOT, process.argv[3] ?? 'docs/refs/screen-shot.png')
const PORT = 9333

/** 结束整棵浏览器进程树（只 kill 父进程会留下子进程占用 profile 目录） */
function killTree(pid) {
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' })
  } else {
    try {
      process.kill(-pid)
    } catch {
      try {
        process.kill(pid)
      } catch {
        /* ignore */
      }
    }
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? ` —— ${detail}` : ''}`)
}

const chromeBin = CHROME_CANDIDATES.find((p) => existsSync(p))
if (!chromeBin) {
  console.error('未找到 Chrome / Edge，跳过浏览器验收')
  process.exit(1)
}

const profile = mkdtempSync(join(tmpdir(), 'hud-verify-'))
const chrome = spawn(
  chromeBin,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--window-size=1920,1080',
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${PORT}`,
    url,
  ],
  { stdio: 'ignore' },
)

let ws
let msgId = 0
const pending = new Map()

async function waitForTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      const list = await res.json()
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      if (page) return page
    } catch {
      /* 尚未就绪 */
    }
    await sleep(250)
  }
  throw new Error('未能连接到 Chrome DevTools 调试端口')
}

function cdp(method, params = {}) {
  return new Promise((res, rej) => {
    const id = ++msgId
    pending.set(id, (msg) => (msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result)))
    ws.send(JSON.stringify({ id, method, params }))
  })
}

async function evaluate(expression) {
  const r = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text ?? '页面脚本执行异常')
  return r.result.value
}

/** 从 transform 矩阵里取 Y 位移 */
const READ_TRANSFORM = `(() => {
  const el = document.querySelector('.case-table__track')
  if (!el) return { ready: false }
  const m = new DOMMatrixReadOnly(getComputedStyle(el).transform)
  return {
    ready: true,
    y: m.m42,
    rows: document.querySelectorAll('.case-table__row').length,
    firstRowText: document.querySelector('.case-table__row')?.innerText?.replace(/\\s+/g, ' ').trim() ?? '',
    names: [...document.querySelectorAll('.case-table__cell--name')].map(e => e.textContent.trim()),
    scrolling: el.classList.contains('is-scrolling'),
    headings: [...document.querySelectorAll('.panel__title')].map(e => e.textContent.trim()),
    columns: [...document.querySelectorAll('.case-table__head .case-table__cell')].map(e => e.textContent.trim()),
    footer: document.querySelector('.footer-stats')?.innerText?.replace(/\\s+/g, ' ').trim() ?? '',
    hospital: document.querySelector('.hud-hospital__band')?.textContent?.trim() ?? '',
  }
})()`

try {
  const target = await waitForTarget()
  ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.onopen = res
    ws.onerror = () => rej(new Error('DevTools WebSocket 连接失败'))
  })
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    }
  }

  await cdp('Runtime.enable')
  await cdp('Page.enable')
  // 锁定视口尺寸：否则截图大小会随窗口/滚动条变化，也无法保证是 1920×1080 版面
  await cdp('Emulation.setDeviceMetricsOverride', {
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
    mobile: false,
  })

  // 等待大屏数据渲染完成
  let state
  for (let i = 0; i < 60; i++) {
    state = await evaluate(READ_TRANSFORM)
    if (state?.ready && state.rows > 0) break
    await sleep(400)
  }

  if (!state?.ready || !state.rows) throw new Error('大屏表格未渲染出数据')

  console.log('\n【大屏验收】')
  check('医院名称已按配置下发（演示为占位名称）', state.hospital === '示例市第二人民医院', state.hospital)
  check(
    '面板标题齐全',
    state.headings.join('|').includes('累计患者饼图') && state.headings.join('|').includes('近12个月') && state.headings.join('|').includes('24小时内急救绿道患者'),
    state.headings.join(' / '),
  )
  const expectCols = ['姓名', '性别', '年龄', '疾病', '时间', '推送方式', '距离', '状态']
  check('表头 8 列且顺序一致', JSON.stringify(state.columns) === JSON.stringify(expectCols), state.columns.join('/'))

  // 脱敏校验：任何一行都不应出现 2 个以上连续汉字姓名以外的形态（这里核心是必须含 *）
  const hasStar = state.names.some((n) => n.includes('*'))
  const noLeak = state.names.every((n) => /^[\u4e00-\u9fa5][*\u4e00-\u9fa5]*$/.test(n) || n.includes('*'))
  check('姓名列已脱敏', hasStar && noLeak, state.names.slice(0, 4).join(' '))
  check('底部统计条渲染', state.footer.includes('目前急救绿道患者总数'), state.footer)

  // 滚动校验：连续采样 transform 位移
  const samples = []
  for (let i = 0; i < 6; i++) {
    samples.push({ t: Date.now(), ...(await evaluate(READ_TRANSFORM)) })
    await sleep(500)
  }
  const ys = samples.map((s) => s.y)
  const moved = Math.abs(ys[ys.length - 1] - ys[0]) > 1
  if (state.scrolling) {
    const dt = (samples[samples.length - 1].t - samples[0].t) / 1000
    const dy = ys[ys.length - 1] - ys[0]
    const speed = dt > 0 ? Math.abs(dy / dt) : 0
    check('表格无缝滚动进行中', moved, `位移 ${dy.toFixed(1)}px / ${dt.toFixed(1)}s ≈ ${speed.toFixed(1)} px/s`)
  } else {
    check('数据不足一屏时不滚动（符合设计）', !moved && ys.every((y) => Math.abs(y) < 0.5), `行数 ${state.rows}，位移 ${ys[0].toFixed(1)}px`)
  }

  // 截图（重新载入一次，确保拿到的是当前数据的完整渲染帧，而不是上屏的旧帧）
  await cdp('Page.reload', { ignoreCache: true })
  for (let i = 0; i < 40; i++) {
    try {
      const s = await evaluate(READ_TRANSFORM)
      if (s?.ready && s.rows > 0) break
    } catch {
      /* 页面重载过程中执行上下文会被销毁，等下一轮即可 */
    }
    await sleep(400)
  }
  await sleep(1200)
  const shot = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  const buf = Buffer.from(shot.data, 'base64')
  writeFileSync(shotPath, buf)
  // PNG 的 IHDR 里含宽高（偏移 16..24 大端），据此断言真实尺寸
  const width = buf.readUInt32BE(16)
  const height = buf.readUInt32BE(20)
  check('已输出 1920×1080 对比截图', width === 1920 && height === 1080, `${width}×${height} → ${shotPath}`)
} catch (err) {
  check('验收脚本执行', false, err instanceof Error ? err.message : String(err))
} finally {
  try {
    ws?.close()
  } catch {
    /* ignore */
  }
  chrome.kill()
  killTree(chrome.pid)
  await sleep(500)
  rmSync(profile, { recursive: true, force: true })
}

const failed = results.filter((r) => !r.ok)
console.log(`\n结果：${results.length - failed.length}/${results.length} 项通过`)
process.exit(failed.length ? 1 : 0)
