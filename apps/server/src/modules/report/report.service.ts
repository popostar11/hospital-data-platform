import { Injectable } from '@nestjs/common'
import {
  formatDate,
  recentMonths,
  type DashboardOverview,
  type KpiResult,
  type ReportBucket,
  type ReportResult,
} from '@hospital/shared'
import { InjectDb } from '../../db/db.module'
import type { Db } from '../../db/sqlite'
import { ApiException } from '../../common/api'
import { optionalDay } from '../../common/validate'
import { DictService } from '../dict/dict.service'
import { CaseService } from '../case/case.service'

export type GroupBy = 'day' | 'month' | 'dept' | 'disease' | 'source'

const GROUP_EXPR: Record<GroupBy, string> = {
  day: "substr(c.created_at, 1, 10)",
  month: "substr(c.created_at, 1, 7)",
  dept: 'COALESCE(d.name, \'未分配\')',
  disease: 'c.disease_code',
  source: 'c.source_type',
}

/** 事件节点宽表：用于计算响应时长等质控指标 */
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

/** 响应超时阈值（分钟）：呼救→到院/分诊 超过 60 分钟计为超时 */
const RESPONSE_OVERTIME_MINUTES = 60

const MINUTES = (a: string, b: string) => `(julianday(${a}) - julianday(${b})) * 1440`

