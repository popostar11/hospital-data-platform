/**
 * 导出「后台静态演示」数据快照
 *
 * 用途：GitHub Pages 只能托管静态文件，没有后端。为了在公网上也能点开后台，
 * 这里把各页面用到的接口响应抓成一份 JSON，前端在演示模式（VITE_DEMO=1）下
 * 由 src/api/demo.ts 模拟这些接口。
 *
 * 用法：先启动本地服务，然后
 *   node tools/export-admin-demo.mjs [baseUrl]
 * 产物：apps/admin-web/public/demo-admin.json
 *
 * 注意：均为合成演示数据，不含任何真实机构或个人信息。
 */
import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BASE = (process.argv[2] ?? 'http://127.0.0.1:3000').replace(/\/$/, '')
const API = `${BASE}/api/v1`
const OUT_DIR = join(ROOT, 'apps', 'admin-web', 'public')
const OUT = join(OUT_DIR, 'demo-admin.json')

const USERNAME = process.env.DEMO_USER ?? 'admin'
const PASSWORD = process.env.DEMO_PASS ?? 'Hospital@123'

/** 列表快照条数：够翻几页、文件又不会太大 */
const LIST_ROWS = 200
/** 详情快照条数（详情页用，其余按列表行合成） */
const DETAIL_ROWS = 5

console.log(`\n【导出后台演示快照】数据源 ${BASE}`)

let token = ''
async function call(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error(`${method} ${path} 返回非 JSON（HTTP ${res.status}）`)
  }
  if (json.code !== 0) throw new Error(`${method} ${path} 失败：${json.message}`)
  return json.data
}

/* ------------------------------------------------------------ 1. 登录 */
const login = await call('POST', '/auth/login', { username: USERNAME, password: PASSWORD })
token = login.accessToken
console.log(`  登录成功：${login.user.realName}（${login.user.roles.map((r) => r.name).join('、')}）`)

/* ------------------------------------------------------------ 2. 抓数据 */
const snapshot = {}

async function grab(key, path) {
  try {
    snapshot[key] = await call('GET', path)
    const v = snapshot[key]
    const size = Array.isArray(v) ? `${v.length} 项` : typeof v === 'object' ? '对象' : String(v)
    console.log(`  ✓ ${key.padEnd(16)} ${path.padEnd(44)} ${size}`)
  } catch (err) {
    console.log(`  ✗ ${key.padEnd(16)} ${path.padEnd(44)} ${err.message}`)
  }
}

// 登录态与工作台
snapshot.me = login.user
await grab('overview', '/dashboard/overview')

// 病例
await grab('cases', `/cases?page=1&pageSize=${LIST_ROWS}`)
await grab('caseMeta', '/cases/meta')
const caseIds = (snapshot.cases?.list ?? []).slice(0, DETAIL_ROWS).map((r) => r.id)
snapshot.caseDetails = {}
for (const id of caseIds) {
  try {
    snapshot.caseDetails[id] = await call('GET', `/cases/${id}`)
    console.log(`  ✓ caseDetails      /cases/${id}`.padEnd(68) + '详情')
  } catch (err) {
    console.log(`  ✗ caseDetails      /cases/${id}  ${err.message}`)
  }
}

// 患者
await grab('patients', `/patients?page=1&pageSize=${LIST_ROWS}`)
const patientIds = (snapshot.patients?.list ?? []).slice(0, DETAIL_ROWS).map((r) => r.id)
snapshot.patientDetails = {}
for (const id of patientIds) {
  try {
    snapshot.patientDetails[id] = await call('GET', `/patients/${id}`)
    console.log(`  ✓ patientDetails   /patients/${id}`.padEnd(65) + '详情')
  } catch (err) {
    console.log(`  ✗ patientDetails   /patients/${id}  ${err.message}`)
  }
}

// 字典（四种类型合并）
snapshot.dicts = []
for (const type of ['disease', 'sourceType', 'caseStatus', 'eventType']) {
  try {
    const items = await call('GET', `/dicts?type=${type}`)
    snapshot.dicts.push(...items.map((it) => ({ ...it, type })))
    console.log(`  ✓ dicts[${type}]`.padEnd(24) + `${items.length} 项`)
  } catch (err) {
    console.log(`  ✗ dicts[${type}]  ${err.message}`)
  }
}

// 组织人员
await grab('departments', '/departments')
await grab('users', `/users?page=1&pageSize=${LIST_ROWS}`)
await grab('roles', '/roles')

// 审计
await grab('auditLogs', '/audit/logs?page=1&pageSize=80')
await grab('auditLogins', '/audit/logins?page=1&pageSize=80')

// 报表（近 12 个月）
const now = new Date()
const to = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
const fromDate = new Date(now.getFullYear(), now.getMonth() - 11, 1)
const from = `${fromDate.getFullYear()}-${String(fromDate.getMonth() + 1).padStart(2, '0')}-01`
await grab('report', `/reports/green-channel?from=${from}&to=${to}`)
await grab('kpi', `/reports/kpi?from=${from}&to=${to}`)

// 大屏配置
await grab('screenConfigs', '/screen-configs')

/* ------------------------------------------------------------ 3. 落盘 */
const payload = {
  generatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
  source: BASE,
  note: '静态演示快照：由本地合成演示数据导出，不含真实机构与个人信息',
  loginUser: { ...login.user, perms: ['*'] },
  ...snapshot,
}

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(OUT, JSON.stringify(payload), 'utf8')

const kb = Math.round(Buffer.byteLength(JSON.stringify(payload)) / 1024)
console.log(`\n  已写入：${OUT}（${kb} KB）`)
console.log('  接下来：VITE_DEMO=1 PAGES_BASE=/hospital-data-platform/admin/ pnpm --filter @hospital/admin-web build\n')
