import { MiddlewareConsumer, Module, type NestModule } from '@nestjs/common'
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core'
import { AllExceptionsFilter, ResponseInterceptor } from './common/api'
import { AuthGuard } from './common/auth'
import { TraceMiddleware } from './common/trace.middleware'
import { CoreModule } from './core/core.module'
import { DbModule } from './db/db.module'
import { HealthController } from './health.controller'
import { AuditModule } from './modules/audit/audit.module'
import { AuthModule } from './modules/auth/auth.module'
import { CaseModule } from './modules/case/case.module'
import { DictModule } from './modules/dict/dict.module'
import { IntegrationModule } from './modules/integration/integration.module'
import { OrgModule } from './modules/org/org.module'
import { PatientModule } from './modules/patient/patient.module'
import { ReportModule } from './modules/report/report.module'
import { ScreenModule } from './modules/screen/screen.module'

@Module({
  imports: [
    DbModule, // @Global：数据库
    CoreModule, // @Global：审计、领域事件
    AuthModule, // 认证（含全局 JwtModule）
    DictModule,
    PatientModule,
    CaseModule,
    ScreenModule,
    OrgModule,
    ReportModule,
    AuditModule,
    IntegrationModule,
  ],
  controllers: [HealthController],
  providers: [
    // 全局鉴权：默认全部接口需要登录，@Public / @ScreenEndpoint 显式放行
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Nest 11 使用 path-to-regexp v8：通配必须写成 {*path}，否则启动时会告警
    consumer.apply(TraceMiddleware).forRoutes('{*path}')
  }
}
