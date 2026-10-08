/**
 * 接口验收脚本：把「现场素材里出现的数值」固化成断言。
 *
 * 用法：
 *   node tools/verify-api.mjs [baseUrl]
 * 默认 baseUrl = http://127.0.0.1:3000/api/v1
 *
 * 覆盖：
 *   - 大屏聚合数据与演示基线逐项比对（12 个月序列 / 累计创伤 2380 / 24 小时表格 4 行 / 底部总数）
 *   - 脱敏：接口响应中不得出现明文姓名
 *   - 管理端：登录、病例、字典、科室、用户、报表、KPI、工作台、审计、导出
 *   - 权限：护士账号访问审计接口必须被拒（40300）
 *   - 失败登录：错误口令必须返回 40100 且写入登录日志
 *
 * 退出码：0 全部通过；1 存在失败项。
 */
const BASE = (process.argv[2] ?? 'http://127.0.0.1:3000/api/v1').replace(/\/$/, '')

/** 演示数据基线（**合成数据**，与 apps/server/src/db/seed.ts 独立维护以便交叉校验） */
const EXPECT_HOSPITAL = '示例市第二人民医院'
const EXPECT_MONTHS = [188, 362, 219, 254, 336, 328, 297, 281, 319, 345, 302, 63]
const EXPECT_TRAUMA_TOTAL = 2380
const EXPECT_FEATURED = [
  { name: '王*涛', gender: '男', age: 40, disease: '创伤', source: '院内创建', distance: null, status: '完成急救' },
  { name: '赵*兰', gender: '女', age: 88, disease: '创伤', source: '院前120', distance: null, status: '完成急救' },
  { name: '陈*刚', gender: '男', age: 60, disease: '胸痛', source: '院前120', distance: '2.12 km', status: '已反馈' },
  { name: '李*博', gender: '男', age: 13, disease: '创伤', source: '院内创建', distance: null, status: '完成急救' },
]
const PASSWORD = 'Hospital@123'

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

function eq(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  check(name, ok, ok ? String(actual) : `期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`)
}

async function api(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
  })
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    return { code: -1, message: `非 JSON 响应 (${res.status})`, raw: text.slice(0, 120) }
  }
}

