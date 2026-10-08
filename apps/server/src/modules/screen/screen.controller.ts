import { Body, Controller, Get, Param, Put, Query, Req, Res } from '@nestjs/common'
import type { Response } from 'express'
import { PERM } from '@hospital/shared'
import { RequirePerms, ScreenEndpoint } from '../../common/auth'
import { clientIp } from '../../common/validate'
import type { RequestWithUser } from '../../common/api'
import { AuditService } from '../../core/audit.service'
import { DomainEvents } from '../../core/events.service'
import { ScreenService } from './screen.service'

/**
 * 大屏只读接口。
 * 演示模式下允许匿名访问；生产（DEMO_MODE=false）必须携带有效令牌。
 * 无论哪种方式，返回的姓名等字段都已在服务端完成脱敏。
 */
@Controller('screen')
export class ScreenController {
  constructor(
    private readonly screen: ScreenService,
    private readonly events: DomainEvents,
  ) {}

  /** 整屏数据一次返回（大屏首屏与轮询刷新共用） */
  @Get('bootstrap')
  @ScreenEndpoint()
  bootstrap(@Query('screenCode') screenCode?: string, @Query('force') force?: string) {
    return this.screen.bootstrap(screenCode || 'main', force === '1')
  }

  @Get('config')
  @ScreenEndpoint()
  config(@Query('screenCode') screenCode?: string) {
    return this.screen.runtimeConfig(screenCode || 'main')
  }

  /**
   * SSE 推送：只推「数据变了」的信号，前端收到后自行拉取 bootstrap。
   * 相比 WebSocket，纯 HTTP 更容易通过医院网络设备，且浏览器原生支持断线重连。
   */
  @Get('stream')
  @ScreenEndpoint()
  stream(@Req() req: RequestWithUser, @Res() res: Response) {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache, no-transform')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')
    res.setHeader('x-raw-response', '1')
    res.flushHeaders?.()
    res.write('retry: 3000\n\n')

    const sub = this.events.stream$.subscribe((event) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`)
    })
    // 心跳：防止中间设备断开空闲连接
    const heartbeat = setInterval(() => {
      res.write(`data: ${JSON.stringify({ type: 'ping', at: new Date().toISOString() })}\n\n`)
    }, 25000)

    req.on('close', () => {
      clearInterval(heartbeat)
      sub.unsubscribe()
      res.end()
    })
  }
}

/** 大屏配置管理（后台） */
@Controller('screen-configs')
export class ScreenConfigController {
  constructor(
    private readonly screen: ScreenService,
    private readonly audit: AuditService,
    private readonly events: DomainEvents,
  ) {}

  @Get()
  @RequirePerms(PERM.SCREEN_CONFIG_VIEW)
  list() {
    return this.screen.listConfigs()
  }

  @Put(':screenCode')
  @RequirePerms(PERM.SCREEN_CONFIG_UPDATE)
  async update(@Param('screenCode') screenCode: string, @Body() body: Record<string, unknown>, @Req() req: RequestWithUser) {
    const before = this.screen.getConfig(screenCode)
    const data = this.screen.updateConfig(screenCode, body, req.user?.id ?? null)
    await this.audit.log({
      userId: req.user?.id,
      userName: req.user?.username,
      module: 'screen-config',
      action: 'UPDATE',
      targetType: 'screen_config',
      targetId: screenCode,
      detail: { before: { ...before }, after: body },
      ip: clientIp(req.headers, req.socket),
      ua: req.headers['user-agent'] as string,
    })
    // 配置变更后通知大屏立即重载（无需等待轮询周期）
    this.events.emit({ type: 'stats.changed', at: new Date().toISOString() })
    return data
  }
}
