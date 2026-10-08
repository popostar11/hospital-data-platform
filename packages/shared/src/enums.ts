/**
 * 全局枚举与字典默认值。
 *
 * 约定：数据库中的字典表是运行时事实来源（可在后台维护），
 * 这里的常量只用于「种子初始值」与编译期类型约束。
 * 后端对外一律返回 code，中文文案由前端 i18n / 字典接口提供。
 */

/**
 * 演示环境默认值。
 *
 * 脱敏约定：仓库内**不得出现任何真实机构名称、地名、真实患者信息与真实统计数值**。
 * 这里的默认名称只是占位，实际显示以 `screen_config`（后台「大屏配置」）为准，
 * 院内部署时改成真实名称即可，无需改代码。
 */
export const DEFAULT_HOSPITAL_NAME = '示例市第二人民医院'
export const DEFAULT_SYSTEM_NAME = '动态速览'

/* ------------------------------------------------------------------ 疾病 */
export const DISEASE = {
  TRAUMA: 'TRAUMA',
  CHEST_PAIN: 'CHEST_PAIN',
  STROKE: 'STROKE',
  MATERNAL: 'MATERNAL',
  NEONATE: 'NEONATE',
  POISONING: 'POISONING',
  OTHER: 'OTHER',
} as const
export type DiseaseCode = (typeof DISEASE)[keyof typeof DISEASE]

export interface DiseaseSeed {
  code: DiseaseCode
  name: string
  /** 主题色：大屏饼图 / 柱状图 / 表格标签统一取色 */
  color: string
  shortName: string
  sortNo: number
}

export const DISEASE_SEEDS: DiseaseSeed[] = [
  { code: 'TRAUMA', name: '创伤', color: '#3FA9FF', shortName: '创伤', sortNo: 1 },
  { code: 'CHEST_PAIN', name: '胸痛', color: '#7C6BFF', shortName: '胸痛', sortNo: 2 },
  { code: 'STROKE', name: '卒中', color: '#22D3A6', shortName: '卒中', sortNo: 3 },
  { code: 'MATERNAL', name: '危重孕产妇', color: '#FF7A8A', shortName: '孕产妇', sortNo: 4 },
  { code: 'NEONATE', name: '危重新生儿', color: '#F5A623', shortName: '新生儿', sortNo: 5 },
  { code: 'POISONING', name: '中毒', color: '#A96BFF', shortName: '中毒', sortNo: 6 },
  { code: 'OTHER', name: '其他', color: '#8FA9C9', shortName: '其他', sortNo: 99 },
]

/* -------------------------------------------------------------- 推送方式 */
export const SOURCE_TYPE = {
  /** 院前 120 转运 */
  PRE_HOSPITAL_120: 'PRE_HOSPITAL_120',
  /** 院内创建 */
  IN_HOSPITAL: 'IN_HOSPITAL',
  /** 外院转入 */
  TRANSFER: 'TRANSFER',
  /** 其他 */
  OTHER: 'OTHER',
} as const
export type SourceType = (typeof SOURCE_TYPE)[keyof typeof SOURCE_TYPE]

export interface DictSeed {
  code: string
  name: string
  color?: string
  sortNo: number
}

export const SOURCE_TYPE_SEEDS: DictSeed[] = [
  { code: 'PRE_HOSPITAL_120', name: '院前120', color: '#3FA9FF', sortNo: 1 },
  { code: 'IN_HOSPITAL', name: '院内创建', color: '#22D3A6', sortNo: 2 },
  { code: 'TRANSFER', name: '外院转入', color: '#F5A623', sortNo: 3 },
  { code: 'OTHER', name: '其他', color: '#8FA9C9', sortNo: 9 },
]

/* ------------------------------------------------------------ 病例状态 */
export const CASE_STATUS = {
  /** 院内创建 */
  CREATED: 'CREATED',
  /** 已到院 */
  ARRIVED: 'ARRIVED',
  /** 已反馈 */
  FEEDBACK: 'FEEDBACK',
  /** 完成急救 */
  FINISHED: 'FINISHED',
  /** 已闭环（质控完成） */
  CLOSED: 'CLOSED',
  /** 已作废 */
  CANCELED: 'CANCELED',
} as const
export type CaseStatusCode = (typeof CASE_STATUS)[keyof typeof CASE_STATUS]

export const CASE_STATUS_SEEDS: DictSeed[] = [
  { code: 'CREATED', name: '院内创建', color: '#18C8FF', sortNo: 1 },
  { code: 'ARRIVED', name: '已到院', color: '#4FA8FF', sortNo: 2 },
  { code: 'FEEDBACK', name: '已反馈', color: '#22D3A6', sortNo: 3 },
  { code: 'FINISHED', name: '完成急救', color: '#3FE0B0', sortNo: 4 },
  { code: 'CLOSED', name: '已闭环', color: '#8FA9C9', sortNo: 5 },
  { code: 'CANCELED', name: '已作废', color: '#FF7A8A', sortNo: 9 },
]

/** 已闭环 / 已作废 视为「不在绿道中」 */
export const CLOSED_STATUSES: CaseStatusCode[] = ['CLOSED', 'CANCELED']

/* ------------------------------------------------------------ 时间节点 */
export const EVENT_CODE = {
  CALL: 'CALL',
  DISPATCH: 'DISPATCH',
  ARRIVE_SCENE: 'ARRIVE_SCENE',
  LEAVE_SCENE: 'LEAVE_SCENE',
  ARRIVE_HOSPITAL: 'ARRIVE_HOSPITAL',
  TRIAGE: 'TRIAGE',
  FIRST_CONTACT: 'FIRST_CONTACT',
  CT: 'CT',
  FINISH: 'FINISH',
} as const
export type EventCode = (typeof EVENT_CODE)[keyof typeof EVENT_CODE]