@Injectable()
export class ReportService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly dict: DictService,
    private readonly cases: CaseService,
  ) {}

  /* --------------------------------------------------------- 通用报表 */

  greenChannel(input: { from?: string; to?: string; groupBy?: string }): ReportResult {
    const groupBy = (input.groupBy ?? 'day') as GroupBy
    if (!GROUP_EXPR[groupBy]) throw ApiException.param('分组维度不合法')
    const from = optionalDay(input.from, '开始日期') ?? defaultFrom()
    const to = optionalDay(input.to, '结束日期') ?? formatDate(new Date(), 'YYYY-MM-DD')
    const expr = GROUP_EXPR[groupBy]

    const rows = this.db.all<{
      key: string
      total: number
      closed: number
      openCount: number
      avgMin: number | null
      overtime: number
    }>(
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

    const buckets: ReportBucket[] = rows.map((r) => ({
      key: r.key,
      label: this.labelOf(groupBy, r.key),
      total: r.total ?? 0,
      closed: r.closed ?? 0,
      openCount: r.openCount ?? 0,
      avgResponseMinutes: r.avgMin === null || r.avgMin === undefined ? null : Math.round(r.avgMin * 10) / 10,
      overtimeCount: r.overtime ?? 0,
    }))

    const total = buckets.reduce((s, b) => s + b.total, 0)
    const closed = buckets.reduce((s, b) => s + b.closed, 0)
    const openCount = buckets.reduce((s, b) => s + b.openCount, 0)
    const overtimeCount = buckets.reduce((s, b) => s + b.overtimeCount, 0)
    const validAvg = buckets.filter((b) => b.avgResponseMinutes !== null)
    const avgResponseMinutes = validAvg.length
      ? Math.round((validAvg.reduce((s, b) => s + (b.avgResponseMinutes ?? 0) * b.total, 0) / validAvg.reduce((s, b) => s + b.total, 0)) * 10) / 10
      : null

    return {
      groupBy,
      from,
      to,
      buckets,
      summary: {
        total,
        closed,
        openCount,
        closedRate: total ? Math.round((closed / total) * 1000) / 10 : 0,
        avgResponseMinutes,
        overtimeRate: total ? Math.round((overtimeCount / total) * 1000) / 10 : 0,
      },
    }
  }

  /* ------------------------------------------------------------- KPI */

  kpi(input: { from?: string; to?: string }): KpiResult {
    const from = optionalDay(input.from, '开始日期') ?? defaultFrom()
    const to = optionalDay(input.to, '结束日期') ?? formatDate(new Date(), 'YYYY-MM-DD')
    const overall = this.db.get<{
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

    const byDiseaseRows = this.db.all<{ code: string; total: number; avgMin: number | null }>(
      `WITH ${EVENT_CTE}
       SELECT c.disease_code AS code, COUNT(*) AS total,
              AVG(CASE WHEN ev.call_at IS NOT NULL AND ev.contact_at IS NOT NULL AND ${MINUTES('ev.contact_at', 'ev.call_at')} > 0
                       THEN ${MINUTES('ev.contact_at', 'ev.call_at')} END) AS avgMin
         FROM green_channel_case c LEFT JOIN ev ON ev.case_id = c.id
        WHERE c.deleted_at IS NULL AND substr(c.created_at, 1, 10) BETWEEN ? AND ?
        GROUP BY c.disease_code ORDER BY total DESC`,
      [from, to],
    )
    const diseaseDict = this.dict.mapOf('disease')

    const round = (n: number | null | undefined) => (n === null || n === undefined ? null : Math.round(n * 10) / 10)
    const total = overall?.total ?? 0
    return {
      from,
      to,
      avgResponseMinutes: round(overall?.avgResponse),
      avgTriageMinutes: round(overall?.avgTriage),
      avgDntMinutes: round(overall?.avgDnt),
      closedRate: total ? Math.round(((overall?.closed ?? 0) / total) * 1000) / 10 : null,
      overtimeRate: total ? Math.round(((overall?.overtime ?? 0) / total) * 1000) / 10 : null,
      byDisease: byDiseaseRows.map((r) => ({
        diseaseCode: r.code,
        diseaseName: diseaseDict.get(r.code)?.name ?? r.code,
        avgResponseMinutes: round(r.avgMin),
        total: r.total,
      })),
    }
  }

  /* --------------------------------------------------------- 工作台 */

  dashboard(): DashboardOverview {
    const today = formatDate(new Date(), 'YYYY-MM-DD')
    const yesterday = formatDate(new Date(Date.now() - 86400000), 'YYYY-MM-DD')
    const todayTotal = this.db.scalar<number>(
      "SELECT COUNT(*) FROM green_channel_case WHERE deleted_at IS NULL AND substr(created_at,1,10) = ?",
      [today],
    ) ?? 0
    const todayClosed = this.db.scalar<number>(
      "SELECT COUNT(*) FROM green_channel_case WHERE deleted_at IS NULL AND closed_at IS NOT NULL AND substr(closed_at,1,10) = ?",
      [today],
    ) ?? 0
    const openCount = this.db.scalar<number>('SELECT COUNT(*) FROM green_channel_case WHERE deleted_at IS NULL AND is_closed = 0') ?? 0
    const overtimeCount = this.db.scalar<number>(
      `SELECT COUNT(*) FROM green_channel_case
        WHERE deleted_at IS NULL AND is_closed = 0
          AND created_at <= datetime('now','localtime','-${RESPONSE_OVERTIME_MINUTES} minutes')`,
    ) ?? 0
    const yesterdayTotal = this.db.scalar<number>(
      'SELECT COUNT(*) FROM green_channel_case WHERE deleted_at IS NULL AND substr(created_at,1,10) = ?',
      [yesterday],
    ) ?? 0

    const trendRows = this.db.all<{ date: string; total: number; closed: number }>(
      `SELECT substr(created_at,1,10) AS date, COUNT(*) AS total,
              SUM(CASE WHEN is_closed = 1 THEN 1 ELSE 0 END) AS closed
         FROM green_channel_case
        WHERE deleted_at IS NULL AND substr(created_at,1,10) >= date('now','localtime','-6 days')
        GROUP BY date ORDER BY date ASC`,
    )
    const trendMap = new Map(trendRows.map((r) => [r.date, r]))
    const trend: DashboardOverview['trend'] = []
    for (let i = 6; i >= 0; i--) {
      const d = formatDate(new Date(Date.now() - i * 86400000), 'YYYY-MM-DD')
      const hit = trendMap.get(d)
      trend.push({ date: d, label: d.slice(5), total: hit?.total ?? 0, closed: hit?.closed ?? 0 })
    }

    const diseaseRows = this.db.all<{ code: string; total: number }>(
      `SELECT disease_code AS code, COUNT(*) AS total FROM green_channel_case
        WHERE deleted_at IS NULL AND substr(created_at,1,10) >= date('now','localtime','-29 days')
        GROUP BY disease_code ORDER BY total DESC`,
    )
    const diseaseDict = this.dict.mapOf('disease')

    return {
      todayTotal,
      todayClosed,
      openCount,
      overtimeCount,
      yesterdayTotal,
      trend,
      byDisease: diseaseRows.map((r) => {
        const d = diseaseDict.get(r.code)
        return { code: r.code, name: d?.name ?? r.code, color: d?.color ?? '#4FA8FF', total: r.total }
      }),
      latest: this.cases.screenRows(8),
    }
  }

  /* ---------------------------------------------------------- 内部 */

  private labelOf(groupBy: GroupBy, key: string): string {
    if (groupBy === 'disease') return this.dict.mapOf('disease').get(key)?.name ?? key
    if (groupBy === 'source') return this.dict.mapOf('sourceType').get(key)?.name ?? key
    return key
  }

  /** 统计快照重建（定时任务/管理端手动触发均可） */
  rebuildStatDaily(): { days: number } {
    this.db.tx(() => {
      this.db.run('DELETE FROM stat_daily')
      this.db.run(
        `INSERT INTO stat_daily (stat_date, disease_code, case_count, closed_count, open_count, avg_response_min, overtime_count)
         SELECT substr(created_at,1,10), 'ALL', COUNT(*), SUM(is_closed),
                SUM(CASE WHEN is_closed = 0 THEN 1 ELSE 0 END), NULL, 0
           FROM green_channel_case WHERE deleted_at IS NULL GROUP BY substr(created_at,1,10)`,
      )
      this.db.run(
        `INSERT INTO stat_daily (stat_date, disease_code, case_count, closed_count, open_count, avg_response_min, overtime_count)
         SELECT substr(created_at,1,10), disease_code, COUNT(*), SUM(is_closed),
                SUM(CASE WHEN is_closed = 0 THEN 1 ELSE 0 END), NULL, 0
           FROM green_channel_case WHERE deleted_at IS NULL GROUP BY substr(created_at,1,10), disease_code`,
      )
    })
    return { days: this.db.scalar<number>('SELECT COUNT(DISTINCT stat_date) FROM stat_daily') ?? 0 }
  }

  /** 近 12 个月汇总（报表页默认区间） */
  static defaultRange(months = 12): { from: string; to: string } {
    const list = recentMonths(months)
    return { from: `${list[0]}-01`, to: formatDate(new Date(), 'YYYY-MM-DD') }
  }

  exportBuckets(result: ReportResult): (string | number)[][] {
    return result.buckets.map((b) => [
      b.label,
      b.total,
      b.closed,
      b.openCount,
      b.avgResponseMinutes ?? '',
      b.overtimeCount,
    ])
  }
}

function defaultFrom(): string {
  return `${recentMonths(12)[0]}-01`
}
