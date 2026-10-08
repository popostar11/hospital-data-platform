/**
 * 大屏聚合接口 + 大屏配置。
 *
 * 与本地版 `apps/server/src/modules/screen/screen.service.ts` 的口径完全一致：
 * 环形图=累计按病种分组（可聚焦单病种）、柱状图=近 12 个自然月、表格=24 小时明细、
 * 底部=当前未闭环按病种分组。表格字段与列顺序对齐参考大屏。
 */
import {
  BAR_PALETTE,
  DEFAULT_HOSPITAL_NAME,
  DEFAULT_SYSTEM_NAME,
  formatDate,
  type ScreenBootstrap,
  type ScreenBarMonth,
  type ScreenFooter,
  type ScreenPie,
  type ScreenTable,
  type ScreenTableColumn,
} from '@hospital/shared'
import { SQL_NOW_LOCAL } from '../db'
import { optionalBool, optionalNumber, optionalString, requireString } from '../http'
import { Dicts, SELECT_CASE, toScreenRow, type CaseRow } from '../services'
import { screenCacheTtl, screenTableLimit, type Ctx, type Route } from '../types'

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

const SELECT_CONFIG = /* sql */ `
  SELECT id, screen_code AS screenCode, hospital_name AS hospitalName, system_name AS systemName,
         refresh_interval AS refreshInterval, scroll_speed AS scrollSpeed, visible_rows AS visibleRows,
         mask_enabled AS maskEnabled, pie_disease_code AS pieDiseaseCode, month_bar_mode AS monthBarMode,
         table_limit AS tableLimit, theme, updated_at AS updatedAt
    FROM screen_config
`

/** 以当前月为基准回溯 n 个月（纯字符串运算，不受运行时区影响） */
function lastMonths(currentYm: string, n: number): string[] {
  const [y, m] = currentYm.split('-').map(Number)
  const out: string[] = []
  for (let i = n - 1; i >= 0; i--) {
    const total = y! * 12 + (m! - 1) - i
    const yy = Math.floor(total / 12)
    const mm = (total % 12) + 1
    out.push(`${yy}-${String(mm).padStart(2, '0')}`)
  }
  return out
}

async function getConfig(ctx: Ctx, screenCode: string): Promise<ScreenConfigRow> {
  const row = await ctx.db.get<ScreenConfigRow>(`${SELECT_CONFIG} WHERE screen_code = ?`, [screenCode])
  if (row) return row
  // 首次访问自动落一条默认配置，避免大屏 500
  await ctx.db.insert('screen_config', {
    screen_code: screenCode,
    hospital_name: DEFAULT_HOSPITAL_NAME,
    system_name: DEFAULT_SYSTEM_NAME,
    refresh_interval: 30,
    scroll_speed: 40,
    visible_rows: 4,
    mask_enabled: 1,
    pie_disease_code: 'TRAUMA',
    month_bar_mode: 'CREATED_AT',
    table_limit: screenTableLimit(ctx.env),
    theme: 'blue',
    updated_at: ctx.nowStr,
    updated_by: null,
  })
  return (await ctx.db.get<ScreenConfigRow>(`${SELECT_CONFIG} WHERE screen_code = ?`, [screenCode]))!
}

/**
 * 请求级 + isolate 级缓存：TTL 很短（默认 5 秒），
 * 目的只是扛住多块大屏同时刷新，不追求跨 isolate 强一致。
 */
const cache = new Map<string, { at: number; data: ScreenBootstrap }>()