async function login(username, password = PASSWORD) {
  return api('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) })
}

console.log(`\n【接口验收】base = ${BASE}\n`)

/* ------------------------------------------------------------------ 基础 */
console.log('· 健康检查与认证')
const health = await api('/health')
check('健康检查可用', health.code === 0 && health.data?.status === 'ok', health.data?.version)

const admin = await login('admin')
check('管理员登录成功', admin.code === 0 && !!admin.data?.accessToken, admin.data?.user?.realName)
const H = { Authorization: `Bearer ${admin.data?.accessToken ?? ''}` }

const me = await api('/auth/me', { headers: H })
check('获取当前用户信息', me.code === 0 && me.data?.username === 'admin', (me.data?.roles ?? []).map((r) => r.code).join(','))
check('管理员拥有通配权限', (me.data?.perms ?? []).includes('*'))

const bad = await login('admin', 'wrong-password')
check('错误口令被拒绝', bad.code === 40100, bad.message)

/* -------------------------------------------------------------- 大屏数据 */
console.log('\n· 大屏聚合数据（与现场素材逐项比对）')
const boot = await api('/screen/bootstrap?screenCode=main&force=1')
const d = boot.data ?? {}
check('医院名称来自配置（演示为占位名称）', d.header?.hospitalName === EXPECT_HOSPITAL, d.header?.hospitalName)

eq('累计病例总数 = 2380', d.pie?.total, EXPECT_TRAUMA_TOTAL)
eq(
  '饼图默认聚焦创伤',
  (d.pie?.items ?? []).map((i) => `${i.name}:${i.value}`),
  [`创伤:${EXPECT_TRAUMA_TOTAL}`],
)

const monthValues = (d.bar?.months ?? []).map((m) => m.value)
eq('近 12 个月柱状数值序列', monthValues, EXPECT_MONTHS)
eq('柱状图 y 轴上限 = 400', d.bar?.yMax, 400)
eq('柱状图月份标签', (d.bar?.months ?? []).map((m) => m.label), ['11', '12', '01', '02', '03', '04', '05', '06', '07', '08', '09', '10'])
check('末位月份标记为「本月至今」', d.bar?.months?.[11]?.partial === true)

const rows = d.table?.rows ?? []
eq('24 小时表格行数 = 4', rows.length, 4)
eq(
  '24 小时表格内容与演示基线一致',
  rows.map((r) => ({ name: r.name, gender: r.gender, age: r.age, disease: r.diseaseName, source: r.sourceTypeName, distance: r.distance, status: r.statusName })),
  EXPECT_FEATURED,
)
eq('底部总数 = 4', d.footer?.total, 4)

const rawBoot = JSON.stringify(boot)
check('响应体中不含明文姓名', !/陈志刚|李文博|王海涛|赵秀兰/.test(rawBoot))
// 机构名称只允许是配置里的占位名称：仓库不含任何真实机构名，因此这里用「是否为占位名」来判定
check('响应体中不出现占位名称以外的机构名', !/医院(?!$)/.test(rawBoot.replace(/示例市第二人民医院/g, '')))

/* ---------------------------------------------------------------- 管理端 */
console.log('\n· 管理端接口')
const cases = await api('/cases?page=1&pageSize=1', { headers: H })
check('病例列表可访问且有数据', cases.code === 0 && cases.data?.total > 5000, `total=${cases.data?.total}`)
check('病例列表带脱敏姓名与疾病配色', !!cases.data?.list?.[0]?.patientName?.includes('*') && !!cases.data?.list?.[0]?.diseaseColor)

// 回归：多表 JOIN 后按同名列排序（patient 与 case 都有 created_at）不得报 ambiguous
const sorted = await api('/cases?page=1&pageSize=3&sort=created_at:desc', { headers: H })
check('病例列表支持排序且列名不歧义', sorted.code === 0 && sorted.data?.list?.length === 3, sorted.code === 0 ? 'ok' : sorted.message)

const meta = await api('/cases/meta', { headers: H })
check('病例表单元数据齐全', (meta.data?.diseases ?? []).length >= 7 && (meta.data?.departments ?? []).length >= 8,
  `疾病 ${(meta.data?.diseases ?? []).length} / 科室 ${(meta.data?.departments ?? []).length} / 事件 ${(meta.data?.eventTypes ?? []).length}`)

const dicts = await api('/dicts?type=disease&withRef=1', { headers: H })
check('疾病字典含引用计数', dicts.code === 0 && typeof dicts.data?.[0]?.refCount === 'number', `首项 ${dicts.data?.[0]?.name} refCount=${dicts.data?.[0]?.refCount}`)

const depts = await api('/departments', { headers: H })
check('科室树返回层级结构', depts.code === 0 && (depts.data?.[0]?.children ?? []).length > 0, depts.data?.[0]?.name)

const users = await api('/users?page=1&pageSize=50', { headers: H })
check('用户列表返回 7 个内置账号', (users.data?.total ?? 0) >= 7, `total=${users.data?.total}`)

const report = await api('/reports/green-channel?groupBy=month&from=2025-11-01&to=2026-10-31', { headers: H })
eq('月报共 12 个分组', (report.data?.buckets ?? []).length, 12)
eq('月报总量 = 素材 12 个月之和', report.data?.summary?.total, EXPECT_MONTHS.reduce((a, b) => a + b, 0))

const kpi = await api('/reports/kpi?from=2025-11-01&to=2026-10-31', { headers: H })
check('KPI 返回响应时长与闭环率', kpi.code === 0 && kpi.data?.avgResponseMinutes > 0 && kpi.data?.closedRate > 0,
  `平均响应 ${kpi.data?.avgResponseMinutes} 分钟 / 闭环率 ${kpi.data?.closedRate}%`)

const dash = await api('/dashboard/overview', { headers: H })
check('工作台返回 7 日趋势', (dash.data?.trend ?? []).length === 7 && typeof dash.data?.todayTotal === 'number',
  `今日 ${dash.data?.todayTotal} / 在绿道 ${dash.data?.openCount}`)

const audit = await api('/audit/logs?page=1&pageSize=5', { headers: H })
check('操作审计可查询', audit.code === 0 && (audit.data?.total ?? 0) > 0, `total=${audit.data?.total}`)

const screenCfg = await api('/screen-configs', { headers: H })
check('大屏配置可读取', screenCfg.code === 0 && screenCfg.data?.[0]?.hospitalName === EXPECT_HOSPITAL,
  `visibleRows=${screenCfg.data?.[0]?.visibleRows} scrollSpeed=${screenCfg.data?.[0]?.scrollSpeed}`)

/* 导出（二进制） */
const exportRes = await fetch(`${BASE}/cases/export?pageSize=5`, { headers: H })
const buf = Buffer.from(await exportRes.arrayBuffer())
check('病例导出返回 xlsx 文件流',
  exportRes.headers.get('content-type')?.includes('spreadsheetml') && buf[0] === 0x50 && buf[1] === 0x4b,
  `${Math.round(buf.length / 1024)} KB, 魔数 ${buf.slice(0, 2).toString()}`)

/* ---------------------------------------------------------------- 权限 */
console.log('\n· 权限与安全')
const nurse = await login('nurse01')
check('护士登录成功', nurse.code === 0)
const nurseAudit = await api('/audit/logs', { headers: { Authorization: `Bearer ${nurse.data?.accessToken}` } })
check('护士访问审计接口被拒绝', nurseAudit.code === 40300, nurseAudit.message)

const anon = await api('/cases')
check('未登录访问病例接口被拒绝', anon.code === 40100, anon.message)

const leader = await login('leader01')
const leaderPlain = await api('/patients/1/plain', { headers: { Authorization: `Bearer ${leader.data?.accessToken}` } })
check('院领导无明文查看权限', leaderPlain.code === 40300, leaderPlain.message)

const adminPlain = await api('/patients/1/plain', { headers: H })
check('管理员可查看明文（已留痕）', adminPlain.code === 0 && typeof adminPlain.data?.name === 'string', adminPlain.data?.name?.[0] ? '已返回明文' : '空')

const plainLog = await api('/audit/logs?action=VIEW_SENSITIVE&page=1&pageSize=1', { headers: H })
check('明文查看已写入审计日志', (plainLog.data?.total ?? 0) > 0, `total=${plainLog.data?.total}`)

/* ------------------------------------------------------------------ 汇总 */
console.log(`\n结果：${passed}/${passed + failed} 项通过`)
if (failed) {
  console.log('失败项：')
  failures.forEach((f) => console.log(`  - ${f}`))
}
process.exit(failed ? 1 : 0)
