import { Injectable } from '@nestjs/common'
import { Subject } from 'rxjs'
import type { ScreenStreamEvent } from '@hospital/shared'

/**
 * 领域事件总线：病例变更 → 大屏 SSE 推送信号。
 * 只推「变了」这个事实，不带业务数据，前端收到后按需拉取，
 * 避免把患者信息广播到所有大屏连接上。
 */
@Injectable()
export class DomainEvents {
  private readonly subject = new Subject<ScreenStreamEvent>()

  readonly stream$ = this.subject.asObservable()

  emit(event: ScreenStreamEvent): void {
    this.subject.next(event)
  }

  caseChanged(caseId: number, created = false): void {
    const at = new Date().toISOString()
    this.emit(created ? { type: 'case.created', caseId, at } : { type: 'case.updated', caseId, at })
    this.emit({ type: 'stats.changed', at })
  }

  ping(): void {
    this.emit({ type: 'ping', at: new Date().toISOString() })
  }
}
