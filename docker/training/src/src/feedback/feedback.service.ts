import { Injectable, BadRequestException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { CreateFeedbackDto, FeedbackResponseDto, FeedbackListResponseDto } from './dto/feedback.dto'

@Injectable()
export class FeedbackService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * ============================================================
   * POST /api/feedback
   *
   * 点赞 + 星级评价
   * - 同一用户对同一课程只有一条记录（upsert）
   * ============================================================
   */
  async create(userId: string, dto: CreateFeedbackDto): Promise<FeedbackResponseDto> {
    const { courseId, rating, comment, liked } = dto

    // 校验课程是否存在
    const course = await this.prisma.course.findUnique({ where: { id: courseId } })
    if (!course) {
      throw new BadRequestException(`课程 ${courseId} 不存在`)
    }

    const feedback = await this.prisma.feedback.upsert({
      where: { user_id_course_id: { user_id: userId, course_id: courseId } },
      create: {
        user_id: userId,
        course_id: courseId,
        rating,
        comment,
        liked,
      },
      update: {
        rating,
        comment,
        liked,
      },
    })

    return {
      id: feedback.id,
      user_id: feedback.user_id,
      course_id: feedback.course_id,
      rating: feedback.rating,
      comment: feedback.comment ?? undefined,
      liked: feedback.liked,
      created_at: feedback.created_at.toISOString(),
    }
  }

  /**
   * 获取某课程的反馈列表
   */
  async findByCourse(courseId: string): Promise<FeedbackListResponseDto> {
    const list = await this.prisma.feedback.findMany({
      where: { course_id: courseId },
      orderBy: { created_at: 'desc' },
    })

    const total = list.length
    const avg_rating = total > 0
      ? Math.round((list.reduce((sum, f) => sum + f.rating, 0) / total) * 10) / 10
      : 0
    const like_count = list.filter((f) => f.liked).length

    return {
      feedback_list: list.map((f) => ({
        id: f.id,
        user_id: f.user_id,
        course_id: f.course_id,
        rating: f.rating,
        comment: f.comment ?? undefined,
        liked: f.liked,
        created_at: f.created_at.toISOString(),
      })),
      total,
      avg_rating,
      like_count,
    }
  }
}
