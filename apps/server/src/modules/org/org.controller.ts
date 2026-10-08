import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query, Req } from '@nestjs/common'
import { PERM, type UserSaveRequest } from '@hospital/shared'
import { CurrentUser, RequirePerms } from '../../common/auth'
import type { RequestWithUser } from '../../common/api'
import { clientIp, requiredString } from '../../common/validate'
import { AuditService } from '../../core/audit.service'
import { OrgService } from './org.service'

@Controller()
export class OrgController {
  constructor(
    private readonly org: OrgService,
    private readonly audit: AuditService,
  ) {}

  /* ----------------------------------------------------------- 科室 */

  @Get('departments')
  @RequirePerms(PERM.ORG_VIEW)
  departments() {
    return this.org.departmentTree()
  }

  @Post('departments')
  @RequirePerms(PERM.ORG_UPDATE)
  async createDepartment(@Body() body: Record<string, unknown>, @Req() req: RequestWithUser) {
    const id = this.org.createDepartment(body)
    await this.audit.log({
      userId: req.user?.id, userName: req.user?.username, module: 'org', action: 'CREATE_DEPT',
      targetType: 'department', targetId: id, detail: body,
      ip: clientIp(req.headers, req.socket), ua: req.headers['user-agent'] as string,
    })
    return { id }
  }

  @Put('departments/:id')
  @RequirePerms(PERM.ORG_UPDATE)
  async updateDepartment(@Param('id', ParseIntPipe) id: number, @Body() body: Record<string, unknown>, @Req() req: RequestWithUser) {
    this.org.updateDepartment(id, body)
    await this.audit.log({
      userId: req.user?.id, userName: req.user?.username, module: 'org', action: 'UPDATE_DEPT',
      targetType: 'department', targetId: id, detail: body,
      ip: clientIp(req.headers, req.socket), ua: req.headers['user-agent'] as string,
    })
    return { id }
  }

  @Delete('departments/:id')
  @RequirePerms(PERM.ORG_UPDATE)
  async removeDepartment(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithUser) {
    this.org.removeDepartment(id)
    await this.audit.log({
      userId: req.user?.id, userName: req.user?.username, module: 'org', action: 'DELETE_DEPT',
      targetType: 'department', targetId: id,
      ip: clientIp(req.headers, req.socket), ua: req.headers['user-agent'] as string,
    })
    return { id }
  }

  /* ----------------------------------------------------------- 用户 */

  @Get('users')
  @RequirePerms(PERM.ORG_VIEW)
  users(@Query() query: Record<string, string>) {
    return this.org.pageUsers({
      page: Number(query.page) || 1,
      pageSize: Number(query.pageSize) || 20,
      keyword: query.keyword,
      deptId: query.deptId ? Number(query.deptId) : undefined,
      enabled: query.enabled === undefined || query.enabled === '' ? undefined : query.enabled === 'true' || query.enabled === '1',
      sort: query.sort,
    })
  }

  @Post('users')
  @RequirePerms(PERM.ORG_UPDATE)
  async createUser(@Body() body: UserSaveRequest, @Req() req: RequestWithUser) {
    const id = this.org.createUser(body)
    await this.audit.log({
      userId: req.user?.id, userName: req.user?.username, module: 'org', action: 'CREATE_USER',
      targetType: 'sys_user', targetId: id, detail: { username: body.username, roles: body.roleCodes },
      ip: clientIp(req.headers, req.socket), ua: req.headers['user-agent'] as string,
    })
    return { id }
  }

  @Put('users/:id')
  @RequirePerms(PERM.ORG_UPDATE)
  async updateUser(@Param('id', ParseIntPipe) id: number, @Body() body: UserSaveRequest, @Req() req: RequestWithUser) {
    this.org.updateUser(id, body)
    await this.audit.log({
      userId: req.user?.id, userName: req.user?.username, module: 'org', action: 'UPDATE_USER',
      targetType: 'sys_user', targetId: id, detail: { fields: Object.keys(body) },
      ip: clientIp(req.headers, req.socket), ua: req.headers['user-agent'] as string,
    })
    return { id }
  }

  @Delete('users/:id')
  @RequirePerms(PERM.ORG_UPDATE)
  async removeUser(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: RequestWithUser['user'], @Req() req: RequestWithUser) {
    this.org.removeUser(id, user?.id ?? null)
    await this.audit.log({
      userId: user?.id, userName: user?.username, module: 'org', action: 'DELETE_USER',
      targetType: 'sys_user', targetId: id,
      ip: clientIp(req.headers, req.socket), ua: req.headers['user-agent'] as string,
    })
    return { id }
  }

  @Post('users/:id/reset-password')
  @RequirePerms(PERM.ORG_UPDATE)
  async resetPassword(@Param('id', ParseIntPipe) id: number, @Body() body: { password?: string }, @Req() req: RequestWithUser) {
    const password = requiredString(body?.password, '新密码', 64)
    this.org.resetPassword(id, password)
    await this.audit.log({
      userId: req.user?.id, userName: req.user?.username, module: 'org', action: 'RESET_PASSWORD',
      targetType: 'sys_user', targetId: id,
      ip: clientIp(req.headers, req.socket), ua: req.headers['user-agent'] as string,
    })
    return { id }
  }

  @Get('roles')
  @RequirePerms(PERM.ORG_VIEW)
  roles() {
    return this.org.listRoles()
  }

  @Get('departments/flat')
  @RequirePerms(PERM.CASE_VIEW)
  departmentsFlat() {
    return this.org.departmentFlat()
  }
}
