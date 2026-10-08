import { Module } from '@nestjs/common'
import { CaseModule } from '../case/case.module'
import { DictModule } from '../dict/dict.module'
import { ScreenConfigController, ScreenController } from './screen.controller'
import { ScreenService } from './screen.service'

@Module({
  imports: [DictModule, CaseModule],
  controllers: [ScreenController, ScreenConfigController],
  providers: [ScreenService],
  exports: [ScreenService],
})
export class ScreenModule {}
