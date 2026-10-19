/**
 * 前后端共享 DTO。服务端与两个前端都从这里取类型，避免接口漂移。
 */
import type { CaseStatusCode, DiseaseCode, EventCode, GenderCode, PermCode, RoleCode, SourceType } from './enums.js'
import type { Paginated } from './errors.js'

/* ==================================================================== 通用 */

export interface TimeRangeQuery {
  /** YYYY-MM-DD */
  from?: string
  to?: string
}

export interface PageQuery {
  page?: number
  pageSize?: number
  /** 形如 created_at:desc */
  sort?: string
}

/* ============================================================== 大屏可视化 */

export interface ScreenHeader {
  /** 医院名称（由大屏配置下发，演示环境为占位名称） */
  hospitalName: string
  /** 动态速览 */
  systemName: string
  /** 服务端时间 YYYY-MM-DD HH:mm:ss */
  serverTime: string
  /** 数据生成时间 YYYY-MM-DD HH:mm:ss */
  generatedAt: string
  /** 数据是否来自缓存（降级提示用） */
  stale: boolean
}

export interface ScreenPieItem {
  code: string
  name: string
  value: number
  color: string
}

export interface ScreenPie {
  title: string
  /** 圆心文案，固定「累计」 */
  centerLabel: string
  total: number
  items: ScreenPieItem[]
}

export interface ScreenBarMonth {
  /** x 轴标签，两位月份，如 "10" */
  label: string
  /** YYYY-MM */
  month: string
  value: number
  color: string
  /** 当月未满月，前端显示「本月至今」 */
  partial: boolean
}

export interface ScreenBar {
  title: string
  unit: string
  yMax: number
  months: ScreenBarMonth[]
}

export interface ScreenTableColumn {
  key: string
  label: string
  width?: number
  align?: 'left' | 'center' | 'right'
}

export interface ScreenTableRow {
  id: number
  caseNo: string
  /** 已脱敏姓名，如 张*明 */
  name: string
  gender: string
  age: number | null
  diseaseCode: string
  diseaseName: string
  diseaseColor: string
  /** MM-DD HH:mm */
  time: string
  createdAt: string
  sourceType: SourceType
  sourceTypeName: string
  /** 距离文案，如 "2.12 km"，无值返回 null */
  distance: string | null
  statusCode: CaseStatusCode
  statusName: string
  statusColor: string
}

export interface ScreenTable {
  title: string
  columns: ScreenTableColumn[]
  rows: ScreenTableRow[]
  /** 命中 24 小时窗口的总条数（可能大于 rows.length） */
  total: number
}

export interface ScreenFooterItem {
  code: string
  name: string
  value: number
  color: string
}

export interface ScreenFooter {
  label: string
  total: number
  items: ScreenFooterItem[]
}

export interface ScreenRuntimeConfig {
  /** 轮询兜底间隔（秒） */
  refreshInterval: number
  /** 表格滚动速度 px/s */
  scrollSpeed: number
  /** 表格可见行数 */
  visibleRows: number
  /** 是否开启脱敏（关闭仅对授权账号生效） */
  maskEnabled: boolean
  theme: string
}

/** 大屏首屏一次性返回整屏数据（方案 §6.2） */
export interface ScreenBootstrap {
  header: ScreenHeader
  pie: ScreenPie
  bar: ScreenBar
  table: ScreenTable
  footer: ScreenFooter
  config: ScreenRuntimeConfig
}

/** SSE 事件 */
export type ScreenStreamEvent =
  | { type: 'case.created'; caseId: number; at: string }
  | { type: 'case.updated'; caseId: number; at: string }
  | { type: 'stats.changed'; at: string }
  | { type: 'ping'; at: string }

/* ================================================================== 认证 */

export interface LoginRequest {
  username: string
  password: string
  captchaId?: string
  captchaCode?: string
}

