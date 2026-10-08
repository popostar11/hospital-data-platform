import { Global, Module } from '@nestjs/common'
import { AuditService } from './audit.service'
import { DomainEvents } from './events.service'

/** 全局基础设施模块：审计、领域事件等横切服务 */
@Global()
@Module({
  providers: [AuditService, DomainEvents],
  exports: [AuditService, DomainEvents],
})
export class CoreModule {}
