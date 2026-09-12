import { Controller, Get, Post, Patch, Delete, Param, Query, Body, Req, NotFoundException, UseGuards } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger'
import { CoursesService } from './courses.service'
import { AdminGuard } from '../auth/guards/admin.guard'
import {
  QueryCoursesDto,
  CourseListResponseDto,
  CourseResponseDto,
  CreateCourseDto,
  UpdateCourseDto,
} from './dto/course.dto'

@ApiTags('课程')
@Controller('courses')
export class CoursesController {
  constructor(private readonly coursesService: CoursesService) {}

  @Get()
  @ApiOperation({ summary: '获取课程列表（支持按阶段过滤）' })
  @ApiResponse({ status: 200, type: CourseListResponseDto })
  async findAll(@Query() query: QueryCoursesDto, @Req() req: any) {
    const userId = req.user?.userId || 'anonymous'
    const result = await this.coursesService.findAll(query, userId)
    return {
      success: true,
      data: result.courses,
      meta: { total: result.total },
    }
  }

  @Get(':id')
  @ApiOperation({ summary: '获取单门课程详情' })
  @ApiResponse({ status: 200, type: CourseResponseDto })
  @ApiResponse({ status: 404, description: '课程不存在' })
  async findOne(@Param('id') id: string, @Req() req: any) {
    const userId = req.user?.userId || 'anonymous'
    const course = await this.coursesService.findOne(id, userId)
    if (!course) {
      throw new NotFoundException(`课程 ${id} 不存在`)
    }
    return { success: true, data: course }
  }

  @Post()
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: '创建课程（仅管理员，可附带课件）' })
  @ApiResponse({ status: 200, type: CourseResponseDto })
  @ApiResponse({ status: 403, description: '需要管理员权限' })
  async create(@Body() dto: CreateCourseDto) {
    const course = await this.coursesService.create(dto)
    return { success: true, data: course }
  }

  @Patch(':id')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: '更新课程（仅管理员，materials 传入时全量重建）' })
  @ApiResponse({ status: 200, type: CourseResponseDto })
  @ApiResponse({ status: 403, description: '需要管理员权限' })
  @ApiResponse({ status: 404, description: '课程不存在' })
  async update(@Param('id') id: string, @Body() dto: UpdateCourseDto) {
    const course = await this.coursesService.update(id, dto)
    return { success: true, data: course }
  }

  @Delete(':id')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: '删除课程（仅管理员，课件级联删除）' })
  @ApiResponse({ status: 200, description: '删除成功' })
  @ApiResponse({ status: 403, description: '需要管理员权限' })
  @ApiResponse({ status: 404, description: '课程不存在' })
  async remove(@Param('id') id: string) {
    await this.coursesService.remove(id)
    return { success: true }
  }
}
