import { Module } from '@nestjs/common'
import { ScheduleModule } from '@nestjs/schedule'
import { PrismaModule } from '../prisma/prisma.module'
import { ConfigModule } from '../config/config.module'
import { LevelController } from './level.controller'
import { LevelService } from './level.service'

@Module({
  imports: [PrismaModule, ConfigModule, ScheduleModule.forRoot()],
  controllers: [LevelController],
  providers: [LevelService],
  exports: [LevelService],
})
export class LevelModule {}