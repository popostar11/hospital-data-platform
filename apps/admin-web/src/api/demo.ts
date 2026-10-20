/**
 * 静态演示模式下的「假后端」
 *
 * GitHub Pages 没有服务端，演示模式下由本模块用 tools/export-admin-demo.mjs
 * 导出的 demo-admin.json 回答所有请求：
 *   - 读请求：在快照上做过滤 / 分页，交互与真实接口一致
 *   - 写请求：明确拒绝并提示「静态演示为只读」，不假装成功
 *
 * 只在 VITE_DEMO=1 构建时被 client.ts 调用，本地/院内版完全不经过这里。
 */
import { ElMessage } from 'element-plus'

/* ------------------------------------------------------------------ 类型 */

interface ListShape {
  list: Record<string, unknown>[]
  total: number
}

interface DemoFixture {
  generatedAt: string
  loginUser: Record<string, unknown>
  overview?: unknown
  cases?: ListShape
  caseMeta?: unknown
  caseDetails?: Record<string, Record<string, unknown>>
  patients?: ListShape
  patientDetails?: Record<string, Record<string, unknown>>
  dicts?: { type: string }[]
  departments?: unknown
  users?: ListShape
  roles?: unknown
  auditLogs?: ListShape
  auditLogins?: ListShape
  report?: unknown
  kpi?: unknown
  screenConfigs?: unknown
}

/* ------------------------------------------------------------ 快照加载 */

let fixturePromise: Promise<DemoFixture> | null = null

function loadFixture(): Promise<DemoFixture> {
  if (!fixturePromise) {
    // 相对当前页面取，Pages 与本地都能命中
    const url = new URL('demo-admin.json', document.baseURI).toString()
    fixturePromise = fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json() as Promise<DemoFixture>
      })
      .catch((err: unknown) => {
        fixturePromise = null
        throw new Error(`演示数据加载失败：${err instanceof Error ? err.message : String(err)}`)
      })
  }
  return fixturePromise
}

export const DEMO_MODE = true
export const DEMO_LOGIN_HINT = '静态演示：任意账号密码均可登录（数据为导出的快照，只读）'

/* ------------------------------------------------------------ 只读提示 */

let lastWriteNotify = 0
const WRITE_HINT = '静态演示为只读：新增 / 编辑 / 删除 / 导入请在本地版验证'

function rejectWrite(): never {
  const now = Date.now()
  if (now - lastWriteNotify > 1500) {
    lastWriteNotify = now
    ElMessage.warning(WRITE_HINT)
  }
  throw new Error(WRITE_HINT)
}

/* -------------------------------------------------------------- 工具 */

type Params = Record<string, unknown>

function str(value: unknown): string {
  return value === undefined || value === null ? '' : String(value)
}

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || value === ''
}

/** 按关键字在多个字段里做包含匹配（对应后端多个 LIKE） */
function matchKeyword(row: Record<string, unknown>, keyword: string, fields: string[]): boolean {
  if (!keyword) return true
  const kw = keyword.toLowerCase()
  return fields.some((f) => str(row[f]).toLowerCase().includes(kw))
}

/** 等值筛选；参数为空则不过滤 */
function matchEqual(row: Record<string, unknown>, params: Params, keys: string[]): boolean {
  return keys.every((k) => {
    const want = params[k]
    if (isBlank(want)) return true
    return str(row[k]) === str(want)
  })
}

/** 分页：返回 { list, total, page, pageSize } */
function paginate(
  rows: Record<string, unknown>[],
  params: Params,
): { list: Record<string, unknown>[]; total: number; page: number; pageSize: number } {
  const pageSize = Math.min(200, Math.max(1, Number(params.pageSize) || 20))
  const page = Math.max(1, Number(params.page) || 1)
  const start = (page - 1) * pageSize
  return { list: rows.slice(start, start + pageSize), total: rows.length, page, pageSize }
}

/** 把 URL 里的 :id 抽出来 */
function pathId(url: string): number {
  const m = url.match(/\/(\d+)(?:\/|$)/)
  return m ? Number(m[1]) : NaN
}

/* ------------------------------------------------------------ 分发 */

