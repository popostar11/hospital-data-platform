/**
 * 报表与工作台路由。SQL 与本地版 `report.service.ts` 一致。
 * 时间窗口统一按「本地时区字符串」比较（created_at 存的就是本地时间字符串）。
 */
import { PERM, recentMonths, type DashboardOverview, type KpiResult, type ReportBucket, type ReportResult } from '@hospital/shared'
import { ApiException, optionalDay, orderBy } from '../http'
import { Dicts, SELECT_CASE, toCaseListItem, type CaseRow } from '../services'
import type { Ctx, Route } from '../types'

type GroupBy = 'day' | 'month' | 'dept' | 'disease' | 'source'

const GROUP_EXPR: Record<GroupBy, string> = {
  day: "substr(c.created_at, 1, 10)",
  month: "substr(c.created_at, 1, 7)",
  dept: "COALESCE(d.name, '未分配')",
  disease: 'c.disease_code',
  source: 'c.source_type',
}

/** 事件节点宽表：算响应时长等质控指标 */
const EVENT_CTE = /* sql */ `
  ev AS (
    SELECT case_id,
           MIN(CASE WHEN event_code = 'CALL' THEN event_at END) AS call_at,
           MIN(CASE WHEN event_code = 'TRIAGE' THEN event_at END) AS triage_at,
           MIN(CASE WHEN event_code = 'ARRIVE_HOSPITAL' THEN event_at END) AS arrive_at,
           MIN(CASE WHEN event_code = 'CT' THEN event_at END) AS ct_at,
           MIN(CASE WHEN event_code IN ('ARRIVE_HOSPITAL','TRIAGE','FIRST_CONTACT') THEN event_at END) AS contact_at
      FROM case_event GROUP BY case_id
  )
`

const RESPONSE_OVERTIME_MINUTES = 60
const MINUTES = (a: string, b: string) => `(julianday(${a}) - julianday(${b})) * 1440`

function defaultRange(ctx: Ctx): { from: string; to: string } {
  const months = recentMonths(12)
  return { from: `${months[0]}-01`, to: ctx.nowStr.slice(0, 10) }
}

const round1 = (n: number | null | undefined) => (n === null || n === undefined ? null : Math.round(n * 10) / 10)

async function greenChannel(ctx: Ctx): Promise<ReportResult> {
  const groupBy = (ctx.query.get('groupBy') ?? 'day') as GroupBy
  const expr = GROUP_EXPR[groupBy]
  if (!expr) throw ApiException.param('分组维度不合法')
  const def = defaultRange(ctx)
  const from = optionalDay(ctx.query.get('from'), '开始日期') ?? def.from
  const to = optionalDay(ctx.query.get('to'), '结束日期') ?? def.to

  const rows = await ctx.db.all<{ key: string; total: number; closed: number; openCount: number; avgMin: number | null; overtime: number }>(
    `WITH ${EVENT_CTE}
     SELECT ${expr} AS key,
            COUNT(*) AS total,
            SUM(CASE WHEN c.is_closed = 1 THEN 1 ELSE 0 END) AS closed,
            SUM(CASE WHEN c.is_closed = 0 THEN 1 ELSE 0 END) AS openCount,
            AVG(CASE WHEN ev.call_at IS NOT NULL AND ev.contact_at IS NOT NULL AND ${MINUTES('ev.contact_at', 'ev.call_at')} > 0
                     THEN ${MINUTES('ev.contact_at', 'ev.call_at')} END) AS avgMin,
            SUM(CASE WHEN ev.call_at IS NOT NULL AND ev.contact_at IS NOT NULL
                      AND ${MINUTES('ev.contact_at', 'ev.call_at')} > ${RESPONSE_OVERTIME_MINUTES} THEN 1 ELSE 0 END) AS overtime
       FROM green_channel_case c
       LEFT JOIN ev ON ev.case_id = c.id
       LEFT JOIN department d ON d.id = c.dept_id
      WHERE c.deleted_at IS NULL AND substr(c.created_at, 1, 10) BETWEEN ? AND ?
      GROUP BY key ORDER BY key ASC`,
    [from, to],
  )

  const dicts = new Dicts(ctx.db)
  const diseaseMap = await dicts.mapOf('disease')
  const sourceMap = await dicts.mapOf('sourceType')
  const label = (key: string) =>
    groupBy === 'disease' ? (diseaseMap.get(key)?.name ?? key) : groupBy === 'source' ? (sourceMap.get(key)?.name ?? key) : key

  const buckets: ReportBucket[] = rows.map((r) => ({
    key: r.key,
    label: label(r.key),
    total: Number(r.total ?? 0),
    closed: Number(r.closed ?? 0),
    openCount: Number(r.openCount ?? 0),
    avgResponseMinutes: round1(r.avgMin),
    overtimeCount: Number(r.overtime ?? 0),
  }))
  const sum = (f: (b: ReportBucket) => number) => buckets.reduce((s, b) => s + f(b), 0)
  const total = sum((b) => b.total)
  const closed = sum((b) => b.closed)
  const overtimeCount = sum((b) => b.overtimeCount)
  const valid = buckets.filter((b) => b.avgResponseMinutes !== null)
  const validTotal = valid.reduce((s, b) => s + b.total, 0)
  const avgResponseMinutes = validTotal
    ? Math.round((valid.reduce((s, b) => s + (b.avgResponseMinutes ?? 0) * b.total, 0) / validTotal) * 10) / 10
    : null

  return {
    groupBy,
    from,
    to,
    buckets,
    summary: {
      total,
      closed,
      openCount: sum((b) => b.openCount),
      closedRate: total ? Math.round((closed / total) * 1000) / 10 : 0,
      avgResponseMinutes,
      overtimeRate: total ? Math.round((overtimeCount / total) * 1000) / 10 : 0,
    },
  }
}

