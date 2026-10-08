import { Controller, Get, Query } from '@nestjs/common'
import { PERM } from '@hospital/shared'
import { RequirePerms } from '../../common/auth'
import { AuditService } from '../../core/audit.service'

@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get('logs')
  @RequirePerms(PERM.AUDIT_VIEW)
  logs(@Query() query: Record<string, string>) {
    return this.audit.pageOperLogs({
      page: Number(query.page) || 1,
      pageSize: Number(query.pageSize) || 20,
      keyword: query.keyword,
      module: query.module,
      action: query.action,
      from: query.from,
      to: query.to,
    })
  }

  @Get('logins')
  @RequirePerms(PERM.AUDIT_VIEW)
  logins(@Query() query: Record<string, string>) {
    return this.audit.pageLoginLogs({
      page: Number(query.page) || 1,
      pageSize: Number(query.pageSize) || 20,
      keyword: query.keyword,
      success: query.success === undefined || query.success === '' ? undefined : query.success === 'true' || query.success === '1',
      from: query.from,
      to: query.to,
    })
  }
}
