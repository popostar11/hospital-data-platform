import { Module } from '@nestjs/common'
import { CaseModule } from '../case/case.module'
import { DictModule } from '../dict/dict.module'
import { DashboardController, ReportController } from './report.controller'
import { ReportService } from './report.service'

@Module({
  imports: [DictModule, CaseModule],
  controllers: [ReportController, DashboardController],
  providers: [ReportService],
  exports: [ReportService],
})
export class ReportModule {}
