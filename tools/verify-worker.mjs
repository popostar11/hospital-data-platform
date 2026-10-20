/**
 * Cloudflare 版（Workers + D1）验收脚本
 *
 * 用法：
 *   node tools/verify-worker.mjs [baseUrl]
 * 默认 baseUrl = http://127.0.0.1:8788
 *
 * 与 verify-api.mjs 的区别：本脚本针对**公网演示部署**的契约，
 * 额外断言两件本地版没有的事：
 *   1. 全站不出现任何真实机构名称（只用占位名称）
 *   2. 不提供患者明文（云版库中只保留脱敏姓名）
 * 同时把本地版的差异项（xlsx→CSV、附件上传未启用）作为**预期行为**断言，
 * 避免把「设计如此」误判成故障。
 *
 * 退出码：0 全部通过；1 存在失败项。
 */
const BASE = (process.argv[2] ?? 'http://127.0.0.1:8788').replace(/\/$/, '')
const PASSWORD = 'Hospital@123'
const EXPECT_HOSPITAL = '示例市第二人民医院'
const EXPECT_MONTHS = [188, 362, 219, 254, 336, 328, 297, 281, 319, 345, 302, 63]
const EXPECT_TRAUMA = 2380
const EXPECT_NAMES = ['王*涛', '赵*兰', '陈*刚', '李*博']

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
const eq = (name, a, b) => check(name, JSON.stringify(a) === JSON.stringify(b), JSON.stringify(a))

async function api(path, options = {}) {
  const res = await fetch(`${BASE}/api/v1${path}`, {
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
const login = (username, password = PASSWORD) =>
  api('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) })

console.log(`\n【Cloudflare 版验收】base = ${BASE}\n`)

/* --------------------------------------------------------- 运行时与静态资源 */
console.log('· 运行时与静态资源')
const health = await api('/health')
check('Workers 运行时健康检查', health.code === 0 && health.data?.runtime === 'cloudflare-workers', health.data?.runtime)

for (const [path, marker] of [
  ['/', '急诊专科中心数据平台'],
  ['/admin/', '<div id="app">'],
  ['/screen/', '<div id="app">'],
]) {
  const res = await fetch(`${BASE}${path}`)
  const text = await res.text()
  check(`静态资源 ${path}`, res.ok && text.includes(marker), `HTTP ${res.status} / ${text.length} 字节`)
}

/* ---------------------------------------------------------------- 大屏数据 */
console.log('\n· 大屏聚合数据（合成演示基线）')
const boot = await api('/screen/bootstrap?screenCode=main&force=1')
const d = boot.data ?? {}
check('医院名称为占位名称', d.header?.hospitalName === EXPECT_HOSPITAL, d.header?.hospitalName)
eq('累计病例 = 2380', d.pie?.total, EXPECT_TRAUMA)
eq('近 12 个月序列', (d.bar?.months ?? []).map((m) => m.value), EXPECT_MONTHS)
eq('柱状图 y 轴上限 = 400', d.bar?.yMax, 400)
eq('24 小时表格 4 行且全为脱敏姓名', (d.table?.rows ?? []).map((r) => r.name), EXPECT_NAMES)
eq('底部未闭环总数 = 4', d.footer?.total, 4)

const rawBoot = JSON.stringify(boot)
check('响应体中无明文姓名', !/陈志刚|李文博|王海涛|赵秀兰/.test(rawBoot))
// 「医院」二字只允许出现在占位名称里 —— 这样既校验了机构名唯一，又不必把真实名称写进脚本
const hospitalMentions = (rawBoot.match(/医院/g) ?? []).length
const placeholderMentions = (rawBoot.match(new RegExp(EXPECT_HOSPITAL, 'g')) ?? []).length
check('响应体中只出现占位机构名称', hospitalMentions === placeholderMentions, `医院×${hospitalMentions} / 占位名×${placeholderMentions}`)

/* ------------------------------------------------------------------ 认证 */
console.log('\n· 认证与权限')
check('验证码按设计关闭', (await api('/auth/captcha')).data?.enabled === false)
const admin = await login('admin')
check('管理员登录成功（PBKDF2 校验）', admin.code === 0 && !!admin.data?.accessToken, admin.data?.user?.realName)
const H = { Authorization: `Bearer ${admin.data?.accessToken ?? ''}` }
check('错误口令被拒绝', (await login('admin', 'wrong')).code === 40100)
check('未登录访问病例被拒绝', (await api('/cases')).code === 40100)

const nurse = await login('nurse01')
const nurseAudit = await api('/audit/logs', { headers: { Authorization: `Bearer ${nurse.data?.accessToken}` } })
check('护士访问审计被拒绝', nurseAudit.code === 40300, nurseAudit.message)

/* ---------------------------------------------------------------- 业务读取 */
console.log('\n· 业务接口')
const cases = await api('/cases?page=1&pageSize=2', { headers: H })
check('病例列表', cases.code === 0 && cases.data?.total === 5089, `total=${cases.data?.total}`)
check('病例列表支持排序（JOIN 后列名不歧义）', (await api('/cases?sort=created_at:desc&pageSize=1', { headers: H })).code === 0)
check('病例详情', (await api(`/cases/${cases.data?.list?.[0]?.id}`, { headers: H })).code === 0)
check('病例表单元数据', (await api('/cases/meta', { headers: H })).code === 0)

const dash = await api('/dashboard/overview', { headers: H })
check('工作台 7 日趋势', (dash.data?.trend ?? []).length === 7, `今日 ${dash.data?.todayTotal}`)
const report = await api('/reports/green-channel?groupBy=month', { headers: H })
eq('月报 12 个分组', (report.data?.buckets ?? []).length, 12)
eq('月报合计 = 3294', report.data?.summary?.total, EXPECT_MONTHS.reduce((a, b) => a + b, 0))
check('KPI 指标', (await api('/reports/kpi', { headers: H })).code === 0)
check('字典接口', (await api('/dicts?type=disease', { headers: H })).code === 0)
check('科室树', (await api('/departments', { headers: H })).code === 0)
check('用户与角色', (await api('/users?pageSize=50', { headers: H })).data?.total >= 7)
check('审计日志', (await api('/audit/logs', { headers: H })).code === 0)
check('对接待办日志', (await api('/integrations/logs', { headers: H })).code === 0)

/* ------------------------------------------------------ 云端差异（应为预期） */
console.log('\n· 云端与本地版的已知差异（断言为预期行为）')
const exportRes = await fetch(`${BASE}/api/v1/cases/export?pageSize=5`, { headers: H })
check('导出为 CSV（本地版为 xlsx）', exportRes.headers.get('content-type')?.includes('text/csv'), exportRes.headers.get('content-type') ?? '')

const attach = await api('/cases/1/attachments', { method: 'POST', headers: H, body: '{}' })
check('附件上传明确提示未启用', attach.code !== 0 && /未启用/.test(attach.message ?? ''), attach.message)

const plain = await api('/patients/1/plain', { headers: H })
check('患者明文查看被拒绝（库中只存脱敏姓名）', plain.code === 40300, plain.message)

/* ------------------------------------------------------------------ 汇总 */
console.log(`\n结果：${passed}/${passed + failed} 项通过`)
if (failed) {
  console.log('失败项：')
  failures.forEach((f) => console.log(`  - ${f}`))
}
process.exit(failed ? 1 : 0)
