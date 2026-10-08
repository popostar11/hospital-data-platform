import * as bcrypt from 'bcryptjs'
import {
  CASE_STATUS,
  DEFAULT_HOSPITAL_NAME,
  DEFAULT_SYSTEM_NAME,
  DISEASE_SEEDS,
  EVENT_SEEDS,
  ROLE_PERMS,
  ROLE_SEEDS,
  SOURCE_TYPE,
  SOURCE_TYPE_SEEDS,
  CASE_STATUS_SEEDS,
  maskName,
} from '@hospital/shared'
import type { CaseStatusCode, DiseaseCode, SourceType } from '@hospital/shared'
import { encrypt } from '../common/crypto'
import { SCHEMA_SQL } from './schema'
import { formatDateTime, Db } from './sqlite'

/* =====================================================================
 * 种子数据生成器（**合成数据**）
 *
 * 脱敏声明：本文件中的所有数值与姓名均为**合成的演示数据**，
 * 不代表任何真实机构、真实患者或真实统计结果。
 *   - 近 12 个月柱状图：188 362 219 254 336 328 297 281 319 345 302 63
 *   - 累计饼图（创伤）：2380
 *   - 24 小时表格：陈*刚 / 李*博 / 王*涛 / 赵*兰 四行（版面与参考大屏一致）
 *   - 底部统计：总数 4（未闭环）
 *
 * 生成过程完全确定（固定随机种子），任何机器上结果一致、可回归比对。
 * 院内部署若要使用真实数据，请通过开放接口 / Excel 导入真实病例，
 * 并在后台「大屏配置」里把医院名称改成真实名称。
 * ===================================================================== */

/** 演示用 12 个月患者量（升序：最早 → 当月）。合成数据 */
export const MONTH_SERIES = [188, 362, 219, 254, 336, 328, 297, 281, 319, 345, 302, 63] as const
/** 演示用累计创伤患者数（饼图口径）。合成数据，大于 12 个月内创伤数，与柱状图自洽 */
export const CUMULATIVE_TRAUMA = 2380
/** 演示用 24 小时表格（顺序即在大屏上的展示顺序）。姓名均为虚构 */
export const FEATURED_CASES = [
  { fullName: '陈志刚', gender: 1, age: 60, disease: 'CHEST_PAIN', time: '10:55', source: 'PRE_HOSPITAL_120', distance: 2.12, status: 'FEEDBACK' },
  { fullName: '李文博', gender: 1, age: 13, disease: 'TRAUMA', time: '09:14', source: 'IN_HOSPITAL', distance: null, status: 'FINISHED' },
  { fullName: '王海涛', gender: 1, age: 40, disease: 'TRAUMA', time: '17:29', source: 'IN_HOSPITAL', distance: null, status: 'FINISHED' },
  { fullName: '赵秀兰', gender: 2, age: 88, disease: 'TRAUMA', time: '14:02', source: 'PRE_HOSPITAL_120', distance: null, status: 'FINISHED' },
] as const

/** 默认演示口令：所有内置账号共用，便于验收（生产必须改） */
export const DEMO_PASSWORD = 'Hospital@123'

export interface SeedUsers {
  admin: number
  erManager: number
  doctor: number
  nurse: number
}

export interface SeedSummary {
  departments: number
  roles: number
  users: number
  dicts: number
  patients: number
  cases: number
  events: number
  months: { month: string; value: number }[]
  traumaTotal: number
  openCount: number
}

/* ------------------------------------------------------------ 小工具 */

const pad = (n: number, l = 2) => String(n).padStart(l, '0')

/** 确定性伪随机（mulberry32），保证每次生成的数据完全一致 */
function mulberry32(seed: number) {
  let a = seed >>> 0
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const rand = mulberry32(20261008)
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)]!
const randInt = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1))

function daysInMonth(y: number, m: number): number {
  return new Date(y, m, 0).getDate()
}

