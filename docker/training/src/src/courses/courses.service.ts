import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { QueryCoursesDto, CourseResponseDto, CreateCourseDto, UpdateCourseDto } from './dto/course.dto'
// 2026-08-31: Phase 5 - 注入 OssService 用于灰度切换
import { OssService } from '../upload/oss.service'

@Injectable()
export class CoursesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ossService: OssService,
  ) {}

  /**
   * 2026-08-31: Phase 5 灰度 - 把 /uploads/xxx 路径换成 OSS 签名 URL
   * - 仅当 stage 在 OSS_GRAY_STAGES 中
   * - OSS 不存在 (老时间戳等) 时自动 fallback 回原 URL
   */
  private async resolveMediaUrl(
    rawUrl: string | undefined,
    stage: string,
  ): Promise<string | undefined> {
    if (!rawUrl) return undefined
    if (!this.ossService.isGrayStage(stage)) return rawUrl
    const resolved = await this.ossService.resolveForGray(rawUrl)
    return resolved ?? rawUrl
  }

  /**
   * 获取课程列表
   * - 支持按 stage 过滤
   * - 关联当前用户的 progress_percentage
   * - 每门课程附带 materials 数组（管理后台读 materials.length 显示课件数）
   */
  async findAll(query: QueryCoursesDto, userId: string): Promise<{ courses: CourseResponseDto[]; total: number }> {
    const { stage } = query

    const where = stage ? { stage } : {}

    const courses = await this.prisma.course.findMany({
      where,
      orderBy: { created_at: 'desc' },
      include: {
        progress: {
          where: { user_id: userId },
          select: {
            progress_percentage: true,
            last_watched_at: true,
          },
        },
        materials: {
          orderBy: { created_at: 'asc' },
        },
      },
    })

    // 2026-08-31: Phase 5 灰度 - 视频 + 课件 URL 转 OSS 签名
    const mapped: CourseResponseDto[] = await Promise.all(courses.map(async (c) => ({
      id: c.id,
      title: c.title,
      cover_image: c.cover_image,
      stage: c.stage,
      stage_name: c.stage_name,
      duration_minutes: c.duration_minutes,
      description: c.description ?? undefined,
      video_url: await this.resolveMediaUrl(c.video_url ?? undefined, c.stage),
      progress_percentage: c.progress[0]?.progress_percentage ?? 0,
      last_watched_at: c.progress[0]?.last_watched_at?.toISOString(),
      materials: await Promise.all(c.materials.map(async (m) => ({
        id: m.id,
        title: m.title,
        file_url: (await this.resolveMediaUrl(m.file_url, c.stage)) ?? m.file_url,
        file_type: m.file_type,
        file_size: m.file_size ?? undefined,
        created_at: m.created_at.toISOString(),
      }))),
    })))

    return { courses: mapped, total: mapped.length }
  }

  /**
   * 根据 ID 获取单门课程
   * - 包含关联的课件列表 materials
   */
  async findOne(id: string, userId: string): Promise<CourseResponseDto | null> {
    const course = await this.prisma.course.findUnique({
      where: { id },
      include: {
        progress: {
          where: { user_id: userId },
          select: { progress_percentage: true, last_watched_at: true },
        },
        materials: {
          orderBy: { created_at: 'asc' },
        },
      },
    })

    if (!course) return null

    return {
      id: course.id,
      title: course.title,
      cover_image: course.cover_image,
      stage: course.stage,
      stage_name: course.stage_name,
      duration_minutes: course.duration_minutes,
      description: course.description ?? undefined,
      video_url: await this.resolveMediaUrl(course.video_url ?? undefined, course.stage),
      progress_percentage: course.progress[0]?.progress_percentage ?? 0,
      last_watched_at: course.progress[0]?.last_watched_at?.toISOString(),
      materials: await Promise.all(course.materials.map(async (m) => ({
        id: m.id,
        title: m.title,
        file_url: (await this.resolveMediaUrl(m.file_url, course.stage)) ?? m.file_url,
        file_type: m.file_type,
        file_size: m.file_size ?? undefined,
        created_at: m.created_at.toISOString(),
      }))),
    }
  }

  /**
   * 创建课程（AdminGuard 保护）
   * - 嵌套创建课件 materials
   * - 返回完整课程对象（含 materials）
   */
  async create(dto: CreateCourseDto): Promise<CourseResponseDto> {
    const { materials, ...courseData } = dto

    const course = await this.prisma.course.create({
      data: {
        ...courseData,
        // schema 中 cover_image 为必填，未提供时使用占位封面
        cover_image: courseData.cover_image || 'https://picsum.photos/280/160',
        materials: materials?.length
          ? {
              create: materials.map((m) => ({
                title: m.title,
                file_url: m.file_url,
                file_type: m.file_type,
                file_size: m.file_size,
              })),
            }
          : undefined,
      },
      include: {
        materials: { orderBy: { created_at: 'asc' } },
      },
    })

    return {
      id: course.id,
      title: course.title,
      cover_image: course.cover_image,
      stage: course.stage,
      stage_name: course.stage_name,
      duration_minutes: course.duration_minutes,
      description: course.description ?? undefined,
      video_url: await this.resolveMediaUrl(course.video_url ?? undefined, course.stage),
      progress_percentage: 0,
      materials: await Promise.all(course.materials.map(async (m) => ({
        id: m.id,
        title: m.title,
        file_url: (await this.resolveMediaUrl(m.file_url, course.stage)) ?? m.file_url,
        file_type: m.file_type,
        file_size: m.file_size ?? undefined,
        created_at: m.created_at.toISOString(),
      }))),
    }
  }

  /**
   * 更新课程（AdminGuard 保护）
   * - materials 传入时全量重建（事务内 deleteMany 旧课件 + createMany 新的）
   * - 不传 materials 则不动课件
   */
  async update(id: string, dto: UpdateCourseDto): Promise<CourseResponseDto> {
    const existing = await this.prisma.course.findUnique({ where: { id } })
    if (!existing) {
      throw new NotFoundException(`课程 ${id} 不存在`)
    }

    const { materials, ...courseData } = dto

    await this.prisma.$transaction(async (tx) => {
      try {
        await tx.course.update({
          where: { id },
          data: courseData,
        })
      } catch (error: any) {
        // 事务内并发删除竞态：记录不存在时 P2025 → 404
        if (error?.code === 'P2025') {
          throw new NotFoundException(`课程 ${id} 不存在`)
        }
        throw error
      }
      if (materials !== undefined) {
        await tx.courseMaterial.deleteMany({ where: { course_id: id } })
        if (materials.length > 0) {
          await tx.courseMaterial.createMany({
            data: materials.map((m) => ({
              course_id: id,
              title: m.title,
              file_url: m.file_url,
              file_type: m.file_type,
              file_size: m.file_size,
            })),
          })
        }
      }
    })

    const course = await this.prisma.course.findUnique({
      where: { id },
      include: { materials: { orderBy: { created_at: 'asc' } } },
    })

    if (!course) {
      throw new NotFoundException(`课程 ${id} 不存在`)
    }

    return {
      id: course.id,
      title: course.title,
      cover_image: course.cover_image,
      stage: course.stage,
      stage_name: course.stage_name,
      duration_minutes: course.duration_minutes,
      description: course.description ?? undefined,
      video_url: await this.resolveMediaUrl(course.video_url ?? undefined, course.stage),
      progress_percentage: 0,
      materials: await Promise.all(course.materials.map(async (m) => ({
        id: m.id,
        title: m.title,
        file_url: (await this.resolveMediaUrl(m.file_url, course.stage)) ?? m.file_url,
        file_type: m.file_type,
        file_size: m.file_size ?? undefined,
        created_at: m.created_at.toISOString(),
      }))),
    }
  }

  /**
   * 删除课程（AdminGuard 保护）
   * - schema 已配 onDelete: Cascade，课件/进度/反馈随课程级联删除
   */
  async remove(id: string): Promise<void> {
    try {
      await this.prisma.course.delete({ where: { id } })
    } catch (error: any) {
      if (error?.code === 'P2025') {
        throw new NotFoundException(`课程 ${id} 不存在`)
      }
      throw error
    }
  }
}
