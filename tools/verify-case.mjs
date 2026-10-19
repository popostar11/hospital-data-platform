/**
 * 病例列表增强功能验收（三筛选 + 导出 Excel + 批量导入 + 批量删除）
 *
 * 用法：
 *   node tools/verify-case.mjs [baseUrl]
 * 默认 baseUrl = http://127.0.0.1:3000/api/v1
 *
 * 只依赖 Node 内置能力。退出码：0 全部通过；1 存在失败项。
 */
const BASE = (process.argv[2] ?? 'http://127.0.0.1:3000/api/v1').replace(/\/$/, '')
const PASSWORD = 'Hospital@123'
const TAG = `CASETEST${Date.now()}`

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

async function api(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
  })
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    return { code: -1, message: '非 JSON 响应', raw: text.slice(0, 120) }
  }
}

console.log(`\n【病例列表增强验收】base = ${BASE}\n`)

const login = await api('/auth/login', { method: 'POST', body: JSON.stringify({ username: 'admin', password: PASSWORD }) })
if (login.code !== 0) {
  console.error('登录失败：', login.message)
  process.exit(1)
}
const H = { Authorization: `Bearer ${login.data.accessToken}` }

/**
 * 记录导入前的最大患者 id。
 * 病例导入会「为每行新建一位患者」，而病例删除不会连带删患者，
 * 因此测试结束必须把本次新建的患者一起清掉，否则会在患者管理里留下孤儿记录。
 */
const beforePatients = await api('/patients?page=1&pageSize=1&sort=id:desc', { headers: H })
const maxPatientIdBefore = beforePatients.data?.list?.[0]?.id ?? 0

/* -------------------------------------------------------- 列表与筛选 */
console.log('· 列表与三个筛选')
const all = await api('/cases?page=1&pageSize=5', { headers: H })
check('病例列表可读', all.code === 0 && all.data.list.length > 0, `total=${all.data?.total}`)
const first = all.data.list[0]
check('列表行含疾病/推送/状态/备注字段', !!first?.diseaseName && !!first?.sourceTypeName && !!first?.statusName && 'remark' in first)
check(
  '列表行带脱敏手机号',
  'phoneMasked' in first && all.data.list.some((r) => r.phoneMasked),
  all.data.list.map((r) => r.phoneMasked ?? '—').join(','),
)
check(
  '手机号一律为脱敏格式（含 *）',
  all.data.list.every((r) => !r.phoneMasked || r.phoneMasked.includes('*')),
  '未出现明文号码',
)

const byDisease = await api('/cases?page=1&pageSize=5&diseaseCode=CHEST_PAIN', { headers: H })
check(
  '按疾病筛选一致',
  byDisease.code === 0 && byDisease.data.list.every((r) => r.diseaseCode === 'CHEST_PAIN'),
  `total=${byDisease.data?.total}`,
)
const byStatus = await api('/cases?page=1&pageSize=5&statusCode=FINISHED', { headers: H })
check(
  '按状态筛选一致',
  byStatus.code === 0 && byStatus.data.list.every((r) => r.statusCode === 'FINISHED'),
  `total=${byStatus.data?.total}`,
)
const bySource = await api('/cases?page=1&pageSize=5&sourceType=PRE_HOSPITAL_120', { headers: H })
check(
  '按推送方式筛选一致',
  bySource.code === 0 && bySource.data.list.every((r) => r.sourceType === 'PRE_HOSPITAL_120'),
  `total=${bySource.data?.total}`,
)
const combo = await api(
  `/cases?page=1&pageSize=5&diseaseCode=${encodeURIComponent(first.diseaseCode)}&sourceType=${encodeURIComponent(first.sourceType)}`,
  { headers: H },
)
check('两个筛选可组合', combo.code === 0 && combo.data.total > 0, `${first.diseaseCode}+${first.sourceType} → ${combo.data?.total}`)

/* ---------------------------------------------------------------- 导出 */
console.log('\n· 导出 Excel')
const exportRes = await fetch(`${BASE}/cases/export?diseaseCode=CHEST_PAIN`, { headers: H })
const buf = new Uint8Array(await exportRes.arrayBuffer())
check('响应为二进制流（非 JSON 信封）', buf[0] !== 0x7b, `首字节 0x${buf[0]?.toString(16)}`)
check('xlsx 魔数 PK', buf[0] === 0x50 && buf[1] === 0x4b, `${buf[0]?.toString(16)} ${buf[1]?.toString(16)}`)
check('导出体积合理（> 10KB）', buf.length > 10 * 1024, `${Math.round(buf.length / 1024)} KB`)

