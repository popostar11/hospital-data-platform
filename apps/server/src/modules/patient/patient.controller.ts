import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query, Req, Res } from '@nestjs/common'
import type { Response } from 'express'
import { PERM, type PatientImportRow, type PatientSaveRequest } from '@hospital/shared'
import { RequirePerms } from '../../common/auth'
import { ApiException, type RequestWithUser } from '../../common/api'
import { clientIp } from '../../common/validate'
import { AuditService } from '../../core/audit.service'
import { PatientService } from './patient.service'

const CSV_HEADER = ['绿道号', '姓名', '性别', '年龄', '疾病', '推送方式', '手机号', '状态', '最近就诊时间', '备注']

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value)
  return `"${text.replace(/"/g, '""')}"`
}

@Controller('patients')
export class PatientController {
  constructor(
    private readonly patients: PatientService,
    private readonly audit: AuditService,
  ) {}

  /** 注意：静态路径必须声明在 :id 之前，否则会被当成 id */
  @Get('search')
  @RequirePerms(PERM.PATIENT_VIEW)
  search(@Query('keyword') keyword?: string) {
    return this.patients.search(keyword ?? '')
  }

  /** 导出 CSV（与列表同样的筛选条件；记录审计与条数） */
  @Get('export')
  @RequirePerms(PERM.PATIENT_VIEW)
  async export(
    @Query() query: Record<string, string>,
    @Req() req: RequestWithUser,
    @Res() res: Response,
  ): Promise<void> {
    const rows = this.patients.exportRows(parsePatientQuery(query))
    const lines = [CSV_HEADER.join(',')]
    for (const r of rows) {
      lines.push(
        [
          r.lastCaseNo,
          r.nameMasked,
          r.genderName,
          r.age === null ? '' : `${r.age}`,
          r.diseaseName,
          r.sourceTypeName,
          r.phoneMasked,
          r.statusName,
          r.lastVisitAt,
          r.remark,
        ]
          .map(csvCell)
          .join(','),
      )
    }
    await this.audit.log({
      userId: req.user?.id,
      userName: req.user?.username,
      module: 'patient',
      action: 'EXPORT',
      targetType: 'patient',
      detail: { count: rows.length },
      ip: clientIp(req.headers, req.socket),
      ua: req.headers['user-agent'] as string,
    })
    const fileName = `患者列表_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.csv`
    // x-raw-response：让统一响应拦截器放行，直接输出文件流而不是 JSON 信封
    res.setHeader('x-raw-response', '1')
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="patients.csv"; filename*=UTF-8''${encodeURIComponent(fileName)}`)
    // BOM 让 Excel 正确识别 UTF-8
    res.end(`\uFEFF${lines.join('\r\n')}`)
  }

  @Get()
  @RequirePerms(PERM.PATIENT_VIEW)
  list(@Query() query: Record<string, string>) {
    return this.patients.page(parsePatientQuery(query))
  }

  @Get(':id')
  @RequirePerms(PERM.PATIENT_VIEW)
  detail(@Param('id', ParseIntPipe) id: number) {
    return this.patients.detail(id)
  }

  /** 明文查看：单独授权 + 逐次留痕 */
  @Get(':id/plain')
  @RequirePerms(PERM.PATIENT_PLAIN)
  async plain(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithUser) {
    const data = this.patients.plain(id)
    await this.audit.log({
      userId: req.user?.id,
      userName: req.user?.username,
      module: 'patient',
      action: 'VIEW_SENSITIVE',
      targetType: 'patient',
      targetId: id,
      detail: { fields: ['name', 'idCard', 'phone'] },
      ip: clientIp(req.headers, req.socket),
      ua: req.headers['user-agent'] as string,
    })
    return data
  }

  @Post()
  @RequirePerms(PERM.PATIENT_UPDATE)
  async create(@Body() body: PatientSaveRequest, @Req() req: RequestWithUser) {
    const id = this.patients.create(body)
    await this.audit.log({
      userId: req.user?.id, userName: req.user?.username, module: 'patient', action: 'CREATE',
      targetType: 'patient', targetId: id, detail: { masked: this.patients.detail(id).nameMasked },
      ip: clientIp(req.headers, req.socket), ua: req.headers['user-agent'] as string,
    })
    return { id }
  }

  /** 批量导入（前端把 CSV 解析成行后提交，逐行创建） */
  @Post('import')
  @RequirePerms(PERM.PATIENT_UPDATE)
  async import(@Body() body: { rows?: PatientImportRow[] }, @Req() req: RequestWithUser) {
    const result = this.patients.importRows(body?.rows ?? [])
    await this.audit.log({
      userId: req.user?.id, userName: req.user?.username, module: 'patient', action: 'IMPORT',
      targetType: 'patient',
      detail: { total: result.total, created: result.created, skipped: result.skipped },
      ip: clientIp(req.headers, req.socket), ua: req.headers['user-agent'] as string,
    })
    return result
  }

  /** 批量删除（连同各自病例一起软删除） */
  @Post('batch-delete')
  @RequirePerms(PERM.PATIENT_UPDATE)
  async batchDelete(@Body() body: { ids?: number[] }, @Req() req: RequestWithUser) {
    const ids = (body?.ids ?? []).map(Number)
    const deleted = this.patients.removeMany(ids)
    await this.audit.log({
      userId: req.user?.id, userName: req.user?.username, module: 'patient', action: 'BATCH_DELETE',
      targetType: 'patient', detail: { requested: ids.length, deleted },
      ip: clientIp(req.headers, req.socket), ua: req.headers['user-agent'] as string,
    })
    return { deleted }
  }

  @Put(':id')
  @RequirePerms(PERM.PATIENT_UPDATE)
  async update(@Param('id', ParseIntPipe) id: number, @Body() body: PatientSaveRequest, @Req() req: RequestWithUser) {
    this.patients.update(id, body)
    await this.audit.log({
      userId: req.user?.id, userName: req.user?.username, module: 'patient', action: 'UPDATE',
      targetType: 'patient', targetId: id, detail: { fields: Object.keys(body) },
      ip: clientIp(req.headers, req.socket), ua: req.headers['user-agent'] as string,
    })
    return { id }
  }

  @Delete(':id')
  @RequirePerms(PERM.PATIENT_UPDATE)
  async remove(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithUser) {
    const patient = this.patients.detail(id)
    if (!req.user) throw new ApiException(40100)
    this.patients.remove(id)
    await this.audit.log({
      userId: req.user.id, userName: req.user.username, module: 'patient', action: 'DELETE',
      targetType: 'patient', targetId: id, detail: { masked: patient.nameMasked, visitCount: patient.visitCount },
      ip: clientIp(req.headers, req.socket), ua: req.headers['user-agent'] as string,
    })
    return { id }
  }
}

/** 查询参数 → 强类型查询对象（新增疾病 / 状态 / 推送方式三个筛选） */
function parsePatientQuery(query: Record<string, string>): Parameters<PatientService['page']>[0] {
  return {
    page: Number(query.page) || 1,
    pageSize: Number(query.pageSize) || 20,
    sort: query.sort,
    keyword: query.keyword?.trim() || undefined,
    diseaseCode: query.diseaseCode || undefined,
    statusCode: query.statusCode || undefined,
    sourceType: query.sourceType || undefined,
  }
}
