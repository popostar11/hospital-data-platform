import { Module } from '@nestjs/common'
import { CaseModule } from '../case/case.module'
import { IntegrationController } from './integration.controller'

@Module({
  imports: [CaseModule],
  controllers: [IntegrationController],
})
export class IntegrationModule {}