export interface UserInfo {
  id: number
  username: string
  realName: string
  deptId: number | null
  deptName: string | null
  roles: { code: RoleCode; name: string }[]
  perms: PermCode[]
}

export interface LoginResponse {
  accessToken: string
  refreshToken: string
  expiresIn: number
  user: UserInfo
}

/* ================================================================== 患者 */

export interface PatientListItem {
  id: number
  mrn: string | null
  nameMasked: string
  gender: GenderCode
  genderName: string
  age: number | null
  phoneMasked: string | null
  idCardMasked: string | null
  visitCount: number
  createdAt: string
  /** 患者备注（列表直接展示，明细里同名字段） */
  remark: string | null
  /* ---- 以下为「最近一条绿道病例」的拍平字段，供患者管理列表直接展示 ----
     没有病例的患者这些字段全为 null，不影响患者表单、远程搜索等既有用途 */
  lastCaseId: number | null
  lastCaseNo: string | null
  diseaseCode: string | null
  diseaseName: string | null
  diseaseColor: string | null
  sourceType: string | null
  sourceTypeName: string | null
  sourceColor: string | null
  statusCode: string | null
  statusName: string | null
  statusColor: string | null
  /** 最近一次就诊（病例创建）时间 */
  lastVisitAt: string | null
}

/** 患者列表查询条件：除关键字外，支持按「最近一条病例」的疾病 / 状态 / 推送方式筛选 */
export interface PatientListQuery extends PageQuery {
  keyword?: string
  diseaseCode?: string
  statusCode?: string
  sourceType?: string
}

/** 批量导入的一行（前端把 CSV 解析成这个结构提交；性别可传中文「男/女」） */
export interface PatientImportRow {
  name: string
  gender?: GenderCode | string
  birthDate?: string | null
  mrn?: string | null
  idCard?: string | null
  phone?: string | null
  remark?: string | null
}

export interface PatientImportResult {
  total: number
  created: number
  skipped: number
  errors: { row: number; message: string }[]
}

export interface PatientDetail extends PatientListItem {
  birthDate: string | null
}

/** 明文查看（需 patient:plain 权限，且写审计日志） */
export interface PatientPlain {
  id: number
  name: string
  idCard: string | null
  phone: string | null
}

export interface PatientSaveRequest {
  name: string
  gender: GenderCode
  birthDate?: string | null
  mrn?: string | null
  idCard?: string | null
  phone?: string | null
  remark?: string | null
}

/* ============================================================== 绿道病例 */

export interface CaseEventItem {
  id: number
  eventCode: EventCode
  eventName: string
  eventAt: string
  operatorName: string | null
  remark: string | null
  /** 与上一节点的间隔（分钟） */
  gapMinutes: number | null
  /** 是否超出该节点的质控时限 */
  overtime: boolean
}

export interface CaseListItem {
  id: number
  caseNo: string
  patientId: number
  patientName: string
  genderName: string
  age: number | null
  diseaseCode: DiseaseCode
  diseaseName: string
  diseaseColor: string
  sourceType: SourceType
  sourceTypeName: string
  statusCode: CaseStatusCode
  statusName: string
  statusColor: string
  distanceKm: number | null
  deptId: number | null
  deptName: string | null
  isClosed: boolean
  closedAt: string | null
  createdAt: string
  updatedAt: string
  remark: string | null
}

export interface CaseDetail extends CaseListItem {
  patient: PatientListItem
  events: CaseEventItem[]
  /** 呼救→到院 总时长（分钟） */
  responseMinutes: number | null
  attachments: { id: number; fileName: string; fileSize: number; url: string; uploadedAt: string }[]
}

export interface CaseQuery extends PageQuery, TimeRangeQuery {
  keyword?: string
  diseaseCode?: string
  sourceType?: string
  statusCode?: string
  deptId?: number
  isClosed?: boolean
}