function addMonths(y: number, m: number, delta: number): { y: number; m: number } {
  const total = y * 12 + (m - 1) + delta
  return { y: Math.floor(total / 12), m: (total % 12) + 1 }
}

function stamp(y: number, m: number, d: number, h: number, mi: number, s = 0): string {
  return `${y}-${pad(m)}-${pad(d)} ${pad(h)}:${pad(mi)}:${pad(s)}`
}

/* ------------------------------------------------------------- 姓名池 */

const SURNAMES = '王李张刘陈杨黄赵吴周徐孙马朱胡郭何高林罗郑梁谢宋唐许韩冯邓曹彭曾肖田董袁潘于蒋蔡余杜叶程苏魏吕丁任沈姚卢姜崔钟谭陆汪范金石廖贾夏韦付方白邹孟熊秦邱江尹薛段雷侯龙史陶黎贺顾毛郝龚邵万钱严覃武戴莫孔向汤'.split('')
const GIVEN_1 = '明华强伟芳娜敏静丽军磊洋勇艳杰娟涛超霞平刚勇鹏辉宇帆琳鑫瑞泽宇晨浩然'.split('')
const GIVEN_2 = ['秀英', '建国', '志强', '晓明', '文博', '雨欣', '佳怡', '子轩', '浩然', '梓涵', '俊杰', '丽华', '国强', '淑珍', '桂兰', '海燕', '春梅', '雅静', '培源', '振华']

function randomFullName(): string {
  const surname = pick(SURNAMES)
  // 三字名占比更高，贴近真实分布
  return rand() < 0.75 ? surname + pick(GIVEN_1) + pick(GIVEN_1) : surname + pick(GIVEN_2)
}

/* ------------------------------------------------------- 疾病月度分配 */

const DISEASE_WEIGHTS: [DiseaseCode, number][] = [
  ['TRAUMA', 0.38],
  ['CHEST_PAIN', 0.22],
  ['STROKE', 0.16],
  ['MATERNAL', 0.07],
  ['NEONATE', 0.05],
  ['POISONING', 0.05],
  ['OTHER', 0.07],
]

/** 按权重做最大余额法取整，保证各项之和恰好等于 total */
function allocate(total: number): Record<DiseaseCode, number> {
  const raws = DISEASE_WEIGHTS.map(([code, w]) => ({ code, raw: total * w }))
  const out = {} as Record<DiseaseCode, number>
  let used = 0
  const fractions: { code: DiseaseCode; frac: number }[] = []
  for (const r of raws) {
    const base = Math.floor(r.raw)
    out[r.code] = base
    used += base
    fractions.push({ code: r.code, frac: r.raw - base })
  }
  fractions.sort((a, b) => b.frac - a.frac)
  let rest = total - used
  for (let i = 0; rest > 0; i++, rest--) {
    out[fractions[i % fractions.length]!.code]++
  }
  return out
}

const DISEASE_DEPT: Record<string, string> = {
  TRAUMA: 'ER_TRAUMA',
  CHEST_PAIN: 'ER_CHEST',
  STROKE: 'ER_STROKE',
  MATERNAL: 'ER_INTERNAL',
  NEONATE: 'ER_INTERNAL',
  POISONING: 'ER_INTERNAL',
  OTHER: 'ER_INTERNAL',
}

/* ============================================================ 主流程 */

