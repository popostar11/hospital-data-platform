import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query, Req } from '@nestjs/common'
import { PERM, type PatientSaveRequest } from '@hospital/shared'
import { RequirePerms } from '../../common/auth'
import { ApiException, type RequestWithUser } from '../../common/api'
import { clientIp } from '../../common/validate'
import { AuditService } from '../../core/audit.service'
import { PatientService } from './patient.service'

@Controller('patients')
export class PatientController {
  constructor(
    private readonly patients: PatientService,
    private readonly audit: AuditService,
  ) {}

  /** 注意：必须声明在 :id 之前，否则 search 会被当成 id */
  @Get('search')
  @RequirePerms(PERM.PATIENT_VIEW)
  search(@Query('keyword') keyword?: string) {
    return this.patients.search(keyword ?? '')
  }

  @Get()
  @RequirePerms(PERM.PATIENT_VIEW)
  list(@Query() query: Record<string, string>) {
    return this.patients.page({
      page: Number(query.page) || 1,
      pageSize: Number(query.pageSize) || 20,
      sort: query.sort,
      keyword: query.keyword,
    })
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
      targetType: 'patient', targetId: id, detail: { masked: patient.nameMasked },
      ip: clientIp(req.headers, req.socket), ua: req.headers['user-agent'] as string,
    })
    return { id }
  }
}