async function buildBootstrap(ctx: Ctx, cfg: ScreenConfigRow): Promise<ScreenBootstrap> {
  const dicts = new Dicts(ctx.db)
  const diseaseMap = await dicts.mapOf('disease')

  /* ---------------------------------------------------------- 环形图 */
  const pieParams: unknown[] = []
  let pieWhere = 'deleted_at IS NULL'
  if (cfg.pieDiseaseCode) {
    pieWhere += ' AND disease_code = ?'
    pieParams.push(cfg.pieDiseaseCode)
  }
  const pieRows = await ctx.db.all<{ code: string; value: number }>(
    `SELECT disease_code AS code, COUNT(*) AS value FROM green_channel_case WHERE ${pieWhere} GROUP BY disease_code ORDER BY value DESC`,
    pieParams,
  )
  const pieItems = pieRows.map((r) => {
    const d = diseaseMap.get(r.code)
    return { code: r.code, name: d?.name ?? r.code, value: Number(r.value), color: d?.color ?? BAR_PALETTE[0] }
  })
  const pie: ScreenPie = {
    title: '急救绿道：累计患者饼图',
    centerLabel: '累计',
    total: pieItems.reduce((s, i) => s + i.value, 0),
    items: pieItems,
  }

  /* ---------------------------------------------------------- 柱状图 */
  const currentYm = ctx.nowStr.slice(0, 7)
  const months = lastMonths(currentYm, 12)
  const expr = cfg.monthBarMode === 'ARRIVE_AT' ? 'COALESCE(arrive_at, created_at)' : 'created_at'
  const barRows = await ctx.db.all<{ ym: string; value: number }>(
    `SELECT substr(${expr}, 1, 7) AS ym, COUNT(*) AS value
       FROM green_channel_case
      WHERE deleted_at IS NULL AND substr(${expr}, 1, 7) >= ?
      GROUP BY ym`,
    [months[0]],
  )
  const barMap = new Map(barRows.map((r) => [r.ym, Number(r.value)]))
  const monthList: ScreenBarMonth[] = months.map((ym, i) => ({
    label: ym.slice(5),
    month: ym,
    value: barMap.get(ym) ?? 0,
    color: BAR_PALETTE[i % BAR_PALETTE.length]!,
    partial: ym === currentYm,
  }))
  const max = monthList.reduce((m, x) => Math.max(m, x.value), 0)
  const yMax = Math.max(100, Math.ceil(max / 100) * 100)

  /* -------------------------------------------------- 24 小时明细表 */
  const limit = cfg.tableLimit || screenTableLimit(ctx.env)
  const caseRows = await ctx.db.all<CaseRow>(
    `${SELECT_CASE} WHERE c.deleted_at IS NULL
       AND c.created_at >= datetime('now', '+8 hours', '-24 hours')
      ORDER BY c.created_at DESC, c.id DESC LIMIT ?`,
    [limit],
  )
  const tableTotal =
    (await ctx.db.scalar<number>(
      `SELECT COUNT(*) FROM green_channel_case
        WHERE deleted_at IS NULL AND created_at >= datetime('now', '+8 hours', '-24 hours')`,
    )) ?? 0
  const table: ScreenTable = {
    title: '24小时内急救绿道患者',
    columns: SCREEN_COLUMNS,
    rows: await Promise.all(caseRows.map((r) => toScreenRow(dicts, r))),
    total: tableTotal,
  }

  /* ------------------------------------------------------ 底部统计 */
  const footerRows = await ctx.db.all<{ code: string; value: number }>(
    `SELECT disease_code AS code, COUNT(*) AS value FROM green_channel_case
      WHERE deleted_at IS NULL AND is_closed = 0 GROUP BY disease_code ORDER BY value DESC`,
  )
  const footerItems = footerRows.map((r) => {
    const d = diseaseMap.get(r.code)
    return { code: r.code, name: d?.name ?? r.code, value: Number(r.value), color: d?.color ?? BAR_PALETTE[0] }
  })
  const footer: ScreenFooter = {
    label: '目前急救绿道患者总数',
    total: footerItems.reduce((s, i) => s + i.value, 0),
    items: footerItems,
  }

  const generatedAt = ctx.nowStr
  return {
    header: {
      hospitalName: cfg.hospitalName,
      systemName: cfg.systemName,
      serverTime: generatedAt,
      generatedAt,
      stale: false,
    },
    pie,
    bar: { title: '本院近12个月急救绿道患者量', unit: '人', yMax, months: monthList },
    table,
    footer,
    config: {
      refreshInterval: cfg.refreshInterval,
      scrollSpeed: cfg.scrollSpeed,
      visibleRows: cfg.visibleRows,
      maskEnabled: cfg.maskEnabled === 1,
      theme: cfg.theme,
    },
  }
}

function toConfigItem(cfg: ScreenConfigRow) {
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
    updatedAt: cfg.updatedAt,
  }
}

