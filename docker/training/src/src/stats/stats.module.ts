import { Module } from '@nestjs/common'
import { StatsController } from './stats.controller'
import { StatsService } from './stats.service'
import { BusinessProfileService } from './business-profile.service'

@Module({
  controllers: [StatsController],
  providers: [StatsService, BusinessProfileService],
  exports: [StatsService, BusinessProfileService],
})
export class StatsModule {}
