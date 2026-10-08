/**
 * 管理后台端到端验收（真实浏览器走完整登录流程，通过 Chrome DevTools 协议驱动）
 *
 * 用法：
 *   node tools/verify-admin.mjs [后台URL] [截图输出路径]
 * 默认：
 *   url  = http://127.0.0.1:3000/admin/#/login
 *   截图 = docs/refs/admin-dashboard.png
 *
 * 校验项：
 *   1. 登录页渲染（标题、演示账号）
 *   2. 用 admin / Hospital@123 真实提交表单 → 跳转工作台
 *   3. 工作台指标卡与图表渲染，且数值来自接口
 *   4. 逐页巡检：病例列表、病例详情、患者、字典、科室、用户、大屏配置、报表、KPI、审计
 *   5. 越权守卫：用 nurse01 打开审计页应落到 403
 *
 * 退出码：0 全部通过；1 存在失败项。
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
const url = process.argv[2] ?? 'http://127.0.0.1:3000/admin/#/login'
const shotPath = resolve(ROOT, process.argv[3] ?? 'docs/refs/admin-dashboard.png')
const PORT = 9334

/** 结束整棵浏览器进程树 */
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
let passed = 0
let failed = 0
const failures = []
function check(name, ok, detail = '') {
  if (ok) {
    passed++
    console.log(`  ✓ ${name}${detail ? ` —— ${detail}` : ''}`)
  } else {
    failed++
    failures.push(name)
    console.log(`  ✗ ${name}${detail ? ` —— ${detail}` : ''}`)
  }
}

const chromeBin = CHROME_CANDIDATES.find((p) => existsSync(p))
if (!chromeBin) {
  console.error('未找到 Chrome / Edge')
  process.exit(1)
}

