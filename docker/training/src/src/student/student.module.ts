import { Module } from '@nestjs/common'
import { StudentController } from './student.controller'
import { StudentService } from './student.service'
import { ProgressModule } from '../progress/progress.module'
import { StatsModule } from '../stats/stats.module'
import { UsersModule } from '../users/users.module'

@Module({
  imports: [ProgressModule, StatsModule, UsersModule],
  controllers: [StudentController],
  providers: [StudentService],
  exports: [StudentService],
})
export class StudentModule {}
