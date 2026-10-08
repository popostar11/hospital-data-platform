import { Body, Controller, Get, Post, Req } from '@nestjs/common'
import type { LoginRequest } from '@hospital/shared'
import { CurrentUser, Public } from '../../common/auth'
import { ApiException, type RequestWithUser } from '../../common/api'
import { clientIp, requiredString } from '../../common/validate'
import { AuditService } from '../../core/audit.service'
import { AuthService } from './auth.service'

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly audit: AuditService,
  ) {}

  @Get('captcha')
  @Public()
  captcha() {
    return this.auth.captcha()
  }

  @Post('login')
  @Public()
  login(@Body() body: LoginRequest, @Req() req: RequestWithUser) {
    return this.auth.login({
      username: String(body?.username ?? '').trim(),
      password: String(body?.password ?? ''),
      captchaId: body?.captchaId,
      captchaCode: body?.captchaCode,
      ip: clientIp(req.headers, req.socket),
      ua: req.headers['user-agent'] as string,
    })
  }

  @Post('refresh')
  @Public()
  refresh(@Body() body: { refreshToken?: string }) {
    return this.auth.refresh(String(body?.refreshToken ?? ''))
  }

  @Post('logout')
  async logout(@Req() req: RequestWithUser) {
    await this.audit.log({
      userId: req.user?.id,
      userName: req.user?.username,
      module: 'auth',
      action: 'LOGOUT',
      ip: clientIp(req.headers, req.socket),
      ua: req.headers['user-agent'] as string,
    })
    return { ok: true }
  }

  @Get('me')
  me(@CurrentUser() user: RequestWithUser['user']) {
    if (!user) throw new ApiException(40100)
    return this.auth.me(user.id)
  }

  @Post('change-password')
  async changePassword(
    @Body() body: { oldPassword?: string; newPassword?: string },
    @CurrentUser() user: RequestWithUser['user'],
    @Req() req: RequestWithUser,
  ) {
    if (!user) throw new ApiException(40100)
    const newPassword = requiredString(body?.newPassword, '新密码', 64)
    this.auth.changePassword(user.id, String(body?.oldPassword ?? ''), newPassword)
    await this.audit.log({
      userId: user.id,
      userName: user.username,
      module: 'auth',
      action: 'CHANGE_PASSWORD',
      targetType: 'sys_user',
      targetId: user.id,
      ip: clientIp(req.headers, req.socket),
      ua: req.headers['user-agent'] as string,
    })
    return { ok: true }
  }
}