export interface EventSeed {
  code: EventCode
  name: string
  /** 相对上一节点的质控时限（分钟），超时在时间轴上标红 */
  limitMinutes: number | null
  sortNo: number
}

export const EVENT_SEEDS: EventSeed[] = [
  { code: 'CALL', name: '呼救', limitMinutes: null, sortNo: 1 },
  { code: 'DISPATCH', name: '出车', limitMinutes: 3, sortNo: 2 },
  { code: 'ARRIVE_SCENE', name: '到达现场', limitMinutes: 15, sortNo: 3 },
  { code: 'LEAVE_SCENE', name: '离开现场', limitMinutes: 30, sortNo: 4 },
  { code: 'ARRIVE_HOSPITAL', name: '到达医院', limitMinutes: 60, sortNo: 5 },
  { code: 'TRIAGE', name: '预检分诊', limitMinutes: 5, sortNo: 6 },
  { code: 'FIRST_CONTACT', name: '首次医疗接触', limitMinutes: 5, sortNo: 7 },
  { code: 'CT', name: '完成CT', limitMinutes: 30, sortNo: 8 },
  { code: 'FINISH', name: '完成急救', limitMinutes: null, sortNo: 9 },
]

/* ---------------------------------------------------------------- 性别 */
export const GENDER = { MALE: 1, FEMALE: 2, UNKNOWN: 9 } as const
export type GenderCode = (typeof GENDER)[keyof typeof GENDER]

export const GENDER_LABELS: Record<number, string> = { 1: '男', 2: '女', 9: '未知' }

/* ------------------------------------------------------------ 大屏配色 */
/** 12 根柱的循环配色板（从素材照片取样） */
export const BAR_PALETTE = [
  '#F5C542', '#3E8BFF', '#35D0A5', '#FF7A8A', '#F5A623', '#3FD8D0',
  '#FF5FD2', '#4FA8FF', '#FFD84D', '#35C6E8', '#A96BFF', '#F5C542',
] as const

export const PIE_GRADIENT = ['#FFE07A', '#FF9BB3'] as const

/* ---------------------------------------------------------- 系统与权限 */
export const ROLE_CODE = {
  ADMIN: 'ADMIN',
  ER_MANAGER: 'ER_MANAGER',
  ER_DOCTOR: 'ER_DOCTOR',
  ER_NURSE: 'ER_NURSE',
  QC: 'QC',
  LEADER: 'LEADER',
  SCREEN: 'SCREEN',
} as const
export type RoleCode = (typeof ROLE_CODE)[keyof typeof ROLE_CODE]

export const ROLE_SEEDS: { code: RoleCode; name: string; remark: string }[] = [
  { code: 'ADMIN', name: '系统管理员', remark: '全部权限，含用户与字典维护' },
  { code: 'ER_MANAGER', name: '急诊科管理员', remark: '本病区病例全量管理、报表与导出' },
  { code: 'ER_DOCTOR', name: '急诊医生', remark: '病例录入、编辑、补录时间节点' },
  { code: 'ER_NURSE', name: '急诊护士', remark: '病例录入与查看' },
  { code: 'QC', name: '质控员', remark: '全量只读 + 报表 + 质控指标' },
  { code: 'LEADER', name: '院领导', remark: '全院只读 + 报表' },
  { code: 'SCREEN', name: '大屏账号', remark: '仅可访问大屏只读接口' },
]

/** 权限点：module:action */
export const PERM = {
  CASE_VIEW: 'case:view',
  CASE_CREATE: 'case:create',
  CASE_UPDATE: 'case:update',
  CASE_DELETE: 'case:delete',
  CASE_EXPORT: 'case:export',
  CASE_EVENT: 'case:event',
  PATIENT_VIEW: 'patient:view',
  PATIENT_PLAIN: 'patient:plain',
  PATIENT_UPDATE: 'patient:update',
  DICT_VIEW: 'dict:view',
  DICT_UPDATE: 'dict:update',
  ORG_VIEW: 'org:view',
  ORG_UPDATE: 'org:update',
  REPORT_VIEW: 'report:view',
  REPORT_EXPORT: 'report:export',
  SCREEN_CONFIG_VIEW: 'screen-config:view',
  SCREEN_CONFIG_UPDATE: 'screen-config:update',
  AUDIT_VIEW: 'audit:view',
  INTEGRATION_VIEW: 'integration:view',
} as const
export type PermCode = (typeof PERM)[keyof typeof PERM]

export const ALL_PERMS: PermCode[] = Object.values(PERM)

/** 各角色默认权限点（种子用；数据库中可再调整） */
export const ROLE_PERMS: Record<RoleCode, PermCode[] | '*'> = {
  ADMIN: '*',
  ER_MANAGER: [
    'case:view', 'case:create', 'case:update', 'case:delete', 'case:export', 'case:event',
    'patient:view', 'patient:update', 'dict:view',
    'org:view', 'report:view', 'report:export',
    'screen-config:view', 'screen-config:update', 'audit:view', 'integration:view',
  ],
  ER_DOCTOR: [
    'case:view', 'case:create', 'case:update', 'case:event',
    'patient:view', 'patient:update', 'dict:view', 'report:view', 'screen-config:view',
  ],
  ER_NURSE: [
    'case:view', 'case:create', 'case:event', 'patient:view', 'dict:view', 'screen-config:view',
  ],
  QC: [
    'case:view', 'case:export', 'patient:view', 'dict:view',
    'report:view', 'report:export', 'screen-config:view', 'audit:view',
  ],
  LEADER: ['case:view', 'report:view', 'report:export', 'screen-config:view'],
  SCREEN: [],
}