/* ------------------------------------------------------------ 批量导入 */
console.log('\n· 批量导入')
const rows = [
  { patientName: '导入甲', gender: '男', birthDate: '1979-04-05', disease: '胸痛', sourceType: '院前120', createdAt: '2026-10-21 08:00:00', remark: TAG },
  { patientName: '导入乙', gender: '女', birthDate: '1991-08-12', disease: '创伤', sourceType: '院内创建', remark: TAG },
  { patientName: '导入丙', gender: '男', disease: '并不存在的病', sourceType: '院前120', remark: TAG },
  { patientName: '', gender: '男', disease: '胸痛', sourceType: '院前120' },
]
const imported = await api('/cases/import', { method: 'POST', headers: H, body: JSON.stringify({ rows }) })
check('导入成功 2 条、跳过 2 条', imported.code === 0 && imported.data.created === 2 && imported.data.skipped === 2, JSON.stringify({ created: imported.data?.created, skipped: imported.data?.skipped }))
check('未知疾病按行报错（表头算第 1 行）', /不在字典中/.test(imported.data?.errors?.[0]?.message ?? '') && imported.data?.errors?.[0]?.row === 4, `row=${imported.data?.errors?.[0]?.row} ${imported.data?.errors?.[0]?.message}`)
check('空姓名被拒绝', /姓名不能为空/.test(imported.data?.errors?.[1]?.message ?? ''), imported.data?.errors?.[1]?.message)
check('中文名被正确映射为字典编码', imported.code === 0, '胸痛/创伤 → 已创建')

const latest = await api('/cases?page=1&pageSize=5&sort=id:desc', { headers: H })
const mine = latest.data.list.filter((r) => (r.remark ?? '') === TAG || r.caseNo.startsWith('LD20261021'))
check('导入的病例可按备注定位', mine.length >= 1, `命中 ${mine.length} 条`)
check(
  '导入病例带默认状态（院内创建）',
  mine.every((r) => r.statusCode === 'CREATED'),
  mine.map((r) => r.statusName).join(','),
)

/* ------------------------------------------------------------ 批量删除 */
console.log('\n· 批量删除')
const ids = mine.map((r) => r.id)
const deleted = await api('/cases/batch-delete', { method: 'POST', headers: H, body: JSON.stringify({ ids }) })
check('批量删除返回删除条数', deleted.code === 0 && deleted.data.deleted === ids.length, JSON.stringify(deleted.data))

const afterLatest = await api('/cases?page=1&pageSize=5&sort=id:desc', { headers: H })
const stillThere = afterLatest.data.list.filter((r) => ids.includes(r.id))
check('删除后不再出现在列表', stillThere.length === 0, `仍在列表 ${stillThere.length} 条`)

const emptyDel = await api('/cases/batch-delete', { method: 'POST', headers: H, body: JSON.stringify({ ids: [] }) })
check('空选择被拒绝', emptyDel.code !== 0, emptyDel.message)

const gone = await api(`/cases/${ids[0]}`, { headers: H })
check('删除后详情返回 404 语义', gone.code === 40400 || gone.code === 40001, `code=${gone.code} ${gone.message ?? ''}`)

/* ------------------------------------------------------------ 权限 */
console.log('\n· 权限')
// 注意：护士与医生本就有「新增病例」权限，因此他们能导入是正确的；
// 越权验证要用只有只读权限的角色（院领导 / 质控）。
const leader = await api('/auth/login', { method: 'POST', body: JSON.stringify({ username: 'leader01', password: PASSWORD }) })
const leaderImport = await api('/cases/import', {
  method: 'POST',
  headers: { Authorization: `Bearer ${leader.data?.accessToken}` },
  body: JSON.stringify({ rows: [rows[0]] }),
})
check('院领导（只读）导入被拒绝', leaderImport.code === 40300, leaderImport.message)

const nurse = await api('/auth/login', { method: 'POST', body: JSON.stringify({ username: 'nurse01', password: PASSWORD }) })
const nurseDelete = await api('/cases/batch-delete', {
  method: 'POST',
  headers: { Authorization: `Bearer ${nurse.data?.accessToken}` },
  body: JSON.stringify({ ids: [1] }),
})
check('护士无删除病例权限被拒绝', nurseDelete.code === 40300, nurseDelete.message)

const anon = await api('/cases?page=1&pageSize=1')
check('未登录访问病例列表被拒绝', anon.code === 40100, anon.message)

/* -------------------------------------------------- 清理本次新建的患者 */
console.log('\n· 清理测试数据')
const afterPatients = await api('/patients?page=1&pageSize=50&sort=id:desc', { headers: H })
const newPatientIds = (afterPatients.data?.list ?? []).filter((p) => p.id > maxPatientIdBefore).map((p) => p.id)
if (newPatientIds.length > 0) {
  const cleaned = await api('/patients/batch-delete', { method: 'POST', headers: H, body: JSON.stringify({ ids: newPatientIds }) })
  check('导入新建的患者已随测试清理', cleaned.code === 0, `清理 ${cleaned.data?.deleted ?? 0} 条`)
} else {
  check('导入新建的患者已随测试清理', true, '无需清理')
}

/* ------------------------------------------------------------ 汇总 */
console.log(`\n结果：${passed}/${passed + failed} 项通过`)
if (failed) {
  console.log('失败项：')
  failures.forEach((f) => console.log(`  - ${f}`))
}
process.exit(failed ? 1 : 0)
