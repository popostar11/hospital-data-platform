import { Injectable, Logger } from '@nestjs/common'
import {
  BAR_PALETTE,
  DEFAULT_HOSPITAL_NAME,
  DEFAULT_SYSTEM_NAME,
  formatDate,
  formatMonthDayMinute,
  formatDistance,
  recentMonths,
  type CaseListItem,
  type ScreenBar,
  type ScreenBarMonth,
  type ScreenBootstrap,
  type ScreenConfigItem,
  type ScreenFooter,
  type ScreenPie,
  type ScreenRuntimeConfig,
  type ScreenTable,
  type ScreenTableColumn,
  type ScreenTableRow,
} from '@hospital/shared'
import { InjectDb } from '../../db/db.module'
import { now, v, type Db, type SqlValue } from '../../db/sqlite'
import { ApiException } from '../../common/api'
import { optionalBool, optionalString, requiredNumber, requiredString } from '../../common/validate'
import { config as appConfig } from '../../config'
import { DictService } from '../dict/dict.service'
import { CaseService } from '../case/case.service'
import { DomainEvents } from '../../core/events.service'

interface ScreenConfigRow {
  id: number
  screenCode: string
  hospitalName: string
  systemName: string
  refreshInterval: number
  scrollSpeed: number
  visibleRows: number
  maskEnabled: number
  pieDiseaseCode: string | null
  monthBarMode: string
  tableLimit: number
  theme: string
  updatedAt: string
}

/** 大屏表格列定义（列顺序与参考大屏一致：姓名/性别/年龄/疾病/时间/推送方式/距离/状态） */
const SCREEN_COLUMNS: ScreenTableColumn[] = [
  { key: 'name', label: '姓名', width: 12, align: 'left' },
  { key: 'gender', label: '性别', width: 8, align: 'center' },
  { key: 'age', label: '年龄', width: 8, align: 'center' },
  { key: 'disease', label: '疾病', width: 10, align: 'center' },
  { key: 'time', label: '时间', width: 16, align: 'center' },
  { key: 'sourceType', label: '推送方式', width: 12, align: 'center' },
  { key: 'distance', label: '距离', width: 12, align: 'center' },
  { key: 'status', label: '状态', width: 12, align: 'center' },
]

/**
 * 大屏聚合服务。
 *
 * 设计要点（对应方案 §6.2）：
 *   - 一次请求返回整屏数据，减少大屏终端请求数与渲染抖动；
 *   - 结果做 TTL 缓存，病例变更事件到来时立即失效；
 *   - 文案、颜色、格式化全部由后端下发，前端零硬编码业务字典。
 */
