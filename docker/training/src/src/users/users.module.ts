import { Module } from '@nestjs/common'
import { PrismaModule } from '../prisma/prisma.module'
import { StatsModule } from '../stats/stats.module'
import { UsersController } from './users.controller'
import { UsersService } from './users.service'

@Module({
  imports: [PrismaModule, StatsModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
