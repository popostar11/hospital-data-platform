import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query, Req } from '@nestjs/common'
import { PERM } from '@hospital/shared'
import { RequirePerms } from '../../common/auth'
import type { RequestWithUser } from '../../common/api'
import { clientIp } from '../../common/validate'
import { AuditService } from '../../core/audit.service'
import { DictService } from './dict.service'

@Controller('dicts')
export class DictController {
  constructor(
    private readonly dict: DictService,
    private readonly audit: AuditService,
  ) {}

  /** 字典列表；type 省略时返回全部（字典管理页） */
  @Get()
  @RequirePerms(PERM.DICT_VIEW)
  list(@Query('type') type?: string, @Query('withRef') withRef?: string) {
    const rows = this.dict.page(type, true)
    return withRef === '1' ? this.dict.withRefCount(rows) : rows
  }

  @Post()
  @RequirePerms(PERM.DICT_UPDATE)
  async create(@Body() body: Record<string, unknown>, @Req() req: RequestWithUser) {
    const row = this.dict.create(body)
    await this.audit.log({
      userId: req.user?.id, userName: req.user?.username, module: 'dict', action: 'CREATE',
      targetType: row.type, targetId: row.id, detail: { code: row.code, name: row.name },
      ip: clientIp(req.headers, req.socket), ua: req.headers['user-agent'] as string,
    })
    return row
  }

  @Put(':id')
  @RequirePerms(PERM.DICT_UPDATE)
  async update(@Param('id', ParseIntPipe) id: number, @Body() body: Record<string, unknown>, @Req() req: RequestWithUser) {
    const row = this.dict.update(id, body)
    await this.audit.log({
      userId: req.user?.id, userName: req.user?.username, module: 'dict', action: 'UPDATE',
      targetType: row.type, targetId: row.id, detail: body,
      ip: clientIp(req.headers, req.socket), ua: req.headers['user-agent'] as string,
    })
    return row
  }

  @Delete(':id')
  @RequirePerms(PERM.DICT_UPDATE)
  async remove(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithUser) {
    const before = this.dict.page().find((d) => d.id === id)
    this.dict.remove(id)
    await this.audit.log({
      userId: req.user?.id, userName: req.user?.username, module: 'dict', action: 'DELETE',
      targetType: before?.type ?? 'dict', targetId: id, detail: before,
      ip: clientIp(req.headers, req.socket), ua: req.headers['user-agent'] as string,
    })
    return { id }
  }
}