@Injectable()
export class ScreenService {
  private readonly logger = new Logger('Screen')
  private readonly cache = new Map<string, { at: number; data: ScreenBootstrap }>()

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly dict: DictService,
    private readonly cases: CaseService,
    events: DomainEvents,
  ) {
    // 病例变更 → 立即失效缓存，保证大屏 5 秒内可见（方案 V12）
    events.stream$.subscribe((e) => {
      if (e.type === 'case.created' || e.type === 'case.updated' || e.type === 'stats.changed') this.cache.clear()
    })
  }

  /* ------------------------------------------------------------ 配置 */

  getConfig(screenCode = 'main'): ScreenConfigRow {
    const row = this.db.get<ScreenConfigRow>(
      `SELECT id, screen_code AS screenCode, hospital_name AS hospitalName, system_name AS systemName,
              refresh_interval AS refreshInterval, scroll_speed AS scrollSpeed, visible_rows AS visibleRows,
              mask_enabled AS maskEnabled, pie_disease_code AS pieDiseaseCode, month_bar_mode AS monthBarMode,
              table_limit AS tableLimit, theme, updated_at AS updatedAt
         FROM screen_config WHERE screen_code = ?`,
      [screenCode],
    )
    if (row) return row
    // 首次访问自动落一条默认配置，避免大屏 500
    const ts = now()
    this.db.insert('screen_config', {
      screen_code: screenCode,
      hospital_name: DEFAULT_HOSPITAL_NAME,
      system_name: DEFAULT_SYSTEM_NAME,
      refresh_interval: 30,
      scroll_speed: 40,
      visible_rows: 4,
      mask_enabled: 1,
      pie_disease_code: 'TRAUMA',
      month_bar_mode: 'CREATED_AT',
      table_limit: appConfig.screenTableLimit,
      theme: 'blue',
      updated_at: ts,
      updated_by: null,
    })
    return this.getConfig(screenCode)
  }

  /** 大屏运行时配置（轮播速度、可见行数等） */
  runtimeConfig(screenCode = 'main'): ScreenRuntimeConfig {
    return toRuntimeConfig(this.getConfig(screenCode))
  }

  listConfigs(): ScreenConfigItem[] {    const rows = this.db.all<ScreenConfigRow>(
      `SELECT id, screen_code AS screenCode, hospital_name AS hospitalName, system_name AS systemName,
              refresh_interval AS refreshInterval, scroll_speed AS scrollSpeed, visible_rows AS visibleRows,
              mask_enabled AS maskEnabled, pie_disease_code AS pieDiseaseCode, month_bar_mode AS monthBarMode,
              table_limit AS tableLimit, theme, updated_at AS updatedAt
         FROM screen_config ORDER BY id ASC`,
    )
    return rows.map(toConfigItem)
  }

  updateConfig(screenCode: string, body: Record<string, unknown>, operatorId: number | null): ScreenConfigItem {
    const current = this.getConfig(screenCode)
    const data: Record<string, SqlValue> = { updated_at: now(), updated_by: operatorId }
    if (body.hospitalName !== undefined) data.hospital_name = requiredString(body.hospitalName, '医院名称', 128)
    if (body.systemName !== undefined) data.system_name = requiredString(body.systemName, '系统名称', 64)
    if (body.refreshInterval !== undefined) data.refresh_interval = requiredNumber(body.refreshInterval, '刷新间隔', 5, 600)
    if (body.scrollSpeed !== undefined) data.scroll_speed = requiredNumber(body.scrollSpeed, '滚动速度', 10, 200)
    if (body.visibleRows !== undefined) data.visible_rows = requiredNumber(body.visibleRows, '可见行数', 3, 20)
    if (body.maskEnabled !== undefined) data.mask_enabled = v(optionalBool(body.maskEnabled, '脱敏开关') ?? true)
    if (body.pieDiseaseCode !== undefined) data.pie_disease_code = optionalString(body.pieDiseaseCode, '饼图疾病', 32)
    if (body.monthBarMode !== undefined) {
      const mode = requiredString(body.monthBarMode, '柱状统计口径', 16)
      if (!['CREATED_AT', 'ARRIVE_AT'].includes(mode)) throw ApiException.param('柱状统计口径取值不合法')
      data.month_bar_mode = mode
    }
    if (body.theme !== undefined) data.theme = requiredString(body.theme, '主题', 32)
    if (body.tableLimit !== undefined) data.table_limit = requiredNumber(body.tableLimit, '表格条数', 5, 100)
    // 大屏作为只读终端，把可配置项收敛到白名单内，避免任意字段写入
    this.db.update('screen_config', current.id, data)
    this.cache.clear()
    const updated = this.getConfig(screenCode)
    return toConfigItem(updated)
  }

  /* ----------------------------------------------------------- 聚合读 */

  bootstrap(screenCode = 'main', force = false): ScreenBootstrap {
    const hit = this.cache.get(screenCode)
    const ttlMs = appConfig.screenCacheTtl * 1000
    if (!force && hit && Date.now() - hit.at < ttlMs) return hit.data

    const cfg = this.getConfig(screenCode)
    const generatedAt = formatDate(new Date())
    const data: ScreenBootstrap = {
      header: {
        hospitalName: cfg.hospitalName,
        systemName: cfg.systemName,
        serverTime: generatedAt,
        generatedAt,
        stale: false,
      },
      pie: this.buildPie(cfg),
      bar: this.buildBar(cfg),
      table: this.buildTable(cfg),
      footer: this.buildFooter(),
      config: toRuntimeConfig(cfg),
    }
    this.cache.set(screenCode, { at: Date.now(), data })
    this.logger.debug(`大屏数据已重建：${screenCode}`)
    return data
  }

  /** 环形图：累计患者按疾病分组；pieDiseaseCode 非空时聚焦单病种（与参考大屏呈现方式一致） */
  private buildPie(cfg: ScreenConfigRow): ScreenPie {
    const params: SqlValue[] = []
    let where = 'deleted_at IS NULL'
    if (cfg.pieDiseaseCode) {
      where += ' AND disease_code = ?'
      params.push(cfg.pieDiseaseCode)
    }
    const rows = this.db.all<{ code: string; value: number }>(
      `SELECT disease_code AS code, COUNT(*) AS value FROM green_channel_case WHERE ${where} GROUP BY disease_code ORDER BY value DESC`,
      params,
    )
    const items = rows.map((r) => {
      const d = this.dict.mapOf('disease').get(r.code)
      return { code: r.code, name: d?.name ?? r.code, value: r.value, color: d?.color ?? BAR_PALETTE[0] }
    })
    return {
      title: '急救绿道：累计患者饼图',
      centerLabel: '累计',
      total: items.reduce((s, i) => s + i.value, 0),
      items,
    }
  }

  /** 近 12 个月柱状：自当前月回溯 12 个自然月，颜色按位置循环取色板 */
  private buildBar(cfg: ScreenConfigRow): ScreenBar {
    const months = recentMonths(12)
    const first = months[0]!
    const field = cfg.monthBarMode === 'ARRIVE_AT' ? 'arrive_at' : 'created_at'
    // ARRIVE_AT 口径下 created_at 仍是兜底（避免空值丢数）
    const expr = field === 'arrive_at' ? `COALESCE(arrive_at, created_at)` : 'created_at'
    const rows = this.db.all<{ ym: string; value: number }>(
      `SELECT substr(${expr}, 1, 7) AS ym, COUNT(*) AS value
         FROM green_channel_case
        WHERE deleted_at IS NULL AND substr(${expr}, 1, 7) >= ?
        GROUP BY ym`,
      [first],
    )
    const map = new Map(rows.map((r) => [r.ym, r.value]))
    const currentYm = formatDate(new Date(), 'YYYY-MM')
    const list: ScreenBarMonth[] = months.map((ym, i) => ({
      label: ym.slice(5),
      month: ym,
      value: map.get(ym) ?? 0,
      color: BAR_PALETTE[i % BAR_PALETTE.length]!,
      partial: ym === currentYm,
    }))
    const max = list.reduce((m, x) => Math.max(m, x.value), 0)
    // 与参考大屏一致：y 轴上限取「比最大值大的最小整百」
    const yMax = Math.max(100, Math.ceil(max / 100) * 100)
    return { title: '本院近12个月急救绿道患者量', unit: '人', yMax, months: list }
  }

  /** 24 小时内病例（已脱敏），按时间倒序 */
  private buildTable(cfg: ScreenConfigRow): ScreenTable {
    const limit = cfg.tableLimit || appConfig.screenTableLimit
    const rows = this.cases.screenRows(limit)
    const total =
      this.db.scalar<number>(
        `SELECT COUNT(*) FROM green_channel_case
          WHERE deleted_at IS NULL AND created_at >= datetime('now','localtime','-24 hours')`,
      ) ?? 0
    return {
      title: '24小时内急救绿道患者',
      columns: SCREEN_COLUMNS,
      rows: rows.map(toScreenRow),
      total,
    }
  }

  /** 底部：当前仍在绿道中（未闭环）的患者数，按疾病分组 */
  private buildFooter(): ScreenFooter {
    const rows = this.db.all<{ code: string; value: number }>(
      `SELECT disease_code AS code, COUNT(*) AS value FROM green_channel_case
        WHERE deleted_at IS NULL AND is_closed = 0 GROUP BY disease_code ORDER BY value DESC`,
    )
    const items = rows.map((r) => {
      const d = this.dict.mapOf('disease').get(r.code)
      return { code: r.code, name: d?.name ?? r.code, value: r.value, color: d?.color ?? BAR_PALETTE[0] }
    })
    return { label: '目前急救绿道患者总数', total: items.reduce((s, i) => s + i.value, 0), items }
  }
}

