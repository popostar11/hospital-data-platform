/**
 * 患者管理增强功能验收（三个筛选 + 导出 CSV + 批量导入 + 批量删除）
 *
 * 用法：
 *   node tools/verify-patient.mjs [baseUrl]
 * 默认 baseUrl = http://127.0.0.1:3000/api/v1
 *
 * 只依赖 Node 内置能力，不需要测试框架。
 * 退出码：0 全部通过；1 存在失败项。
 */
const BASE = (process.argv[2] ?? 'http://127.0.0.1:3000/api/v1').replace(/\/$/, '')
const PASSWORD = 'Hospital@123'
const TAG = `VERIFY-${Date.now()}`

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

console.log(`\n【患者管理增强验收】base = ${BASE}\n`)

/* ------------------------------------------------------------ 登录 */
const login = await api('/auth/login', { method: 'POST', body: JSON.stringify({ username: 'admin', password: PASSWORD }) })
if (login.code !== 0) {
  console.error('登录失败：', login.message)
  process.exit(1)
}
const H = { Authorization: `Bearer ${login.data.accessToken}` }

/* -------------------------------------------------------- 列表与筛选 */
console.log('· 列表与三个筛选')
const all = await api('/patients?page=1&pageSize=5', { headers: H })
check('患者列表可读', all.code === 0 && all.data.list.length > 0, `total=${all.data?.total}`)

const first = all.data.list[0]
check(
  '每行带最近一条病例的疾病/推送/状态/时间',
  !!first?.diseaseName && !!first?.sourceTypeName && !!first?.statusName && !!first?.lastVisitAt,
  `${first?.nameMasked} ${first?.diseaseName}/${first?.sourceTypeName}/${first?.statusName}`,
)
check('列表行含备注字段（可为空）', 'remark' in first)
check(
  '默认按最近就诊倒序',
  all.data.list.every((r, i, arr) => i === 0 || String(arr[i - 1].lastVisitAt ?? '') >= String(r.lastVisitAt ?? '')),
  all.data.list.map((r) => r.lastVisitAt).join(' > '),
)

const byDisease = await api('/patients?page=1&pageSize=5&diseaseCode=CHEST_PAIN', { headers: H })
check(
  '按疾病筛选：结果疾病一致',
  byDisease.code === 0 && byDisease.data.list.every((r) => r.diseaseCode === 'CHEST_PAIN'),
  `total=${byDisease.data?.total}`,
)

const byStatus = await api('/patients?page=1&pageSize=5&statusCode=FINISHED', { headers: H })
check(
  '按状态筛选：结果状态一致',
  byStatus.code === 0 && byStatus.data.list.every((r) => r.statusCode === 'FINISHED'),
  `total=${byStatus.data?.total}`,
)

const bySource = await api('/patients?page=1&pageSize=5&sourceType=PRE_HOSPITAL_120', { headers: H })
check(
  '按推送方式筛选：结果一致',
  bySource.code === 0 && bySource.data.list.every((r) => r.sourceType === 'PRE_HOSPITAL_120'),
  `total=${bySource.data?.total}`,
)

const combo = await api(
  `/patients?page=1&pageSize=5&diseaseCode=${encodeURIComponent(first.diseaseCode)}&sourceType=${encodeURIComponent(first.sourceType)}`,
  { headers: H },
)
check(
  '两个筛选可组合',
  combo.code === 0 && combo.data.total > 0 && combo.data.list.every((r) => r.diseaseCode === first.diseaseCode && r.sourceType === first.sourceType),
  `${first.diseaseCode} + ${first.sourceType} → total=${combo.data?.total}`,
)

const empty = await api('/patients?page=1&pageSize=5&diseaseCode=NOT_EXIST_CODE', { headers: H })
check('不存在的疾病筛选返回空', empty.code === 0 && empty.data.total === 0)