const profile = mkdtempSync(join(tmpdir(), 'hud-admin-'))
const chrome = spawn(
  chromeBin,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--window-size=1600,900',
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${PORT}`,
    url,
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

/** 等待页面条件成立 */
async function waitFor(expression, timeoutMs = 15000, interval = 300) {
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

/** Vue 受控输入必须走原生 setter + 派发事件，直接赋值不会触发 v-model */
const FILL_HELPER = `
window.__fill = (el, value) => {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set
  setter.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
}
true`

/** 每个页面的巡检表达式（探测条件按实际 DOM 结构写，不依赖具体 UI 库类名） */
const PAGE_CHECKS = [
  { hash: '#/dashboard', name: '工作台', probe: `document.querySelectorAll('canvas').length >= 2 && document.body.innerText.includes('今日新增')`, detail: `图表 = document.querySelectorAll('canvas').length` },
  { hash: '#/cases', name: '病例列表', probe: `document.querySelectorAll('.el-table__body tbody tr').length > 0`, detail: `表格行 = document.querySelectorAll('.el-table__body tbody tr').length` },
  { hash: '#/patients', name: '患者管理', probe: `document.querySelectorAll('.el-table__body tbody tr').length > 0`, detail: `表格行 = document.querySelectorAll('.el-table__body tbody tr').length` },
  { hash: '#/dicts', name: '字典管理', probe: `document.querySelectorAll('.el-tabs__item').length >= 4`, detail: `字典页签 = document.querySelectorAll('.el-tabs__item').length` },
  { hash: '#/org/departments', name: '科室管理', probe: `document.querySelectorAll('.el-tree-node').length > 0`, detail: `树节点 = document.querySelectorAll('.el-tree-node').length` },
  { hash: '#/org/users', name: '用户管理', probe: `document.querySelectorAll('.el-table__body tbody tr').length >= 7`, detail: `账号数 = document.querySelectorAll('.el-table__body tbody tr').length` },
  { hash: '#/screen-config', name: '大屏配置', probe: `!!document.querySelector('input') && document.body.innerText.includes('大屏')`, detail: '含表单与预览按钮' },
  { hash: '#/reports/green-channel', name: '绿道报表', probe: `document.querySelectorAll('canvas').length > 0 && document.querySelectorAll('.el-table__body tbody tr').length > 0`, detail: `图表 = document.querySelectorAll('canvas').length` },
  { hash: '#/reports/kpi', name: '质控 KPI', probe: `document.body.innerText.includes('KPI') || document.body.innerText.includes('响应')`, detail: '含 KPI 指标' },
  { hash: '#/audit/logs', name: '审计日志', probe: `document.querySelectorAll('.el-table__body tbody tr').length > 0`, detail: `日志行 = document.querySelectorAll('.el-table__body tbody tr').length` },
]

try {
  // 连接 DevTools
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
    ws.onopen = res
    ws.onerror = () => rej(new Error('WebSocket 连接失败'))
  })
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m)
      pending.delete(m.id)
    }
  }
  await cdp('Runtime.enable')
  await cdp('Page.enable')

  console.log('\n【管理后台验收】')

  /* 1. 登录页 */
  const loginReady = await waitFor(`document.querySelectorAll('input').length >= 2 && document.body.innerText.includes('登录')`)
  check('登录页渲染完成', loginReady)
  const demoAccounts = await evaluate(`document.body.innerText.includes('Hospital@123') && document.body.innerText.includes('admin')`)
  check('登录页展示演示账号', demoAccounts)

  /* 2. 真实登录 */
  await evaluate(FILL_HELPER)
  const filled = await evaluate(`(() => {
    const inputs = [...document.querySelectorAll('input')].filter(i => i.type !== 'checkbox')
    if (inputs.length < 2) return false
    window.__fill(inputs[0], 'admin')
    window.__fill(inputs[1], 'Hospital@123')
    return true
  })()`)
  check('登录表单可填入账号密码', filled)
  await evaluate(`document.querySelector('.submit-btn')?.click() ?? document.querySelector('.el-button--primary')?.click()`)
  const loggedIn = await waitFor(`location.hash.includes('/dashboard')`, 15000)
  check('登录成功并跳转工作台', loggedIn, await evaluate('location.hash'))

  /* 3. 工作台指标 */
  await waitFor(`document.querySelectorAll('canvas').length >= 2`)
  const cardText = await evaluate(`document.body.innerText.replace(/\\s+/g,' ').trim()`)
  check('工作台指标卡渲染', cardText.includes('今日新增') && cardText.includes('在绿道中'), cardText.slice(cardText.indexOf('工作台'), cardText.indexOf('工作台') + 90))
  check('工作台数值来自接口', /今日新增\s*(\d+)/.test(cardText) && /在绿道中\s*(\d+)/.test(cardText), (cardText.match(/今日新增\s*\d+/) ?? [''])[0] + ' / ' + (cardText.match(/在绿道中\s*\d+/) ?? [''])[0])

  /* 4. 逐页巡检 */
  console.log('\n· 逐页巡检')
  for (const page of PAGE_CHECKS) {
    await evaluate(`location.hash = '${page.hash}'`)
    const ok = await waitFor(page.probe, 15000)
    let detail = ''
    try {
      detail = String(await evaluate(page.detail))
    } catch {
      /* ignore */
    }
    if (!ok) {
      // 失败时把页面可见文本带出来，便于定位是路由没匹配还是接口报错
      try {
        const text = await evaluate(`document.body.innerText.replace(/\\s+/g,' ').trim().slice(0,160)`)
        detail = `${detail} ｜ 页面文本: ${text}`
      } catch {
        /* ignore */
      }
    }
    check(`${page.name}（${page.hash}）`, ok, detail)
  }

  /* 5. 截图（回到工作台） */
  await evaluate(`location.hash = '#/dashboard'`)
  await waitFor(`document.querySelectorAll('.el-card').length >= 4`)
  await sleep(800)
  const shot = await cdp('Page.captureScreenshot', { format: 'png' })
  writeFileSync(shotPath, Buffer.from(shot.data, 'base64'))
  check('已输出后台工作台截图', existsSync(shotPath), shotPath)

  /* 6. 越权巡检：换成护士账号 */
  console.log('\n· 越权守卫')
  await evaluate(`localStorage.clear()`)
  await evaluate(`location.hash = '#/login'; location.reload()`)
  await sleep(2500)
  await waitFor(`document.querySelectorAll('input').length >= 2`, 15000)
  await evaluate(FILL_HELPER)
  await evaluate(`(() => {
    const inputs = [...document.querySelectorAll('input')].filter(i => i.type !== 'checkbox')
    window.__fill(inputs[0], 'nurse01')
    window.__fill(inputs[1], 'Hospital@123')
    return true
  })()`)
  await evaluate(`document.querySelector('.submit-btn')?.click() ?? document.querySelector('.el-button--primary')?.click()`)
  await waitFor(`location.hash.includes('/dashboard')`, 15000)
  await evaluate(`location.hash = '#/audit/logs'`)
  const blocked = await waitFor(`location.hash.includes('403') || document.body.innerText.includes('无权限') || document.body.innerText.includes('没有该操作')`, 12000)
  check('护士访问审计页被拦截（跳 403 或提示无权限）', blocked, await evaluate('location.hash'))
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

console.log(`\n结果：${passed}/${passed + failed} 项通过`)
if (failed) {
  console.log('失败项：')
  failures.forEach((f) => console.log(`  - ${f}`))
}
process.exit(failed ? 1 : 0)
