import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common'
import { PERM, type CaseSaveRequest } from '@hospital/shared'
import { Public, RequirePerms } from '../../common/auth'
import { ApiException, type RequestWithUser } from '../../common/api'
import { clientIp } from '../../common/validate'
import { config } from '../../config'
import { now, type Db } from '../../db/sqlite'
import { InjectDb } from '../../db/db.module'
import { AuditService } from '../../core/audit.service'
import { DomainEvents } from '../../core/events.service'
import { CaseService } from '../case/case.service'
import { hmacLike } from '../../common/crypto'

/**
 * 外部系统对接（HIS / 120 指挥中心 / 急诊分诊）。
 *
 * 生产要求：HMAC-SHA256 签名 + IP 白名单 + 幂等键；
 * 演示模式（DEMO_MODE=true）放行，便于对接方联调。
 */
@Controller()
export class IntegrationController {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly cases: CaseService,
    private readonly audit: AuditService,
    private readonly events: DomainEvents,
  ) {}

  @Get('integrations/logs')
  @RequirePerms(PERM.INTEGRATION_VIEW)
  logs(@Query() query: Record<string, string>) {
    const page = Math.max(1, Number(query.page) || 1)
    const pageSize = Math.min(200, Math.max(1, Number(query.pageSize) || 20))
    const where: string[] = ['1=1']
    const params: (string | number)[] = []
    if (query.source) {
      where.push('source = ?')
      params.push(query.source)
    }
    if (query.success === 'true' || query.success === 'false') {
      where.push('success = ?')
      params.push(query.success === 'true' ? 1 : 0)
    }
    if (query.from) {
      where.push('created_at >= ?')
      params.push(`${query.from} 00:00:00`)
    }
    if (query.to) {
      where.push('created_at <= ?')
      params.push(`${query.to} 23:59:59`)
    }
    const clause = where.join(' AND ')
    const total = this.db.scalar<number>(`SELECT COUNT(*) FROM integration_log WHERE ${clause}`, params) ?? 0
    const list = this.db.all(
      `SELECT id, source, direction, endpoint, biz_id AS bizId, success, message, created_at AS createdAt
         FROM integration_log WHERE ${clause} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, (page - 1) * pageSize],
    )
    return { list, total, page, pageSize }
  }

  /** 开放接口：外部系统推送一条绿道病例 */
  @Post('open/cases')
  @Public()
  async pushCase(
    @Body() body: CaseSaveRequest & { idemKey?: string; source?: string; sign?: string; timestamp?: string },
    @Req() req: RequestWithUser,
  ) {
    const source = String(body?.source ?? 'HIS')
    const ip = clientIp(req.headers, req.socket)

    if (!config.demoMode) {
      const sign = String(body?.sign ?? '')
      const timestamp = String(body?.timestamp ?? '')
      if (!sign || !timestamp) {
        await this.logIntegration(source, ip, null, false, '缺少签名或时间戳')
        throw ApiException.forbidden('缺少签名或时间戳')
      }
      const skew = Math.abs(Date.now() - Number(timestamp))
      if (!Number.isFinite(skew) || skew > 5 * 60 * 1000) {
        await this.logIntegration(source, ip, null, false, '时间戳超出允许范围')
        throw ApiException.forbidden('时间戳超出允许范围')
      }
      const expected = hmacLike(`${timestamp}.${JSON.stringify(body ?? {})}`, config.cryptoKey)
      if (expected !== sign) {
        await this.logIntegration(source, ip, null, false, '签名校验失败')
        throw ApiException.forbidden('签名校验失败')
      }
    }

    const idemKey = body?.idemKey ? String(body.idemKey) : null
    if (idemKey) {
      const hit = this.db.get<{ caseId: number | null }>('SELECT case_id AS caseId FROM open_api_idempotent WHERE idem_key = ?', [idemKey])
      if (hit) return { id: hit.caseId, idempotent: true }
    }

    try {
      const id = this.cases.create(body, null)
      if (idemKey) {
        this.db.run('INSERT OR REPLACE INTO open_api_idempotent (idem_key, case_id, created_at) VALUES (?, ?, ?)', [idemKey, id, now()])
      }
      await this.logIntegration(source, ip, String(id), true, '接收成功')
      this.events.caseChanged(id, true)
      return { id }
    } catch (e) {
      const message = e instanceof Error ? e.message : '未知错误'
      await this.logIntegration(source, ip, null, false, message)
      throw e
    }
  }

  private async logIntegration(source: string, ip: string, bizId: string | null, success: boolean, message: string): Promise<void> {
    this.db.insert('integration_log', {
      source,
      direction: 'IN',
      endpoint: '/api/v1/open/cases',
      biz_id: bizId,
      success: success ? 1 : 0,
      message,
      payload: JSON.stringify({ ip }),
      created_at: now(),
    })
    await this.audit.log({
      module: 'integration',
      action: success ? 'RECEIVE' : 'RECEIVE_FAIL',
      targetType: 'green_channel_case',
      targetId: bizId,
      detail: { source, message },
      ip,
    })
  }
}