async function kpi(ctx: Ctx): Promise<KpiResult> {
  const def = defaultRange(ctx)
  const from = optionalDay(ctx.query.get('from'), '开始日期') ?? def.from
  const to = optionalDay(ctx.query.get('to'), '结束日期') ?? def.to

  const overall = await ctx.db.get<{
    avgResponse: number | null
    avgTriage: number | null
    avgDnt: number | null
    total: number
    closed: number
    overtime: number
  }>(
    `WITH ${EVENT_CTE}
     SELECT
       AVG(CASE WHEN ev.call_at IS NOT NULL AND ev.contact_at IS NOT NULL AND ${MINUTES('ev.contact_at', 'ev.call_at')} > 0
                THEN ${MINUTES('ev.contact_at', 'ev.call_at')} END) AS avgResponse,
       AVG(CASE WHEN ev.call_at IS NOT NULL AND ev.triage_at IS NOT NULL AND ${MINUTES('ev.triage_at', 'ev.call_at')} > 0
                THEN ${MINUTES('ev.triage_at', 'ev.call_at')} END) AS avgTriage,
       AVG(CASE WHEN ev.arrive_at IS NOT NULL AND ev.ct_at IS NOT NULL AND ${MINUTES('ev.ct_at', 'ev.arrive_at')} > 0
                THEN ${MINUTES('ev.ct_at', 'ev.arrive_at')} END) AS avgDnt,
       COUNT(*) AS total,
       SUM(CASE WHEN c.is_closed = 1 THEN 1 ELSE 0 END) AS closed,
       SUM(CASE WHEN ev.call_at IS NOT NULL AND ev.contact_at IS NOT NULL
                 AND ${MINUTES('ev.contact_at', 'ev.call_at')} > ${RESPONSE_OVERTIME_MINUTES} THEN 1 ELSE 0 END) AS overtime
     FROM green_channel_case c LEFT JOIN ev ON ev.case_id = c.id
    WHERE c.deleted_at IS NULL AND substr(c.created_at, 1, 10) BETWEEN ? AND ?`,
    [from, to],
  )

  const byDiseaseRows = await ctx.db.all<{ code: string; total: number; avgMin: number | null }>(
    `WITH ${EVENT_CTE}
     SELECT c.disease_code AS code, COUNT(*) AS total,
            AVG(CASE WHEN ev.call_at IS NOT NULL AND ev.contact_at IS NOT NULL AND ${MINUTES('ev.contact_at', 'ev.call_at')} > 0
                     THEN ${MINUTES('ev.contact_at', 'ev.call_at')} END) AS avgMin
       FROM green_channel_case c LEFT JOIN ev ON ev.case_id = c.id
      WHERE c.deleted_at IS NULL AND substr(c.created_at, 1, 10) BETWEEN ? AND ?
      GROUP BY c.disease_code ORDER BY total DESC`,
    [from, to],
  )
  const diseaseMap = await new Dicts(ctx.db).mapOf('disease')
  const total = Number(overall?.total ?? 0)

  return {
    from,
    to,
    avgResponseMinutes: round1(overall?.avgResponse),
    avgTriageMinutes: round1(overall?.avgTriage),
    avgDntMinutes: round1(overall?.avgDnt),
    closedRate: total ? Math.round(((Number(overall?.closed ?? 0)) / total) * 1000) / 10 : null,
    overtimeRate: total ? Math.round(((Number(overall?.overtime ?? 0)) / total) * 1000) / 10 : null,
    byDisease: byDiseaseRows.map((r) => ({
      diseaseCode: r.code,
      diseaseName: diseaseMap.get(r.code)?.name ?? r.code,
      avgResponseMinutes: round1(r.avgMin),
      total: Number(r.total),
    })),
  }
}