export const screenRoutes: Route[] = [
  {
    method: 'GET',
    path: '/screen/bootstrap',
    isScreen: true,
    handler: async (ctx) => {
      const screenCode = ctx.query.get('screenCode') || 'main'
      const force = ctx.query.get('force') === '1'
      const ttlMs = screenCacheTtl(ctx.env) * 1000
      const hit = cache.get(screenCode)
      if (!force && hit && Date.now() - hit.at < ttlMs) return hit.data
      const cfg = await getConfig(ctx, screenCode)
      const data = await buildBootstrap(ctx, cfg)
      cache.set(screenCode, { at: Date.now(), data })
      return data
    },
  },
  {
    method: 'GET',
    path: '/screen/config',
    isScreen: true,
    handler: async (ctx) => {
      const cfg = await getConfig(ctx, ctx.query.get('screenCode') || 'main')
      return {
        refreshInterval: cfg.refreshInterval,
        scrollSpeed: cfg.scrollSpeed,
        visibleRows: cfg.visibleRows,
        maskEnabled: cfg.maskEnabled === 1,
        theme: cfg.theme,
      }
    },
  },
  {
    method: 'GET',
    path: '/screen/stream',
    isScreen: true,
    // Workers 不适合长期占用连接做 SSE；返回 204 让浏览器按规范停止重连，
    // 前端会自动退化为定时轮询（见 apps/screen-web 的 useScreenData）。
    handler: () => new Response(null, { status: 204 }),
  },
  {
    method: 'GET',
    path: '/screen-configs',
    perms: ['screen-config:view'],
    handler: async (ctx) => (await ctx.db.all<ScreenConfigRow>(`${SELECT_CONFIG} ORDER BY id ASC`)).map(toConfigItem),
  },
  {
    method: 'PUT',
    path: '/screen-configs/:screenCode',
    perms: ['screen-config:update'],
    handler: async (ctx) => {
      const screenCode = ctx.params.screenCode!
      const current = await getConfig(ctx, screenCode)
      const data: Record<string, unknown> = { updated_at: ctx.nowStr, updated_by: ctx.user?.id ?? null }
      if (ctx.body.hospitalName !== undefined) data.hospital_name = requireString(ctx.body.hospitalName, '医院名称', 128)
      if (ctx.body.systemName !== undefined) data.system_name = requireString(ctx.body.systemName, '系统名称', 64)
      if (ctx.body.refreshInterval !== undefined) data.refresh_interval = optionalNumber(ctx.body.refreshInterval, '刷新间隔', 5, 600)
      if (ctx.body.scrollSpeed !== undefined) data.scroll_speed = optionalNumber(ctx.body.scrollSpeed, '滚动速度', 10, 200)
      if (ctx.body.visibleRows !== undefined) data.visible_rows = optionalNumber(ctx.body.visibleRows, '可见行数', 3, 20)
      if (ctx.body.maskEnabled !== undefined) data.mask_enabled = optionalBool(ctx.body.maskEnabled) ? 1 : 0
      if (ctx.body.pieDiseaseCode !== undefined) data.pie_disease_code = optionalString(ctx.body.pieDiseaseCode, '饼图疾病', 32)
      if (ctx.body.monthBarMode !== undefined) {
        const mode = requireString(ctx.body.monthBarMode, '柱状统计口径', 16)
        if (!['CREATED_AT', 'ARRIVE_AT'].includes(mode)) throw new Error('柱状统计口径取值不合法')
        data.month_bar_mode = mode
      }
      if (ctx.body.theme !== undefined) data.theme = requireString(ctx.body.theme, '主题', 32)
      await ctx.db.update('screen_config', current.id, data)
      cache.clear()
      const updated = await getConfig(ctx, screenCode)
      await ctx.db.insert('sys_oper_log', {
        user_id: ctx.user?.id ?? null,
        user_name: ctx.user?.username ?? null,
        module: 'screen-config',
        action: 'UPDATE',
        target_type: 'screen_config',
        target_id: screenCode,
        detail: JSON.stringify(ctx.body),
        created_at: ctx.nowStr,
      })
      return toConfigItem(updated)
    },
  },
]

export { formatDate, SQL_NOW_LOCAL, SELECT_CASE }
