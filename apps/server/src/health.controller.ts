import { Controller, Get } from '@nestjs/common'
import { Public } from './common/auth'
import { config } from './config'

/** 健康检查与运行信息（供部署探活、大屏终端首屏探测） */
@Controller()
export class HealthController {
  @Get('health')
  @Public()
  health() {
    return {
      status: 'ok',
      serverTime: new Date().toISOString(),
      demoMode: config.demoMode,
      captchaEnabled: config.captchaEnabled,
      version: '0.1.0',
    }
  }
}
