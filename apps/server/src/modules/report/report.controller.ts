import { Controller, Get, Query, Req, Res } from '@nestjs/common'
import * as ExcelJS from 'exceljs'
import type { Response } from 'express'
import { PERM } from '@hospital/shared'
import { RequirePerms } from '../../common/auth'
import { clientIp } from '../../common/validate'
import type { RequestWithUser } from '../../common/api'
import { AuditService } from '../../core/audit.service'
import { ReportService } from './report.service'

@Controller('reports')
export class ReportController {
  constructor(
    private readonly report: ReportService,
    private readonly audit: AuditService,
  ) {}

  @Get('green-channel')
  @RequirePerms(PERM.REPORT_VIEW)
  greenChannel(@Query() query: Record<string, string>) {
    return this.report.greenChannel({ from: query.from, to: query.to, groupBy: query.groupBy })
  }

  @Get('kpi')
  @RequirePerms(PERM.REPORT_VIEW)
  kpi(@Query() query: Record<string, string>) {
    return this.report.kpi({ from: query.from, to: query.to })
  }

  @Get('export')
  @RequirePerms(PERM.REPORT_EXPORT)
  async export(@Query() query: Record<string, string>, @Req() req: RequestWithUser, @Res() res: Response) {
    const result = this.report.greenChannel({ from: query.from, to: query.to, groupBy: query.groupBy })
    const workbook = new ExcelJS.Workbook()
    workbook.creator = '急救绿道管理平台'
    const sheet = workbook.addWorksheet('绿道统计')
    sheet.columns = [
      { header: '维度', key: 'label', width: 20 },
      { header: '病例总数', key: 'total', width: 12 },
      { header: '已闭环', key: 'closed', width: 12 },
      { header: '在绿道中', key: 'open', width: 12 },
      { header: '平均响应时长(分钟)', key: 'avg', width: 20 },
      { header: '超时例数', key: 'overtime', width: 12 },
    ]
    sheet.getRow(1).font = { bold: true }
    for (const row of this.report.exportBuckets(result)) {
      sheet.addRow({ label: row[0], total: row[1], closed: row[2], open: row[3], avg: row[4], overtime: row[5] })
    }
    sheet.addRow({})
    sheet.addRow({ label: '合计', total: result.summary.total, closed: result.summary.closed, open: result.summary.openCount, avg: result.summary.avgResponseMinutes ?? '', overtime: '' })
    const buffer = await workbook.xlsx.writeBuffer()
    const fileName = `绿道统计_${result.from}_${result.to}.xlsx`

    await this.audit.log({
      userId: req.user?.id,
      userName: req.user?.username,
      module: 'report',
      action: 'EXPORT',
      targetType: 'report',
      detail: { groupBy: result.groupBy, from: result.from, to: result.to },
      ip: clientIp(req.headers, req.socket),
      ua: req.headers['user-agent'] as string,
    })

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="report.xlsx"; filename*=UTF-8''${encodeURIComponent(fileName)}`)
    res.end(Buffer.from(buffer as ArrayBuffer))
  }

  /** 手动重建统计快照（数据修复/月初结转时使用） */
  @Get('rebuild-stat')
  @RequirePerms(PERM.REPORT_VIEW)
  rebuild() {
    return this.report.rebuildStatDaily()
  }
}

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly report: ReportService) {}

  @Get('overview')
  @RequirePerms(PERM.CASE_VIEW)
  overview() {
    return this.report.dashboard()
  }
}