/* ---------------------------------------------------------------- 导出 */
console.log('\n· 导出 CSV')
const exportRes = await fetch(`${BASE}/patients/export?diseaseCode=CHEST_PAIN`, { headers: H })
// 注意：BOM 必须用**原始字节**判断 —— fetch 的 Response.text() 会按编码规范把 BOM 剥掉
const exportBytes = new Uint8Array(await exportRes.clone().arrayBuffer())
const hasBom = exportBytes[0] === 0xef && exportBytes[1] === 0xbb && exportBytes[2] === 0xbf
const csv = await exportRes.text()
check('响应类型为 CSV', (exportRes.headers.get('content-type') ?? '').includes('text/csv'), exportRes.headers.get('content-type') ?? '')
check('未被统一响应信封包裹', !csv.trimStart().startsWith('{'))
check('带 UTF-8 BOM（Excel 直接可开）', hasBom, `前 3 字节 ${[...exportBytes.slice(0, 3)].map((b) => b.toString(16).padStart(2, '0')).join(' ')}`)
const csvLines = csv.replace(/^\uFEFF/, '').split('\r\n')
check('表头 9 列', csvLines[0] === '姓名,性别,年龄,疾病,推送方式,手机号,状态,最近就诊时间,备注', csvLines[0])
check(
  '导出行数 = 筛选总数 + 1 行表头',
  csvLines.length === byDisease.data.total + 1,
  `CSV ${csvLines.length} 行 / total ${byDisease.data.total}`,
)

/* ------------------------------------------------------------ 批量导入 */
console.log('\n· 批量导入')
const rows = [
  { name: '验收甲', gender: '男', birthDate: '1990-01-02', mrn: `${TAG}-A`, phone: '13700001111', remark: '验收导入' },
  { name: '验收乙', gender: '女', birthDate: '1985-06-07', mrn: `${TAG}-B`, phone: '13700002222' },
  { name: '', gender: '男' },
]
const imported = await api('/patients/import', { method: 'POST', headers: H, body: JSON.stringify({ rows }) })
check('导入成功 2 条、跳过 1 条', imported.code === 0 && imported.data.created === 2 && imported.data.skipped === 1, JSON.stringify(imported.data))
check('错误行带行号（表头算第 1 行）', imported.data?.errors?.[0]?.row === 4, `row=${imported.data?.errors?.[0]?.row}`)
check('空姓名被拒绝且提示明确', /姓名不能为空/.test(imported.data?.errors?.[0]?.message ?? ''), imported.data?.errors?.[0]?.message)

const dup = await api('/patients/import', { method: 'POST', headers: H, body: JSON.stringify({ rows: [rows[0]] }) })
check('重复病案号被跳过', dup.code === 0 && dup.data.created === 0 && dup.data.skipped === 1, dup.data?.errors?.[0]?.message)

const found = await api(`/patients?page=1&pageSize=10&keyword=${encodeURIComponent(TAG)}`, { headers: H })
check('导入后可按病案号检索到', found.code === 0 && found.data.total === 2, `total=${found.data?.total}`)
check('导入的姓名按规则脱敏', found.data.list.every((r) => r.nameMasked.includes('*')), found.data.list.map((r) => r.nameMasked).join(','))

/* ------------------------------------------------------------ 批量删除 */
console.log('\n· 批量删除')
const ids = found.data.list.map((r) => r.id)
const deleted = await api('/patients/batch-delete', { method: 'POST', headers: H, body: JSON.stringify({ ids }) })
check('批量删除返回删除条数', deleted.code === 0 && deleted.data.deleted === 2, JSON.stringify(deleted.data))

const after = await api(`/patients?page=1&pageSize=10&keyword=${encodeURIComponent(TAG)}`, { headers: H })
check('删除后检索不到', after.code === 0 && after.data.total === 0, `total=${after.data?.total}`)

const emptyDel = await api('/patients/batch-delete', { method: 'POST', headers: H, body: JSON.stringify({ ids: [] }) })
check('空选择被拒绝', emptyDel.code !== 0, emptyDel.message)

/* ------------------------------------------------------------ 权限 */
console.log('\n· 权限')
const nurse = await api('/auth/login', { method: 'POST', body: JSON.stringify({ username: 'nurse01', password: PASSWORD }) })
const nurseImport = await api('/patients/import', {
  method: 'POST',
  headers: { Authorization: `Bearer ${nurse.data?.accessToken}` },
  body: JSON.stringify({ rows: [rows[0]] }),
})
check('护士无导入权限被拒绝', nurseImport.code === 40300, nurseImport.message)

const anon = await api('/patients?page=1&pageSize=1')
check('未登录访问患者列表被拒绝', anon.code === 40100, anon.message)

/* ------------------------------------------------------------ 汇总 */
console.log(`\n结果：${passed}/${passed + failed} 项通过`)
if (failed) {
  console.log('失败项：')
  failures.forEach((f) => console.log(`  - ${f}`))
}
process.exit(failed ? 1 : 0)