async function dashboard(ctx: Ctx): Promise<DashboardOverview> {
  const today = ctx.nowStr.slice(0, 10)
  const yesterdayDate = new Date(Date.now() - 86400000)
  const yesterday = `${yesterdayDate.getFullYear()}-${String(yesterdayDate.getMonth() + 1).padStart(2, '0')}-${String(yesterdayDate.getDate()).padStart(2, '0')}`

  const [todayTotal, todayClosed, openCount, overtimeCount, yesterdayTotal] = await Promise.all([
    ctx.db.scalar<number>('SELECT COUNT(*) FROM green_channel_case WHERE deleted_at IS NULL AND substr(created_at,1,10) = ?', [today]),
    ctx.db.scalar<number>("SELECT COUNT(*) FROM green_channel_case WHERE deleted_at IS NULL AND closed_at IS NOT NULL AND substr(closed_at,1,10) = ?", [today]),
    ctx.db.scalar<number>('SELECT COUNT(*) FROM green_channel_case WHERE deleted_at IS NULL AND is_closed = 0'),
    ctx.db.scalar<number>(
      `SELECT COUNT(*) FROM green_channel_case
        WHERE deleted_at IS NULL AND is_closed = 0
          AND created_at <= datetime('now','+8 hours','-${RESPONSE_OVERTIME_MINUTES} minutes')`,
    ),
    ctx.db.scalar<number>('SELECT COUNT(*) FROM green_channel_case WHERE deleted_at IS NULL AND substr(created_at,1,10) = ?', [yesterday]),
  ])

  const trendRows = await ctx.db.all<{ date: string; total: number; closed: number }>(
    `SELECT substr(created_at,1,10) AS date, COUNT(*) AS total,
            SUM(CASE WHEN is_closed = 1 THEN 1 ELSE 0 END) AS closed
       FROM green_channel_case
      WHERE deleted_at IS NULL AND substr(created_at,1,10) >= date('now','+8 hours','-6 days')
      GROUP BY date ORDER BY date ASC`,
  )
  const trendMap = new Map(trendRows.map((r) => [r.date, r]))
  const trend: DashboardOverview['trend'] = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const hit = trendMap.get(key)
    trend.push({ date: key, label: key.slice(5), total: Number(hit?.total ?? 0), closed: Number(hit?.closed ?? 0) })
  }

  const diseaseRows = await ctx.db.all<{ code: string; total: number }>(
    `SELECT disease_code AS code, COUNT(*) AS total FROM green_channel_case
      WHERE deleted_at IS NULL AND substr(created_at,1,10) >= date('now','+8 hours','-29 days')
      GROUP BY disease_code ORDER BY total DESC`,
  )
  const diseaseMap = await new Dicts(ctx.db).mapOf('disease')
  const latestRows = await ctx.db.all<CaseRow>(
    `${SELECT_CASE} WHERE c.deleted_at IS NULL ORDER BY c.created_at DESC, c.id DESC LIMIT 8`,
  )

  return {
    todayTotal: Number(todayTotal ?? 0),
    todayClosed: Number(todayClosed ?? 0),
    openCount: Number(openCount ?? 0),
    overtimeCount: Number(overtimeCount ?? 0),
    yesterdayTotal: Number(yesterdayTotal ?? 0),
    trend,
    byDisease: diseaseRows.map((r) => {
      const d = diseaseMap.get(r.code)
      return { code: r.code, name: d?.name ?? r.code, color: d?.color ?? '#4FA8FF', total: Number(r.total) }
    }),
    latest: await Promise.all(latestRows.map((r) => toCaseListItem(new Dicts(ctx.db), r))),
  }
}

export const reportRoutes: Route[] = [
  {
    method: 'GET',
    path: '/dashboard/overview',
    perms: [PERM.CASE_VIEW],
    handler: (ctx) => dashboard(ctx),
  },
  {
    method: 'GET',
    path: '/reports/green-channel',
    perms: [PERM.REPORT_VIEW],
    handler: (ctx) => greenChannel(ctx),
  },
  {
    method: 'GET',
    path: '/reports/kpi',
    perms: [PERM.REPORT_VIEW],
    handler: (ctx) => kpi(ctx),
  },
  {
    method: 'GET',
    path: '/reports/export',
    perms: [PERM.REPORT_EXPORT],
    handler: async (ctx) => {
      const result = await greenChannel(ctx)
      const lines = ['维度,病例总数,已闭环,在绿道中,平均响应时长(分钟),超时例数']
      for (const b of result.buckets) {
        lines.push([b.label, b.total, b.closed, b.openCount, b.avgResponseMinutes ?? '', b.overtimeCount].join(','))
      }
      lines.push(['合计', result.summary.total, result.summary.closed, result.summary.openCount, result.summary.avgResponseMinutes ?? '', ''].join(','))
      return new Response(`\uFEFF${lines.join('\r\n')}`, {
        headers: {
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': `attachment; filename="report_${result.from}_${result.to}.csv"`,
          'access-control-allow-origin': '*',
        },
      })
    },
  },
  {
    method: 'GET',
    path: '/reports/rebuild-stat',
    perms: [PERM.REPORT_VIEW],
    // D1 里统计口径都是实时查询，没有本地版的快照表，因此这里是空操作
    handler: () => ({ days: 0, note: '云端为实时查询，无需重建快照' }),
  },
]

export { orderBy }