export function seed(db: Db, opts: { userCount?: number } = {}): SeedSummary {
  db.exec(SCHEMA_SQL)

  // 清空业务数据（保留结构），保证重复执行结果一致
  const tables = [
    'green_channel_case', 'case_event', 'case_attachment', 'patient', 'dict_item',
    'sys_oper_log', 'sys_login_log', 'login_attempt', 'integration_log',
    'open_api_idempotent', 'stat_daily', 'screen_config', 'user_role', 'sys_user',
    'role', 'department',
  ]
  db.tx(() => {
    for (const t of tables) db.exec(`DELETE FROM ${t}`)
    db.exec("DELETE FROM sqlite_sequence WHERE name IN ('green_channel_case','case_event','patient','dict_item','sys_user','department','role')")
  })

  const summary: SeedSummary = {
    departments: 0, roles: 0, users: 0, dicts: 0,
    patients: 0, cases: 0, events: 0, months: [], traumaTotal: 0, openCount: 0,
  }

  const now = new Date()
  const nowStr = formatDateTime(now)
  const todayStr = nowStr.slice(0, 10)
  const thisYear = now.getFullYear()
  const thisMonth = now.getMonth() + 1

  /* ---------------------------------------------------- 1. 组织 / 权限 */
  const deptDefs: { code: string; name: string; parent?: string; sort: number }[] = [
    { code: 'ER', name: '急诊医学科', sort: 1 },
    { code: 'ER_TRAUMA', name: '创伤中心', parent: 'ER', sort: 11 },
    { code: 'ER_CHEST', name: '胸痛中心', parent: 'ER', sort: 12 },
    { code: 'ER_STROKE', name: '卒中中心', parent: 'ER', sort: 13 },
    { code: 'ER_INTERNAL', name: '急诊内科', parent: 'ER', sort: 14 },
    { code: 'ER_SURGERY', name: '急诊外科', parent: 'ER', sort: 15 },
    { code: 'QC', name: '质控科', sort: 2 },
    { code: 'IT', name: '信息科', sort: 3 },
  ]
  const deptIds = new Map<string, number>()
  db.tx(() => {
    for (const d of deptDefs) {
      const id = db.insert('department', {
        parent_id: d.parent ? (deptIds.get(d.parent) ?? null) : null,
        code: d.code, name: d.name, sort_no: d.sort, enabled: 1,
        remark: null, created_at: nowStr,
      })
      deptIds.set(d.code, id)
    }
  })
  summary.departments = deptDefs.length

  const roleIds = new Map<string, number>()
  db.tx(() => {
    for (const r of ROLE_SEEDS) {
      const perms = ROLE_PERMS[r.code]
      const id = db.insert('role', {
        code: r.code, name: r.name,
        perms: JSON.stringify(perms === '*' ? ['*'] : perms),
        remark: r.remark, created_at: nowStr,
      })
      roleIds.set(r.code, id)
    }
  })
  summary.roles = ROLE_SEEDS.length

  const hash = bcrypt.hashSync(DEMO_PASSWORD, 10)
  const userDefs: { username: string; realName: string; role: string; dept: string }[] = [
    { username: 'admin', realName: '系统管理员', role: 'ADMIN', dept: 'IT' },
    { username: 'eradmin', realName: '李主任', role: 'ER_MANAGER', dept: 'ER' },
    { username: 'doctor01', realName: '王医生', role: 'ER_DOCTOR', dept: 'ER_TRAUMA' },
    { username: 'nurse01', realName: '张护士', role: 'ER_NURSE', dept: 'ER' },
    { username: 'qc01', realName: '刘质控', role: 'QC', dept: 'QC' },
    { username: 'leader01', realName: '陈院长', role: 'LEADER', dept: 'IT' },
    { username: 'screen', realName: '大屏账号', role: 'SCREEN', dept: 'IT' },
  ]
  const userIds = new Map<string, number>()
  db.tx(() => {
    for (const u of userDefs) {
      const id = db.insert('sys_user', {
        username: u.username, password_hash: hash, real_name: u.realName,
        dept_id: deptIds.get(u.dept) ?? null, enabled: 1, last_login_at: null,
        created_at: nowStr, updated_at: nowStr, deleted_at: null,
      })
      userIds.set(u.username, id)
      db.run('INSERT INTO user_role (user_id, role_id) VALUES (?, ?)', [id, roleIds.get(u.role)!])
    }
  })
  summary.users = userDefs.length

  /* ------------------------------------------------------------ 2. 字典 */
  const dictRows: { type: string; code: string; name: string; color: string | null; sort: number }[] = []
  for (const d of DISEASE_SEEDS) dictRows.push({ type: 'disease', code: d.code, name: d.name, color: d.color, sort: d.sortNo })
  for (const s of SOURCE_TYPE_SEEDS) dictRows.push({ type: 'sourceType', code: s.code, name: s.name, color: s.color ?? null, sort: s.sortNo })
  for (const s of CASE_STATUS_SEEDS) dictRows.push({ type: 'caseStatus', code: s.code, name: s.name, color: s.color ?? null, sort: s.sortNo })
  for (const e of EVENT_SEEDS) dictRows.push({ type: 'eventType', code: e.code, name: e.name, color: null, sort: e.sortNo })
  db.tx(() => {
    for (const d of dictRows) {
      db.insert('dict_item', {
        type: d.type, code: d.code, name: d.name, color: d.color,
        sort_no: d.sort, enabled: 1, remark: null, created_at: nowStr, updated_at: nowStr,
      })
    }
  })
  summary.dicts = dictRows.length

  /* -------------------------------------------------------- 3. 大屏配置 */
  db.insert('screen_config', {
    screen_code: 'main',
    hospital_name: DEFAULT_HOSPITAL_NAME,
    system_name: DEFAULT_SYSTEM_NAME,
    refresh_interval: 30,
    scroll_speed: 40,
    visible_rows: 4,
    mask_enabled: 1,
    pie_disease_code: 'TRAUMA',
    month_bar_mode: 'CREATED_AT',
    table_limit: 20,
    theme: 'blue',
    updated_at: nowStr,
    updated_by: userIds.get('admin')!,
  })

  /* ------------------------------------------- 4. 患者 / 病例 / 时间节点 */

  interface PlannedCase {
    disease: DiseaseCode
    createdAt: string
    source: SourceType
    status: CaseStatusCode
    isClosed: boolean
    distance: number | null
    /** true 表示 distance 按演示基线原样保留（不做随机补全），用于 4 条固定示例病例 */
    fixedDistance?: boolean
    gender: number
    age: number
    fullName: string
  }

  const plan: PlannedCase[] = []

  // 4.1 近 12 个月（升序），当月数据里先扣掉 4 条「固定示例」病例
  const months: { y: number; m: number; ym: string; value: number }[] = []
  for (let i = 11; i >= 0; i--) {
    const { y, m } = addMonths(thisYear, thisMonth, -i)
    months.push({ y, m, ym: `${y}-${pad(m)}`, value: MONTH_SERIES[11 - i]! })
  }
  summary.months = months.map((x) => ({ month: x.ym, value: x.value }))

  for (let idx = 0; idx < months.length; idx++) {
    const mo = months[idx]!
    const isCurrent = idx === months.length - 1
    const buckets = allocate(mo.value)
    let randomCount = mo.value
    if (isCurrent) {
      // 预留 4 条固定示例病例（3 创伤 + 1 胸痛）
      buckets.TRAUMA -= 3
      buckets.CHEST_PAIN -= 1
      randomCount -= 4
    }
    const maxDay = isCurrent ? Math.max(1, now.getDate() - 1) : daysInMonth(mo.y, mo.m)
    // 当月用例必须落在「24 小时窗口之外」，否则大屏表格会混入其它病例
    const monthStart = new Date(mo.y, mo.m - 1, 1, 0, 0, 0).getTime()
    const monthEnd = new Date(mo.y, mo.m - 1, daysInMonth(mo.y, mo.m), 23, 59, 59).getTime()
    let upperBound = monthEnd
    if (isCurrent) {
      upperBound = now.getTime() - 25 * 3600 * 1000
      // 极端情况（每月 1 日凌晨导入）：窗口不足一天，退化为当月起始
      if (upperBound <= monthStart) upperBound = now.getTime()
    }
    const span = Math.max(1, upperBound - monthStart)
    for (const [code, count] of Object.entries(buckets) as [DiseaseCode, number][]) {
      for (let i = 0; i < count; i++) {
        const day = randInt(1, maxDay)
        const ts = isCurrent ? formatDateTime(new Date(monthStart + Math.floor(rand() * span))) : stamp(mo.y, mo.m, day, randInt(0, 23), randInt(0, 59), randInt(0, 59))
        plan.push({
          disease: code,
          createdAt: ts,
          source: rand() < 0.42 ? SOURCE_TYPE.PRE_HOSPITAL_120 : SOURCE_TYPE.IN_HOSPITAL,
          status: CASE_STATUS.CLOSED,
          isClosed: true,
          distance: null,
          gender: rand() < 0.55 ? 1 : 2,
          age: randInt(3, 95),
          fullName: randomFullName(),
        })
      }
    }
    void randomCount
  }

  // 4.2 4 条固定示例病例（今天，时间固定，且都是未闭环）
  for (const f of FEATURED_CASES) {
    const [hh, mm] = f.time.split(':').map(Number)
    plan.push({
      disease: f.disease as DiseaseCode,
      createdAt: `${todayStr} ${pad(hh!)}:${pad(mm!)}:00`,
      source: f.source as SourceType,
      status: f.status as CaseStatusCode,
      isClosed: false,
      distance: f.distance,
      fixedDistance: true,
      gender: f.gender,
      age: f.age,
      fullName: f.fullName,
    })
  }

  // 4.3 回溯历史：保证创伤累计恰好等于 CUMULATIVE_TRAUMA
  const traumaInWindow = plan.filter((p) => p.disease === 'TRAUMA').length
  const traumaHistory = CUMULATIVE_TRAUMA - traumaInWindow
  if (traumaHistory < 0) {
    throw new Error(`种子配置有误：12 个月内创伤数 ${traumaInWindow} 已超过累计目标 ${CUMULATIVE_TRAUMA}`)
  }
  const pushHistory = (disease: DiseaseCode, count: number) => {
    for (let i = 0; i < count; i++) {
      const back = randInt(1, 18)
      const { y, m } = addMonths(thisYear, thisMonth, -(12 + back))
      const day = randInt(1, daysInMonth(y, m))
      plan.push({
        disease,
        createdAt: stamp(y, m, day, randInt(0, 23), randInt(0, 59), randInt(0, 59)),
        source: rand() < 0.4 ? SOURCE_TYPE.PRE_HOSPITAL_120 : SOURCE_TYPE.IN_HOSPITAL,
        status: CASE_STATUS.CLOSED,
        isClosed: true,
        distance: null,
        gender: rand() < 0.55 ? 1 : 2,
        age: randInt(3, 95),
        fullName: randomFullName(),
      })
    }
  }
  pushHistory('TRAUMA', traumaHistory)
  // 其他病种也补一部分历史，避免「全部疾病」口径下饼图只有单病种
  const windowByDisease = new Map<DiseaseCode, number>()
  for (const p of plan) windowByDisease.set(p.disease, (windowByDisease.get(p.disease) ?? 0) + 1)
  pushHistory('CHEST_PAIN', Math.round((windowByDisease.get('CHEST_PAIN') ?? 0) * 0.45))
  pushHistory('STROKE', Math.round((windowByDisease.get('STROKE') ?? 0) * 0.35))
  pushHistory('MATERNAL', Math.round((windowByDisease.get('MATERNAL') ?? 0) * 0.2))
  pushHistory('NEONATE', Math.round((windowByDisease.get('NEONATE') ?? 0) * 0.2))
  pushHistory('POISONING', Math.round((windowByDisease.get('POISONING') ?? 0) * 0.2))
  pushHistory('OTHER', Math.round((windowByDisease.get('OTHER') ?? 0) * 0.2))

  // 4.4 落库
  const doctorId = userIds.get('doctor01')!
  const nurseId = userIds.get('nurse01')!
  const diseaseIds = new Map<string, number>()
  let caseSeq = 0
  let patientSeq = 0

  db.tx(() => {
    for (const p of plan) {
      patientSeq++
      const birthYear = now.getFullYear() - p.age
      const patientId = db.insert('patient', {
        mrn: `MRN${String(patientSeq).padStart(7, '0')}`,
        name_cipher: encrypt(p.fullName)!,
        name_masked: maskName(p.fullName),
        gender: p.gender,
        birth_date: `${birthYear}-01-01`,
        id_card_cipher: encrypt(`4401${pad(randInt(1, 12))}${randInt(1960, 2020)}${randInt(1000, 9999)}`)!,
        id_card_masked: `4${'*'.repeat(15)}${randInt(0, 9)}`,
        phone_cipher: encrypt(`13${randInt(100000000, 999999999)}`)!,
        phone_masked: `138****${randInt(1000, 9999)}`,
        remark: null,
        created_at: p.createdAt,
        updated_at: p.createdAt,
        deleted_at: null,
      })
      caseSeq++
      const d = new Date(p.createdAt.replace(' ', 'T'))
      const closedAt = p.isClosed ? formatDateTime(new Date(d.getTime() + randInt(60, 300) * 60000)) : null
      const caseId = db.insert('green_channel_case', {
        case_no: `LD${p.createdAt.slice(0, 10).replace(/-/g, '')}${String(caseSeq).padStart(4, '0')}`,
        patient_id: patientId,
        dept_id: deptIds.get(DISEASE_DEPT[p.disease] ?? 'ER') ?? null,
        disease_code: p.disease,
        source_type: p.source,
        status_code: p.status,
        distance_km: p.fixedDistance ? p.distance : (p.distance ?? (p.source === SOURCE_TYPE.PRE_HOSPITAL_120 ? Math.round(rand() * 1800) / 100 : null)),
        onset_at: formatDateTime(new Date(d.getTime() - randInt(10, 120) * 60000)),
        arrive_at: formatDateTime(new Date(d.getTime() + (p.source === SOURCE_TYPE.PRE_HOSPITAL_120 ? 12 : 3) * 60000)),
        created_at: p.createdAt,
        updated_at: closedAt ?? p.createdAt,
        closed_at: closedAt,
        is_closed: p.isClosed ? 1 : 0,
        creator_id: rand() < 0.5 ? doctorId : nurseId,
        remark: null,
        deleted_at: null,
      })
      diseaseIds.set(p.disease, (diseaseIds.get(p.disease) ?? 0) + 1)

      // 时间节点：院前 120 有出车/到场，院内创建只有分诊/首诊
      const base = d.getTime()
      const at = (minutes: number) => formatDateTime(new Date(base + minutes * 60000))
      const events: { code: string; minutes: number }[] =
        p.source === SOURCE_TYPE.PRE_HOSPITAL_120
          ? [
              { code: 'CALL', minutes: -45 },
              { code: 'DISPATCH', minutes: -42 },
              { code: 'ARRIVE_SCENE', minutes: -20 },
              { code: 'LEAVE_SCENE', minutes: -5 },
              { code: 'ARRIVE_HOSPITAL', minutes: 12 },
              { code: 'TRIAGE', minutes: 15 },
              { code: 'FIRST_CONTACT', minutes: 18 },
            ]
          : [
              { code: 'CALL', minutes: 0 },
              { code: 'TRIAGE', minutes: 3 },
              { code: 'FIRST_CONTACT', minutes: 6 },
            ]
      // 胸痛/卒中补 CT 节点，让 DNT（到院→CT）质控指标有真实数据
      if (p.disease === 'CHEST_PAIN' || p.disease === 'STROKE') {
        events.push({ code: 'CT', minutes: 30 })
      }
      for (const e of events) {
        db.run(
          `INSERT OR IGNORE INTO case_event (case_id, event_code, event_at, operator_id, remark, created_at)
           VALUES (?, ?, ?, ?, NULL, ?)`,
          [caseId, e.code, at(e.minutes), doctorId, p.createdAt],
        )
      }
      if (p.isClosed) {
        db.run(
          `INSERT OR IGNORE INTO case_event (case_id, event_code, event_at, operator_id, remark, created_at)
           VALUES (?, 'FINISH', ?, ?, NULL, ?)`,
          [caseId, closedAt!, doctorId, p.createdAt],
        )
      }
    }
  })

  summary.patients = patientSeq
  summary.cases = caseSeq

  /* ------------------------------------------------------ 5. 统计快照 */
  db.tx(() => {
    db.run(
      `INSERT OR REPLACE INTO stat_daily (stat_date, disease_code, case_count, closed_count, open_count, avg_response_min, overtime_count)
       SELECT substr(created_at,1,10), 'ALL', COUNT(*), SUM(is_closed), SUM(CASE WHEN is_closed = 0 THEN 1 ELSE 0 END), NULL, 0
         FROM green_channel_case WHERE deleted_at IS NULL
        GROUP BY substr(created_at,1,10)`,
    )
    db.run(
      `INSERT OR REPLACE INTO stat_daily (stat_date, disease_code, case_count, closed_count, open_count, avg_response_min, overtime_count)
       SELECT substr(created_at,1,10), disease_code, COUNT(*), SUM(is_closed), SUM(CASE WHEN is_closed = 0 THEN 1 ELSE 0 END), NULL, 0
         FROM green_channel_case WHERE deleted_at IS NULL
        GROUP BY substr(created_at,1,10), disease_code`,
    )
  })

  /* ---------------------------------------------------- 6. 日志与对接 */
  db.tx(() => {
    db.insert('sys_oper_log', {
      user_id: userIds.get('admin')!, user_name: 'admin', module: 'screen-config', action: 'UPDATE',
      target_type: 'screen_config', target_id: 'main',
      detail: JSON.stringify({ note: '初始化大屏配置' }), ip: '10.20.30.41', ua: 'Mozilla/5.0',
      created_at: nowStr,
    })
    db.insert('sys_login_log', {
      username: 'admin', success: 1, message: '登录成功', ip: '10.20.30.41', user_agent: 'Mozilla/5.0', created_at: nowStr,
    })
    db.insert('integration_log', {
      source: 'HIS', direction: 'IN', endpoint: '/open/cases', biz_id: 'LD-SEED-001',
      success: 1, message: '同步成功', payload: JSON.stringify({ note: '示例同步记录' }), created_at: nowStr,
    })
  })

  summary.events = db.scalar<number>('SELECT COUNT(*) FROM case_event') ?? 0
  summary.traumaTotal = db.scalar<number>("SELECT COUNT(*) FROM green_channel_case WHERE disease_code = 'TRAUMA' AND deleted_at IS NULL") ?? 0
  summary.openCount = db.scalar<number>('SELECT COUNT(*) FROM green_channel_case WHERE is_closed = 0 AND deleted_at IS NULL') ?? 0
  void opts
  return summary
}

/** CLI 入口：pnpm db:seed */
export function runSeedCli(): void {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { config } = require('../config') as typeof import('../config')
  const db = new Db(config.dbFile)
  const started = Date.now()
  const result = seed(db)
  db.close()
  /* eslint-disable no-console */
  console.log('种子数据导入完成：')
  console.log(`  科室 ${result.departments} / 角色 ${result.roles} / 用户 ${result.users} / 字典项 ${result.dicts}`)
  console.log(`  患者 ${result.patients} / 病例 ${result.cases} / 时间节点 ${result.events}`)
  console.log(`  创伤累计 ${result.traumaTotal}（演示基线 ${CUMULATIVE_TRAUMA}）｜未闭环 ${result.openCount}`)
  console.log(`  近 12 个月：${result.months.map((m) => `${m.month}=${m.value}`).join(' ')}`)
  console.log(`  默认口令：${DEMO_PASSWORD}（账号 admin / eradmin / doctor01 / nurse01 / qc01 / leader01 / screen）`)
  console.log(`  耗时 ${Date.now() - started}ms ｜ 数据库：${config.dbFile}`)
  /* eslint-enable no-console */
}

if (require.main === module) {
  runSeedCli()
}
