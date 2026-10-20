import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { randomBytes } from 'node:crypto'
import * as ExcelJS from 'exceljs'
import type { Response } from 'express'
import { PERM, formatDate, type CaseEventSaveRequest, type CaseImportRow, type CaseQuery, type CaseSaveRequest } from '@hospital/shared'
import { RequirePerms } from '../../common/auth'
import { clientIp, optionalDateTime, optionalString } from '../../common/validate'
import type { RequestWithUser } from '../../common/api'
import { AuditService } from '../../core/audit.service'
import { DomainEvents } from '../../core/events.service'
import { config } from '../../config'
import { CaseService } from './case.service'

@Controller('cases')
export class CaseController {
  constructor(
    private readonly cases: CaseService,
    private readonly audit: AuditService,
    private readonly events: DomainEvents,
  ) {}

  @Get('meta')
  @RequirePerms(PERM.CASE_VIEW)
  meta() {
    return this.cases.meta()
  }

  /** 导出 xlsx（记录审计与导出条数） */
  @Get('export')
  @RequirePerms(PERM.CASE_EXPORT)
  async export(@Query() query: Record<string, string>, @Req() req: RequestWithUser, @Res() res: Response) {
    const rows = this.cases.exportRows(parseCaseQuery(query))
    const workbook = new ExcelJS.Workbook()
    workbook.creator = '急诊专科中心数据平台'
    const sheet = workbook.addWorksheet('急救绿道病例')
    sheet.columns = [
      { header: '绿道编号', key: 'caseNo', width: 20 },
      { header: '姓名', key: 'patientName', width: 12 },
      { header: '性别', key: 'genderName', width: 8 },
      { header: '年龄', key: 'age', width: 8 },
      { header: '疾病', key: 'diseaseName', width: 14 },
      { header: '推送方式', key: 'sourceTypeName', width: 12 },
      { header: '距离(km)', key: 'distanceKm', width: 12 },
      { header: '科室', key: 'deptName', width: 16 },
      { header: '状态', key: 'statusName', width: 12 },
      { header: '创建时间', key: 'createdAt', width: 20 },
      { header: '闭环时间', key: 'closedAt', width: 20 },
      { header: '备注', key: 'remark', width: 30 },
    ]
    sheet.getRow(1).font = { bold: true }
    for (const r of rows) {
      sheet.addRow({
        caseNo: r.caseNo,
        patientName: r.patientName,
        genderName: r.genderName,
        age: r.age ?? '',
        diseaseName: r.diseaseName,
        sourceTypeName: r.sourceTypeName,
        distanceKm: r.distanceKm ?? '',
        deptName: r.deptName ?? '',
        statusName: r.statusName,
        createdAt: r.createdAt,
        closedAt: r.closedAt ?? '',
        remark: r.remark ?? '',
      })
    }
    const buffer = await workbook.xlsx.writeBuffer()
    const fileName = `急救绿道病例_${formatDate(new Date(), 'YYYYMMDD')}.xlsx`

    await this.audit.log({
      userId: req.user?.id,
      userName: req.user?.username,
      module: 'case',
      action: 'EXPORT',
      targetType: 'green_channel_case',
      detail: { count: rows.length, query },
      ip: clientIp(req.headers, req.socket),
      ua: req.headers['user-agent'] as string,
    })

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="cases.xlsx"; filename*=UTF-8''${encodeURIComponent(fileName)}`)
    res.end(Buffer.from(buffer as ArrayBuffer))
  }

  @Get('attachments/:id/download')
  @RequirePerms(PERM.CASE_VIEW)
  download(@Param('id', ParseIntPipe) id: number, @Res() res: Response) {
    const file = this.cases.getAttachment(id)
    res.download(join(config.uploadDir, file.storedName), file.fileName)
  }

  /** 批量导入病例（每行新建患者 + 一条病例；疾病/推送方式可填中文名） */
  @Post('import')
  @RequirePerms(PERM.CASE_CREATE)
  async import(@Body() body: { rows?: CaseImportRow[] }, @Req() req: RequestWithUser) {
    const result = this.cases.importRows(body?.rows ?? [], req.user?.id ?? null)
    await this.audit.log({
      userId: req.user?.id, userName: req.user?.username, module: 'case', action: 'IMPORT',
      targetType: 'green_channel_case',
      detail: { total: result.total, created: result.created, skipped: result.skipped },
      ip: clientIp(req.headers, req.socket), ua: req.headers['user-agent'] as string,
    })
    return result
  }

  /** 批量删除病例（软删除） */
  @Post('batch-delete')
  @RequirePerms(PERM.CASE_DELETE)
  async batchDelete(@Body() body: { ids?: number[] }, @Req() req: RequestWithUser) {
    const ids = (body?.ids ?? []).map(Number)
    const deleted = this.cases.removeMany(ids)
    await this.audit.log({
      userId: req.user?.id, userName: req.user?.username, module: 'case', action: 'BATCH_DELETE',
      targetType: 'green_channel_case', detail: { requested: ids.length, deleted },
      ip: clientIp(req.headers, req.socket), ua: req.headers['user-agent'] as string,
    })
    return { deleted }
  }

  @Get()
  @RequirePerms(PERM.CASE_VIEW)
  list(@Query() query: Record<string, string>) {
    return this.cases.page(parseCaseQuery(query))
  }

  @Get(':id')
  @RequirePerms(PERM.CASE_VIEW)
  detail(@Param('id', ParseIntPipe) id: number) {
    return this.cases.detail(id)
  }

  @Post()
  @RequirePerms(PERM.CASE_CREATE)
  async create(@Body() body: CaseSaveRequest, @Req() req: RequestWithUser) {
    const id = this.cases.create(body, req.user?.id ?? null)
    await this.audit.log({
      userId: req.user?.id, userName: req.user?.username, module: 'case', action: 'CREATE',
      targetType: 'green_channel_case', targetId: id, detail: { diseaseCode: body.diseaseCode, sourceType: body.sourceType },
      ip: clientIp(req.headers, req.socket), ua: req.headers['user-agent'] as string,
    })
    this.events.caseChanged(id, true)
    return { id }
  }

  @Put(':id')
  @RequirePerms(PERM.CASE_UPDATE)
  async update(@Param('id', ParseIntPipe) id: number, @Body() body: CaseSaveRequest, @Req() req: RequestWithUser) {
    const before = this.cases.detail(id)
    this.cases.update(id, body, req.user?.id ?? null)
    await this.audit.log({
      userId: req.user?.id, userName: req.user?.username, module: 'case', action: 'UPDATE',
      targetType: 'green_channel_case', targetId: id,
      detail: { changed: Object.keys(body), caseNo: before.caseNo },
      ip: clientIp(req.headers, req.socket), ua: req.headers['user-agent'] as string,
    })
    this.events.caseChanged(id)
    return { id }
  }

  @Delete(':id')
  @RequirePerms(PERM.CASE_DELETE)
  async remove(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithUser) {
    const before = this.cases.detail(id)
    this.cases.remove(id)
    await this.audit.log({
      userId: req.user?.id, userName: req.user?.username, module: 'case', action: 'DELETE',
      targetType: 'green_channel_case', targetId: id, detail: { caseNo: before.caseNo },
      ip: clientIp(req.headers, req.socket), ua: req.headers['user-agent'] as string,
    })
    this.events.caseChanged(id)
    return { id }
  }

  @Post(':id/events')
  @RequirePerms(PERM.CASE_EVENT)
  async addEvent(@Param('id', ParseIntPipe) id: number, @Body() body: CaseEventSaveRequest, @Req() req: RequestWithUser) {
    const events = this.cases.addEvent(id, body, req.user?.id ?? null)
    await this.audit.log({
      userId: req.user?.id, userName: req.user?.username, module: 'case', action: 'EVENT',
      targetType: 'green_channel_case', targetId: id, detail: body,
      ip: clientIp(req.headers, req.socket), ua: req.headers['user-agent'] as string,
    })
    this.events.caseChanged(id)
    return events
  }

  @Post(':id/close')
  @RequirePerms(PERM.CASE_UPDATE)
  async close(@Param('id', ParseIntPipe) id: number, @Body() body: { closedAt?: string; remark?: string }, @Req() req: RequestWithUser) {
    this.cases.close(id, optionalDateTime(body?.closedAt, '闭环时间'), optionalString(body?.remark, '闭环说明', 200), req.user?.id ?? null)
    await this.audit.log({
      userId: req.user?.id, userName: req.user?.username, module: 'case', action: 'CLOSE',
      targetType: 'green_channel_case', targetId: id, detail: { remark: body?.remark },
      ip: clientIp(req.headers, req.socket), ua: req.headers['user-agent'] as string,
    })
    this.events.caseChanged(id)
    return { id }
  }

  @Post(':id/attachments')
  @RequirePerms(PERM.CASE_UPDATE)
  @UseInterceptors(
    FileInterceptor('file', {
      // 内存接收后自行落盘：避免直接依赖 multer 的磁盘引擎（pnpm 严格依赖布局下更稳）
      limits: { fileSize: 20 * 1024 * 1024 },
    }),
  )
  async upload(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: { originalname: string; mimetype: string; size: number; buffer: Buffer },
    @Req() req: RequestWithUser,
  ) {
    if (!file?.buffer) throw new Error('未接收到文件')
    if (!existsSync(config.uploadDir)) mkdirSync(config.uploadDir, { recursive: true })
    const storedName = `${Date.now()}-${randomBytes(4).toString('hex')}${extname(file.originalname)}`
    writeFileSync(join(config.uploadDir, storedName), file.buffer)
    const attachId = this.cases.addAttachment(
      id,
      { originalname: file.originalname, filename: storedName, size: file.size ?? file.buffer.length, mimetype: file.mimetype },
      req.user?.id ?? null,
    )
    await this.audit.log({
      userId: req.user?.id, userName: req.user?.username, module: 'case', action: 'UPLOAD',
      targetType: 'case_attachment', targetId: attachId, detail: { caseId: id, fileName: file?.originalname },
      ip: clientIp(req.headers, req.socket), ua: req.headers['user-agent'] as string,
    })
    return { id: attachId }
  }
}

/** 把 query string 归一化成 CaseQuery */
function parseCaseQuery(query: Record<string, string>): CaseQuery {
  const isClosed = query.isClosed
  return {
    page: Number(query.page) || 1,
    pageSize: Number(query.pageSize) || 20,
    sort: query.sort,
    keyword: query.keyword?.trim() || undefined,
    diseaseCode: query.diseaseCode || undefined,
    sourceType: query.sourceType || undefined,
    statusCode: query.statusCode || undefined,
    deptId: query.deptId ? Number(query.deptId) : undefined,
    isClosed: isClosed === undefined || isClosed === '' ? undefined : isClosed === 'true' || isClosed === '1',
    from: query.from || undefined,
    to: query.to || undefined,
  }
}
