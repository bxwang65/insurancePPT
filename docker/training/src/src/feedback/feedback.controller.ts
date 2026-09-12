import { Controller, Post, Get, Body, Param, Headers, BadRequestException } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger'
import { FeedbackService } from './feedback.service'
import { CreateFeedbackDto, FeedbackResponseDto, FeedbackListResponseDto } from './dto/feedback.dto'

@ApiTags('课程反馈')
@Controller('feedback')
export class FeedbackController {
  constructor(private readonly feedbackService: FeedbackService) {}

  @Post()
  @ApiOperation({ summary: '提交课程反馈（点赞 + 星级评价）' })
  @ApiResponse({ status: 201, type: FeedbackResponseDto })
  async create(
    @Headers('x-user-id') userId: string,
    @Body() dto: CreateFeedbackDto,
  ) {
    if (!userId) {
      throw new BadRequestException('缺少 x-user-id 请求头')
    }

    const result = await this.feedbackService.create(userId, dto)
    return { success: true, data: result }
  }

  @Get('course/:courseId')
  @ApiOperation({ summary: '获取课程的所有反馈' })
  @ApiResponse({ status: 200, type: FeedbackListResponseDto })
  async findByCourse(@Param('courseId') courseId: string) {
    const result = await this.feedbackService.findByCourse(courseId)
    return { success: true, ...result }
  }
}