function toScreenRow(row: CaseListItem): ScreenTableRow {
  return {
    id: row.id,
    caseNo: row.caseNo,
    name: row.patientName,
    gender: row.genderName,
    age: row.age,
    diseaseCode: row.diseaseCode,
    diseaseName: row.diseaseName,
    diseaseColor: row.diseaseColor,
    time: formatMonthDayMinute(row.createdAt),
    createdAt: row.createdAt,
    sourceType: row.sourceType,
    sourceTypeName: row.sourceTypeName,
    distance: formatDistance(row.distanceKm),
    statusCode: row.statusCode,
    statusName: row.statusName,
    statusColor: row.statusColor,
  }
}

function toRuntimeConfig(cfg: ScreenConfigRow): ScreenRuntimeConfig {
  return {
    refreshInterval: cfg.refreshInterval,
    scrollSpeed: cfg.scrollSpeed,
    visibleRows: cfg.visibleRows,
    maskEnabled: cfg.maskEnabled === 1,
    theme: cfg.theme,
  }
}

function toConfigItem(cfg: ScreenConfigRow): ScreenConfigItem {
  return {
    id: cfg.id,
    screenCode: cfg.screenCode,
    hospitalName: cfg.hospitalName,
    systemName: cfg.systemName,
    refreshInterval: cfg.refreshInterval,
    scrollSpeed: cfg.scrollSpeed,
    visibleRows: cfg.visibleRows,
    maskEnabled: cfg.maskEnabled === 1,
    pieDiseaseCode: cfg.pieDiseaseCode,
    monthBarMode: (cfg.monthBarMode === 'ARRIVE_AT' ? 'ARRIVE_AT' : 'CREATED_AT') as 'CREATED_AT' | 'ARRIVE_AT',
    theme: cfg.theme,
    updatedAt: formatDate(cfg.updatedAt),
  }
}
