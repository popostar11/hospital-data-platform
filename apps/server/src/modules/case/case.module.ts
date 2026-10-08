import { Module } from '@nestjs/common'
import { DictModule } from '../dict/dict.module'
import { PatientModule } from '../patient/patient.module'
import { CaseController } from './case.controller'
import { CaseService } from './case.service'

@Module({
  imports: [DictModule, PatientModule],
  controllers: [CaseController],
  providers: [CaseService],
  exports: [CaseService],
})
export class CaseModule {}