export interface CaseSaveRequest {
  patientId?: number
  patient?: PatientSaveRequest
  diseaseCode: DiseaseCode
  sourceType: SourceType
  statusCode?: CaseStatusCode
  deptId?: number | null
  distanceKm?: number | null
  onsetAt?: string | null
  createdAt?: string | null
  remark?: string | null
}

export interface CaseEventSaveRequest {
  eventCode: EventCode
  eventAt: string
  remark?: string | null
}

export interface CaseCloseRequest {
  closedAt?: string
  remark?: string
}

/* ================================================================== 字典 */

export type DictType = 'disease' | 'sourceType' | 'caseStatus' | 'eventType' | 'department'

export interface DictItem {
  id: number
  type: string
  code: string
  name: string
  color: string | null
  sortNo: number
  enabled: boolean
  /** 该字典项被引用次数（删除前提示） */
  refCount?: number
  remark: string | null
}

export interface DictSaveRequest {
  type: string
  code: string
  name: string
  color?: string | null
  sortNo?: number
  enabled?: boolean
  remark?: string | null
}

/* ================================================================ 组织人员 */

export interface DepartmentNode {
  id: number
  parentId: number | null
  code: string
  name: string
  sortNo: number
  enabled: boolean
  children?: DepartmentNode[]
}

export interface UserListItem {
  id: number
  username: string
  realName: string
  deptId: number | null
  deptName: string | null
  roles: { code: RoleCode; name: string }[]
  enabled: boolean
  lastLoginAt: string | null
  createdAt: string
}

export interface UserSaveRequest {
  username: string
  password?: string
  realName: string
  deptId?: number | null
  roleCodes: RoleCode[]
  enabled?: boolean
}

/* ============================================================== 大屏配置 */

export interface ScreenConfigItem {
  id: number
  screenCode: string
  hospitalName: string
  systemName: string
  refreshInterval: number
  scrollSpeed: number
  visibleRows: number
  maskEnabled: boolean
  /** 饼图聚焦的疾病，null=全部疾病 */
  pieDiseaseCode: string | null
  /** 12 个月柱状图统计依据：创建时间 / 到院时间 */
  monthBarMode: 'CREATED_AT' | 'ARRIVE_AT'
  theme: string
  updatedAt: string
}

export type ScreenConfigSaveRequest = Partial<Omit<ScreenConfigItem, 'id' | 'updatedAt'>> & { screenCode: string }

/* ================================================================== 报表 */

export interface ReportBucket {
  key: string
  label: string
  total: number
  closed: number
  openCount: number
  avgResponseMinutes: number | null
  overtimeCount: number
}

export interface ReportResult {
  groupBy: 'day' | 'month' | 'dept' | 'disease' | 'source'
  from: string
  to: string
  buckets: ReportBucket[]
  summary: {
    total: number
    closed: number
    openCount: number
    closedRate: number
    avgResponseMinutes: number | null
    overtimeRate: number | null
  }
}

export interface KpiResult {
  from: string
  to: string
  avgResponseMinutes: number | null
  avgTriageMinutes: number | null
  avgDntMinutes: number | null
  closedRate: number | null
  overtimeRate: number | null
  byDisease: { diseaseCode: string; diseaseName: string; avgResponseMinutes: number | null; total: number }[]
}

/* ================================================================== 审计 */

export interface AuditLogItem {
  id: number
  userId: number | null
  userName: string | null
  module: string
  action: string
  targetType: string | null
  targetId: string | null
  detail: string | null
  ip: string | null
  createdAt: string
}

export interface LoginLogItem {
  id: number
  username: string
  success: boolean
  message: string | null
  ip: string | null
  userAgent: string | null
  createdAt: string
}

/* =============================================================== 工作台 */

export interface DashboardOverview {
  todayTotal: number
  todayClosed: number
  openCount: number
  overtimeCount: number
  yesterdayTotal: number
  /** 近 7 日趋势 */
  trend: { date: string; label: string; total: number; closed: number }[]
  byDisease: { code: string; name: string; color: string; total: number }[]
  latest: CaseListItem[]
}