export async function demoRequest(
  method: string,
  url: string,
  params?: Params,
  body?: unknown,
): Promise<unknown> {
  const fx = await loadFixture()
  const p = params ?? {}
  const verb = method.toUpperCase()

  /* ------------------------------------------------------ 认证 */
  if (url === '/auth/login') {
    const username = str((body as Params | undefined)?.username) || 'admin'
    return {
      accessToken: 'demo-access-token',
      refreshToken: 'demo-refresh-token',
      user: { ...fx.loginUser, username },
    }
  }
  if (url === '/auth/refresh') {
    return {
      accessToken: 'demo-access-token',
      refreshToken: 'demo-refresh-token',
      user: fx.loginUser,
    }
  }
  if (url === '/auth/logout') return undefined
  if (url === '/auth/captcha') return { captchaId: 'demo', image: '' }
  if (url === '/auth/me') return fx.loginUser

  /* ------------------------------------------------------ 写操作一律拒绝 */
  if (verb !== 'GET') return rejectWrite()

  /* ------------------------------------------------------ 工作台 */
  if (url === '/dashboard/overview') return fx.overview

  /* ------------------------------------------------------ 病例 */
  if (url === '/cases/meta') return fx.caseMeta
  if (url === '/cases') {
    const rows = (fx.cases?.list ?? []).filter((r) => {
      if (!matchKeyword(r, str(p.keyword), ['caseNo', 'patientName', 'mrn'])) return false
      if (!matchEqual(r, p, ['diseaseCode', 'statusCode', 'sourceType'])) return false
      if (!isBlank(p.deptId) && str(r.deptId) !== str(p.deptId)) return false
      if (p.isClosed !== undefined && p.isClosed !== null && p.isClosed !== '') {
        if (Boolean(r.isClosed) !== Boolean(p.isClosed)) return false
      }
      const createdAt = str(r.createdAt)
      if (!isBlank(p.from) && createdAt.slice(0, 10) < str(p.from)) return false
      if (!isBlank(p.to) && createdAt.slice(0, 10) > str(p.to)) return false
      return true
    })
    return paginate(rows, p)
  }
  if (url.startsWith('/cases/') && !url.includes('/without')) {
    const id = pathId(url)
    const captured = fx.caseDetails?.[String(id)]
    if (captured) return captured
    const row = (fx.cases?.list ?? []).find((r) => Number(r.id) === id)
    if (!row) throw new Error('演示快照中没有这条病例')
    // 详情页需要的字段：用列表行补一个最小可用结构
    return {
      ...row,
      patient: {
        id: row.patientId,
        mrn: row.mrn ?? null,
        nameMasked: row.patientName,
        gender: 9,
        genderName: row.genderName,
        age: row.age,
        phoneMasked: row.phoneMasked ?? null,
        idCardMasked: null,
        visitCount: 0,
        createdAt: row.createdAt,
        remark: null,
        lastCaseId: row.id,
        lastCaseNo: row.caseNo,
        diseaseCode: row.diseaseCode,
        diseaseName: row.diseaseName,
        diseaseColor: row.diseaseColor,
        deptId: row.deptId,
        deptName: row.deptName,
        sourceType: row.sourceType,
        sourceTypeName: row.sourceTypeName,
        sourceColor: null,
        statusCode: row.statusCode,
        statusName: row.statusName,
        statusColor: row.statusColor,
        lastVisitAt: row.createdAt,
      },
      events: [],
      responseMinutes: null,
      attachments: [],
    }
  }

  /* ------------------------------------------------------ 患者 */
  if (url === '/patients/search') {
    const kw = str(p.keyword).toLowerCase()
    return (fx.patients?.list ?? [])
      .filter((r) => matchKeyword(r, kw, ['nameMasked', 'mrn']))
      .slice(0, 30)
  }
  if (url.endsWith('/plain')) {
    throw new Error('静态演示不提供患者明文查看（快照里没有明文）')
  }
  if (url === '/patients') {
    const rows = (fx.patients?.list ?? []).filter((r) => {
      if (!matchKeyword(r, str(p.keyword), ['nameMasked', 'mrn', 'lastCaseNo'])) return false
      if (!matchEqual(r, p, ['diseaseCode', 'statusCode', 'sourceType'])) return false
      return true
    })
    return paginate(rows, p)
  }
  if (url.startsWith('/patients/')) {
    const id = pathId(url)
    const captured = fx.patientDetails?.[String(id)]
    if (captured) return captured
    const row = (fx.patients?.list ?? []).find((r) => Number(r.id) === id)
    if (!row) throw new Error('演示快照中没有这位患者')
    return { ...row, birthDate: row.birthDate ?? null }
  }

  /* ------------------------------------------------------ 字典 / 组织 */
  if (url === '/dicts') {
    const type = str(p.type)
    const all = (fx.dicts ?? []) as Record<string, unknown>[]
    return type ? all.filter((d) => str(d.type) === type) : all
  }
  if (url === '/departments' || url === '/departments/flat') return fx.departments
  if (url === '/users') {
    const rows = (fx.users?.list ?? []).filter((r) => {
      if (!matchKeyword(r, str(p.keyword), ['username', 'realName'])) return false
      if (!isBlank(p.deptId) && str(r.deptId) !== str(p.deptId)) return false
      if (p.enabled !== undefined && p.enabled !== null && p.enabled !== '') {
        if (Boolean(r.enabled) !== Boolean(p.enabled)) return false
      }
      return true
    })
    return paginate(rows, p)
  }
  if (url === '/roles') return fx.roles

  /* ------------------------------------------------------ 审计 */
  if (url === '/audit/logs') {
    const rows = (fx.auditLogs?.list ?? []).filter((r) => {
      if (!matchKeyword(r, str(p.keyword), ['userName', 'module', 'action', 'targetType'])) return false
      if (!matchEqual(r, p, ['module', 'action'])) return false
      return true
    })
    return paginate(rows, p)
  }
  if (url === '/audit/logins') {
    const rows = (fx.auditLogins?.list ?? []).filter((r) =>
      matchKeyword(r, str(p.keyword), ['username', 'ip']),
    )
    return paginate(rows, p)
  }

  /* ------------------------------------------------------ 报表 / 大屏配置 */
  if (url === '/reports/green-channel') return fx.report
  if (url === '/reports/kpi') return fx.kpi
  if (url === '/screen-configs') return fx.screenConfigs

  throw new Error(`静态演示未包含该接口：${verb} ${url}`)
}

/** 演示模式下导出接口：直接告知不可用 */
export function demoDownload(): never {
  ElMessage.warning('静态演示不提供文件导出，请在本地版导出 CSV / Excel')
  throw new Error('静态演示不提供文件导出')
}
