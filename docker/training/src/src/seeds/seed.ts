/**
 * 数据初始化脚本 - 融合以琳培训系统
 * 行业背景：国际高端保险与财富管理
 *
 * 视频路径：/uploads/videos/01.mp4 ~ 10.mp4
 *   - 容器内由 training-backend 通过 useStaticAssets('/uploads') 静态服务
 *   - Mac 本地由 docker/4in1/src/vite.config.js 的 /uploads 代理 → training-backend:3000
 *   - 生产 (ECS) nginx 需同步加 /uploads proxy → training-backend:3000 (本地 vite 已配)
 *   - 视频文件本身通过 bind-mount ./docker/training/data/uploads/videos → /app/uploads/videos
 *   - Mac 源文件 /Users/soldier/Desktop/4in1V5/git-repos/songshi-backend-prod/uploads/videos/
 *     用 hard-link 共享 inode (不复制 1.4 GB)
 *
 * 上传规则：
 *  - 有视频 + 有 PDF  → 视频和课件都上传（course_01 ~ course_10）
 *  - 有 PDF + 无视频  → 不上传（11-12 跳过）
 *
 * 2026-08-12: 走 4in1 IdP, 不再自建 phone+password 学员账号.
 *   - 删除 u_001 (陈墨然) + u_admin (13900000000) 旧账号 + 关联进度
 *   - 不再预占位 admin User 记录 — 让 4in1 真实 user (firebase_uid='SrlFST...')
 *     首次进 iframe 时由 JwtStrategy.validate → findOrCreateFromJwt 自然 upsert
 *   - 之前用 firebase_uid='dev-bypass-123' 占位是错的: dev-bypass.ts 实际签的 JWT
 *     用的是 4in1 users.json 里 123@qqq.com 的真实 firebaseUid (SrlFST...),
 *     dev-bypass-123 占位 + 真实 SrlFST 同时存在时, 第二次 upsert 会撞 email 唯一约束
 *   - courses / course_materials / level_config 全部保留 (无用户关联)
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const VIDEO_BASE = '/uploads/videos'
const PPT_BASE = '/Users/wangboxi/Downloads/新人班资料'

// ============================================================
// 10 节融合以琳培训课程（全部为新人训 ONBOARDING）
// ============================================================
const courses = [
  // ── 新人训 (ONBOARDING) ─────────────────────────────────
  {
    id: 'course_01',
    title: '第一讲《国际保险优势介绍》',
    cover_image: 'https://picsum.photos/280/160?random=ins01',
    video_url: VIDEO_BASE + '/01.mp4',
    stage: 'ONBOARDING',
    stage_name: '新人训',
    duration_minutes: 60,  // 2026-08-14: 由 ffprobe 实测 (旧硬编码 45)
    description: '系统解析国际保险的独特优势，帮助新人建立对香港保险的全面认知框架。',
  },
  {
    id: 'course_02',
    title: '第二讲《香港主要产品分类介绍》',
    cover_image: 'https://picsum.photos/280/160?random=ins02',
    video_url: VIDEO_BASE + '/02.mp4',
    stage: 'ONBOARDING',
    stage_name: '新人训',
    duration_minutes: 73,  // 2026-08-14: ffprobe 实测
    description: '详细介绍香港保险市场主要产品分类及各自特点。',
  },
  {
    id: 'course_03',
    title: '第三讲《香港保险安全性深度解析》',
    cover_image: 'https://picsum.photos/280/160?random=ins03',
    video_url: VIDEO_BASE + '/03.mp4',
    stage: 'ONBOARDING',
    stage_name: '新人训',
    duration_minutes: 62,  // 2026-08-14: ffprobe 实测
    description: '深度剖析香港保险的安全性机制，解答客户最关心的资金安全问题。',
  },
  // ── 新人训 (ONBOARDING) ─────────────────────────────────
  {
    id: 'course_04',
    title: '第四讲《香港储蓄险应用场景》',
    cover_image: 'https://picsum.photos/280/160?random=ins04',
    video_url: VIDEO_BASE + '/04.mp4',
    stage: 'ONBOARDING',
    stage_name: '新人训',
    duration_minutes: 54,  // 2026-08-14: ffprobe 实测
    description: '通过真实案例展示香港储蓄分红险在不同场景下的应用方法。',
  },
  {
    id: 'course_05',
    title: '第五讲《保险公司分红机制解读》',
    cover_image: 'https://picsum.photos/280/160?random=ins05',
    video_url: VIDEO_BASE + '/05.mp4',
    stage: 'ONBOARDING',
    stage_name: '新人训',
    duration_minutes: 48,  // 2026-08-14: ffprobe 实测
    description: '揭秘保险公司分红实现率的计算逻辑与历史表现。',
  },
  {
    id: 'course_06',
    title: '第六讲《2025分红实现率解读》',
    cover_image: 'https://picsum.photos/280/160?random=ins06',
    video_url: VIDEO_BASE + '/06.mp4',
    stage: 'ONBOARDING',
    stage_name: '新人训',
    duration_minutes: 53,  // 2026-08-14: ffprobe 实测
    description: '最新2025年各保险公司分红实现率全面解读。',
  },
  // ── 进阶训 (ADVANCEMENT) ───────────────────────────────
  {
    id: 'course_07',
    title: '第七讲《香港主推产品特点解析》',
    cover_image: 'https://picsum.photos/280/160?random=ins07',
    video_url: VIDEO_BASE + '/07.mp4',
    stage: 'ONBOARDING',
    stage_name: '新人训',
    duration_minutes: 72,  // 2026-08-14: ffprobe 实测 (旧硬编码 180)
    description: '香港市场主推保险产品特点深度解析，优劣势全面对比。',
  },
  {
    id: 'course_08',
    title: '第八讲《国际保险IUL产品解析》',
    cover_image: 'https://picsum.photos/280/160?random=ins08',
    video_url: VIDEO_BASE + '/08.mp4',
    stage: 'ONBOARDING',
    stage_name: '新人训',
    duration_minutes: 53,  // 2026-08-14: ffprobe 实测
    description: '人寿保险IUL基础概念及在国际保险中的应用。',
  },
  // 2026-08-14: course_09 (全球资产配置逻辑) + course_10 (美元信用重塑) 已下架
  //   新人训现为 8 节, PRODUCT 解锁阈值 50% → 需 4 节, TRANSFER 80% → 需 7 节
]

// ============================================================
// 2026-08-13: 产品训 (PRODUCT) 阶段课程
//   视频源: /Volumes/Elements SE/.../产品培训/* → 已 copy 到
//           ./docker/training/data/uploads/videos/product_NN.mp4 (12.3 GB)
//   课件 PDF/PPTX → ./docker/training/data/uploads/materials/product_NN.{pdf|pptx}
//   标题来自 folder 名 (strip 日期前缀), 时长由 ffprobe 实测
//   序号 12, 56 跳过 (no video / aggregate folder)
//   学员端解锁条件: 新人训 ≥ 50% (per STAGE_UNLOCK.PRODUCT)
// ============================================================
const productCourses = [

  {
    id: 'course_11',
    title: "全球视野下的保单配置-百慕大IUL实操案",
    cover_image: 'https://picsum.photos/280/160?random=prod11',
    video_url: VIDEO_BASE + '/product_01.mp4',
    stage: 'PRODUCT',
    stage_name: '产品训',
    duration_minutes: 39,
    description: "产品训: 全球视野下的保单配置-百慕大IUL实操案",
  },
  {
    id: 'course_12',
    title: "忠意启航创富",
    cover_image: 'https://picsum.photos/280/160?random=prod12',
    video_url: VIDEO_BASE + '/product_02.mp4',
    stage: 'PRODUCT',
    stage_name: '产品训',
    duration_minutes: 53,
    description: "产品训: 忠意启航创富",
  },
  {
    id: 'course_13',
    title: "周大福人寿上线，王炸新品闪Y传承",
    cover_image: 'https://picsum.photos/280/160?random=prod13',
    video_url: VIDEO_BASE + '/product_03.mp4',
    stage: 'PRODUCT',
    stage_name: '产品训',
    duration_minutes: 62,
    description: "产品训: 周大福人寿上线，王炸新品闪Y传承",
  },
  {
    id: 'course_14',
    title: "匠心传承储蓄计划2",
    cover_image: 'https://picsum.photos/280/160?random=prod14',
    video_url: VIDEO_BASE + '/product_04.mp4',
    stage: 'PRODUCT',
    stage_name: '产品训',
    duration_minutes: 64,
    description: "产品训: 匠心传承储蓄计划2",
  },
  {
    id: 'course_15',
    title: "重磅来袭周D福王者归来-匠X传承2",
    cover_image: 'https://picsum.photos/280/160?random=prod15',
    video_url: VIDEO_BASE + '/product_05.mp4',
    stage: 'PRODUCT',
    stage_name: '产品训',
    duration_minutes: 59,
    description: "产品训: 重磅来袭周D福王者归来-匠X传承2",
  },
  {
    id: 'course_16',
    title: "卷上加卷，领跑市场，万通富R千秋升级归来！",
    cover_image: 'https://picsum.photos/280/160?random=prod16',
    video_url: VIDEO_BASE + '/product_06.mp4',
    stage: 'PRODUCT',
    stage_name: '产品训',
    duration_minutes: 62,
    description: "产品训: 卷上加卷，领跑市场，万通富R千秋升级归来！",
  },
  {
    id: 'course_17',
    title: "绝冠市场：香港安盛2025年全新储蓄",
    cover_image: 'https://picsum.photos/280/160?random=prod17',
    video_url: VIDEO_BASE + '/product_07.mp4',
    stage: 'PRODUCT',
    stage_name: '产品训',
    duration_minutes: 64,
    description: "产品训: 绝冠市场：香港安盛2025年全新储蓄",
  },
  {
    id: 'course_18',
    title: "打破枷锁，友邦新品全面解析",
    cover_image: 'https://picsum.photos/280/160?random=prod18',
    video_url: VIDEO_BASE + '/product_08.mp4',
    stage: 'PRODUCT',
    stage_name: '产品训',
    duration_minutes: 43,
    description: "产品训: 打破枷锁，友邦新品全面解析",
  },
  {
    id: 'course_19',
    title: "实力保C 再上现象级产品",
    cover_image: 'https://picsum.photos/280/160?random=prod19',
    video_url: VIDEO_BASE + '/product_09.mp4',
    stage: 'PRODUCT',
    stage_name: '产品训',
    duration_minutes: 71,
    description: "产品训: 实力保C 再上现象级产品",
  },
  {
    id: 'course_20',
    title: "短缴快领新标杆，「提领皇者」盈J天下3年",
    cover_image: 'https://picsum.photos/280/160?random=prod20',
    video_url: VIDEO_BASE + '/product_10.mp4',
    stage: 'PRODUCT',
    stage_name: '产品训',
    duration_minutes: 59,
    description: "产品训: 短缴快领新标杆，「提领皇者」盈J天下3年",
  },
  {
    id: 'course_21',
    title: "启航再升级 创富赢未来",
    cover_image: 'https://picsum.photos/280/160?random=prod21',
    video_url: VIDEO_BASE + '/product_11.mp4',
    stage: 'PRODUCT',
    stage_name: '产品训',
    duration_minutes: 69,
    description: "产品训: 启航再升级 创富赢未来",
  },
  {
    id: 'course_22',
    title: "6.5%收益下轰动市场的新爆款产品",
    cover_image: 'https://picsum.photos/280/160?random=prod22',
    video_url: VIDEO_BASE + '/product_13.mp4',
    stage: 'PRODUCT',
    stage_name: '产品训',
    duration_minutes: 65,
    description: "产品训: 6.5%收益下轰动市场的新爆款产品",
  },
  {
    id: 'course_23',
    title: "保司角度6.5%收益政策解读 & 周D福产品策略",
    cover_image: 'https://picsum.photos/280/160?random=prod23',
    video_url: VIDEO_BASE + '/product_14.mp4',
    stage: 'PRODUCT',
    stage_name: '产品训',
    duration_minutes: 83,
    description: "产品训: 保司角度6.5%收益政策解读 & 周D福产品策略",
  },
  {
    id: 'course_24',
    title: "后7%时代的储蓄产品选择指南-part2",
    cover_image: 'https://picsum.photos/280/160?random=prod24',
    video_url: VIDEO_BASE + '/product_15.mp4',
    stage: 'PRODUCT',
    stage_name: '产品训',
    duration_minutes: 111,
    description: "产品训: 后7%时代的储蓄产品选择指南-part2",
  },
  {
    id: 'course_25',
    title: "财富稳健增值  颐享养老人生",
    cover_image: 'https://picsum.photos/280/160?random=prod25',
    video_url: VIDEO_BASE + '/product_16.mp4',
    stage: 'PRODUCT',
    stage_name: '产品训',
    duration_minutes: 71,
    description: "产品训: 财富稳健增值  颐享养老人生",
  },
  {
    id: 'course_26',
    title: "190 年低调巨头 再次「启航」：一份“时间复利+灵活传承”的双保障",
    cover_image: 'https://picsum.photos/280/160?random=prod26',
    video_url: VIDEO_BASE + '/product_17.mp4',
    stage: 'PRODUCT',
    stage_name: '产品训',
    duration_minutes: 61,
    description: "产品训: 190 年低调巨头 再次「启航」：一份“时间复利+灵活传承”的双保障",
  },
  {
    id: 'course_27',
    title: "后7%时代储蓄产品指南Part3——鼎峰IUL",
    cover_image: 'https://picsum.photos/280/160?random=prod27',
    video_url: VIDEO_BASE + '/product_18.mp4',
    stage: 'PRODUCT',
    stage_name: '产品训',
    duration_minutes: 111,
    description: "产品训: 后7%时代储蓄产品指南Part3——鼎峰IUL",
  },
  {
    id: 'course_28',
    title: "双重保底+无限回报！苏L世新产品重磅发布",
    cover_image: 'https://picsum.photos/280/160?random=prod28',
    video_url: VIDEO_BASE + '/product_19.mp4',
    stage: 'PRODUCT',
    stage_name: '产品训',
    duration_minutes: 128,
    description: "产品训: 双重保底+无限回报！苏L世新产品重磅发布",
  },
  {
    id: 'course_29',
    title: "新王诞生，周D福「飞Y·盛世」“动静双生”震撼来袭！",
    cover_image: 'https://picsum.photos/280/160?random=prod29',
    video_url: VIDEO_BASE + '/product_20.mp4',
    stage: 'PRODUCT',
    stage_name: '产品训',
    duration_minutes: 59,
    description: "产品训: 新王诞生，周D福「飞Y·盛世」“动静双生”震撼来袭！",
  },
  {
    id: 'course_30',
    title: "重磅升级！友B爱B航2全新来袭",
    cover_image: 'https://picsum.photos/280/160?random=prod30',
    video_url: VIDEO_BASE + '/product_21.mp4',
    stage: 'PRODUCT',
    stage_name: '产品训',
    duration_minutes: 65,
    description: "产品训: 重磅升级！友B爱B航2全新来袭",
  },
  {
    id: 'course_31',
    title: "安S「盛LII-至尊」重磅归来——拳拳盛意，百世之利",
    cover_image: 'https://picsum.photos/280/160?random=prod31',
    video_url: VIDEO_BASE + '/product_22.mp4',
    stage: 'PRODUCT',
    stage_name: '产品训',
    duration_minutes: 105,
    description: "产品训: 安S「盛LII-至尊」重磅归来——拳拳盛意，百世之利",
  },
  {
    id: 'course_32',
    title: "安全与增长的终极答案：揭秘「瑞J（尊尚版）」如何重塑储蓄险价值",
    cover_image: 'https://picsum.photos/280/160?random=prod32',
    video_url: VIDEO_BASE + '/product_23.mp4',
    stage: 'PRODUCT',
    stage_name: '产品训',
    duration_minutes: 89,
    description: "产品训: 安全与增长的终极答案：揭秘「瑞J（尊尚版）」如何重塑储蓄险价值",
  },
  {
    id: 'course_33',
    title: "提领之王再升级：市场最快登顶6.5%，极速回报新标杆！",
    cover_image: 'https://picsum.photos/280/160?random=prod33',
    video_url: VIDEO_BASE + '/product_24.mp4',
    stage: 'PRODUCT',
    stage_name: '产品训',
    duration_minutes: 53,
    description: "产品训: 提领之王再升级：市场最快登顶6.5%，极速回报新标杆！",
  },
  {
    id: 'course_34',
    title: "分红终身人寿全览",
    cover_image: 'https://picsum.photos/280/160?random=prod34',
    video_url: VIDEO_BASE + '/product_25.mp4',
    stage: 'PRODUCT',
    stage_name: '产品训',
    duration_minutes: 107,
    description: "产品训: 分红终身人寿全览",
  },
  {
    id: 'course_35',
    title: "破局而立：太B全新产品卷起港险市场新高度",
    cover_image: 'https://picsum.photos/280/160?random=prod35',
    video_url: VIDEO_BASE + '/product_26.mp4',
    stage: 'PRODUCT',
    stage_name: '产品训',
    duration_minutes: 66,
    description: "产品训: 破局而立：太B全新产品卷起港险市场新高度",
  },
  {
    id: 'course_36',
    title: "降息周期起步到信守明天 ——应对利率拐点，布局前瞻配置",
    cover_image: 'https://picsum.photos/280/160?random=prod36',
    video_url: VIDEO_BASE + '/product_27.mp4',
    stage: 'PRODUCT',
    stage_name: '产品训',
    duration_minutes: 67,
    description: "产品训: 降息周期起步到信守明天 ——应对利率拐点，布局前瞻配置",
  },
  {
    id: 'course_37',
    title: "香港储蓄险卷王对决！友B_安S_永M，谁才是真顶流？",
    cover_image: 'https://picsum.photos/280/160?random=prod37',
    video_url: VIDEO_BASE + '/product_28.mp4',
    stage: 'PRODUCT',
    stage_name: '产品训',
    duration_minutes: 73,
    description: "产品训: 香港储蓄险卷王对决！友B_安S_永M，谁才是真顶流？",
  },
  {
    id: 'course_38',
    title: "富卫内部培训",
    cover_image: 'https://picsum.photos/280/160?random=prod38',
    video_url: VIDEO_BASE + '/product_29.mp4',
    stage: 'PRODUCT',
    stage_name: '产品训',
    duration_minutes: 64,
    description: "产品训: 富卫内部培训",
  },
  {
    id: 'course_39',
    title: "保诚【信守明天】外部培训",
    cover_image: 'https://picsum.photos/280/160?random=prod39',
    video_url: VIDEO_BASE + '/product_30.mp4',
    stage: 'PRODUCT',
    stage_name: '产品训',
    duration_minutes: 61,
    description: "产品训: 保诚【信守明天】外部培训",
  },
  {
    id: 'course_40',
    title: "HK年金天花板",
    cover_image: 'https://picsum.photos/280/160?random=prod40',
    video_url: VIDEO_BASE + '/product_31.mp4',
    stage: 'PRODUCT',
    stage_name: '产品训',
    duration_minutes: 80,
    description: "产品训: HK年金天花板",
  },
  {
    id: 'course_41',
    title: "港版唯一期缴型IUL,只赚不赔",
    cover_image: 'https://picsum.photos/280/160?random=prod41',
    video_url: VIDEO_BASE + '/product_32.mp4',
    stage: 'PRODUCT',
    stage_name: '产品训',
    duration_minutes: 84,
    description: "产品训: 港版唯一期缴型IUL,只赚不赔",
  },
  {
    id: 'course_42',
    title: "6.5%时代趋势解读及资产配置策略",
    cover_image: 'https://picsum.photos/280/160?random=prod42',
    video_url: VIDEO_BASE + '/product_33.mp4',
    stage: 'PRODUCT',
    stage_name: '产品训',
    duration_minutes: 69,
    description: "产品训: 6.5%时代趋势解读及资产配置策略",
  },
  {
    id: 'course_43',
    title: "限高令后首款6.5%两年期缴产品，如意相伴享养老",
    cover_image: 'https://picsum.photos/280/160?random=prod43',
    video_url: VIDEO_BASE + '/product_34.mp4',
    stage: 'PRODUCT',
    stage_name: '产品训',
    duration_minutes: 73,
    description: "产品训: 限高令后首款6.5%两年期缴产品，如意相伴享养老",
  },
  {
    id: 'course_44',
    title: "连年收益，尽享优悠，解码国寿新产品—万里优悠！",
    cover_image: 'https://picsum.photos/280/160?random=prod44',
    video_url: VIDEO_BASE + '/product_35.mp4',
    stage: 'PRODUCT',
    stage_name: '产品训',
    duration_minutes: 79,
    description: "产品训: 连年收益，尽享优悠，解码国寿新产品—万里优悠！",
  },
  {
    id: 'course_45',
    title: "年化收益潜力10%+？解密香港融资保单的财富密码",
    cover_image: 'https://picsum.photos/280/160?random=prod45',
    video_url: VIDEO_BASE + '/product_36.mp4',
    stage: 'PRODUCT',
    stage_name: '产品训',
    duration_minutes: 80,
    description: "产品训: 年化收益潜力10%+？解密香港融资保单的财富密码",
  },
  {
    id: 'course_46',
    title: "分红终身人寿全览——Part2",
    cover_image: 'https://picsum.photos/280/160?random=prod46',
    video_url: VIDEO_BASE + '/product_37.mp4',
    stage: 'PRODUCT',
    stage_name: '产品训',
    duration_minutes: 104,
    description: "产品训: 分红终身人寿全览——Part2",
  },
  {
    id: 'course_47',
    title: "开年王炸！宏L「宏Z家」：3年回本，收益直指6.5%天花板！",
    cover_image: 'https://picsum.photos/280/160?random=prod47',
    video_url: VIDEO_BASE + '/product_38.mp4',
    stage: 'PRODUCT',
    stage_name: '产品训',
    duration_minutes: 76,
    description: "产品训: 开年王炸！宏L「宏Z家」：3年回本，收益直指6.5%天花板！",
  },
  {
    id: 'course_48',
    title: "新年新风向_2026市场新产品一览",
    cover_image: 'https://picsum.photos/280/160?random=prod48',
    video_url: VIDEO_BASE + '/product_39.mp4',
    stage: 'PRODUCT',
    stage_name: '产品训',
    duration_minutes: 109,
    description: "产品训: 新年新风向_2026市场新产品一览",
  },
  {
    id: 'course_49',
    title: "独家震撼！市场最高保证复利产品归来（加场）",
    cover_image: 'https://picsum.photos/280/160?random=prod49',
    video_url: VIDEO_BASE + '/product_40.mp4',
    stage: 'PRODUCT',
    stage_name: '产品训',
    duration_minutes: 55,
    description: "产品训: 独家震撼！市场最高保证复利产品归来（加场）",
  },
  {
    id: 'course_50',
    title: "港险生态新体验-太保产品服务体系详解",
    cover_image: 'https://picsum.photos/280/160?random=prod50',
    video_url: VIDEO_BASE + '/product_41.mp4',
    stage: 'PRODUCT',
    stage_name: '产品训',
    duration_minutes: 68,
    description: "产品训: 港险生态新体验-太保产品服务体系详解",
  },
  {
    id: 'course_51',
    title: "3年，3.21%，锁死！— B_ue「Go息B3」开年爆品，短期高息锁定期",
    cover_image: 'https://picsum.photos/280/160?random=prod51',
    video_url: VIDEO_BASE + '/product_42.mp4',
    stage: 'PRODUCT',
    stage_name: '产品训',
    duration_minutes: 58,
    description: "产品训: 3年，3.21%，锁死！— B_ue「Go息B3」开年爆品，短期高息锁定期",
  },
  {
    id: 'course_52',
    title: "指数万用寿险的特点与比较",
    cover_image: 'https://picsum.photos/280/160?random=prod52',
    video_url: VIDEO_BASE + '/product_43.mp4',
    stage: 'PRODUCT',
    stage_name: '产品训',
    duration_minutes: 114,
    description: "产品训: 指数万用寿险的特点与比较",
  },
  {
    id: 'course_53',
    title: "除了15年IRR破 6%，苏L世「瑞Y」还有哪些让你“哇塞”的隐藏功能",
    cover_image: 'https://picsum.photos/280/160?random=prod53',
    video_url: VIDEO_BASE + '/product_44.mp4',
    stage: 'PRODUCT',
    stage_name: '产品训',
    duration_minutes: 67,
    description: "产品训: 除了15年IRR破 6%，苏L世「瑞Y」还有哪些让你“哇塞”的隐藏功能",
  },
  {
    id: 'course_54',
    title: "地缘冲突下资产确定性配置的破局之道",
    cover_image: 'https://picsum.photos/280/160?random=prod54',
    video_url: VIDEO_BASE + '/product_45.mp4',
    stage: 'PRODUCT',
    stage_name: '产品训',
    duration_minutes: 56,
    description: "产品训: 地缘冲突下资产确定性配置的破局之道",
  },
  {
    id: 'course_55',
    title: "短缴提领之王，又进化了——富W「盈J天下2」升级点全拆解+3Pay特别优惠抢跑指南",
    cover_image: 'https://picsum.photos/280/160?random=prod55',
    video_url: VIDEO_BASE + '/product_46.mp4',
    stage: 'PRODUCT',
    stage_name: '产品训',
    duration_minutes: 38,
    description: "产品训: 短缴提领之王，又进化了——富W「盈J天下2」升级点全拆解+3Pay特别优惠抢跑指南",
  },
  {
    id: 'course_56',
    title: "从一代爆款到二代王炸 安S「盛LⅡ」2年期升级产品深度拆解",
    cover_image: 'https://picsum.photos/280/160?random=prod56',
    video_url: VIDEO_BASE + '/product_47.mp4',
    stage: 'PRODUCT',
    stage_name: '产品训',
    duration_minutes: 49,
    description: "产品训: 从一代爆款到二代王炸 安S「盛LⅡ」2年期升级产品深度拆解",
  },
  {
    id: 'course_57',
    title: "新品首发！卷王之王再卷新高度",
    cover_image: 'https://picsum.photos/280/160?random=prod57',
    video_url: VIDEO_BASE + '/product_48.mp4',
    stage: 'PRODUCT',
    stage_name: '产品训',
    duration_minutes: 72,
    description: "产品训: 新品首发！卷王之王再卷新高度",
  },
  {
    id: 'course_58',
    title: "市场唯一！太B「世D悦享3」强势回归",
    cover_image: 'https://picsum.photos/280/160?random=prod58',
    video_url: VIDEO_BASE + '/product_49.mp4',
    stage: 'PRODUCT',
    stage_name: '产品训',
    duration_minutes: 54,
    description: "产品训: 市场唯一！太B「世D悦享3」强势回归",
  },
  {
    id: 'course_59',
    title: "深扒出绝品，友B使惊诧：论活然人生",
    cover_image: 'https://picsum.photos/280/160?random=prod59',
    video_url: VIDEO_BASE + '/product_50.mp4',
    stage: 'PRODUCT',
    stage_name: '产品训',
    duration_minutes: 57,
    description: "产品训: 深扒出绝品，友B使惊诧：论活然人生",
  },
  {
    id: 'course_60',
    title: "选择大于努力—HK产品选择逻辑",
    cover_image: 'https://picsum.photos/280/160?random=prod60',
    video_url: VIDEO_BASE + '/product_51.mp4',
    stage: 'PRODUCT',
    stage_name: '产品训',
    duration_minutes: 90,
    description: "产品训: 选择大于努力—HK产品选择逻辑",
  },
  {
    id: 'course_61',
    title: "好产品，正当时——太B「世D悦享3」的全维度竞争力拆解",
    cover_image: 'https://picsum.photos/280/160?random=prod61',
    video_url: VIDEO_BASE + '/product_52.mp4',
    stage: 'PRODUCT',
    stage_name: '产品训',
    duration_minutes: 68,
    description: "产品训: 好产品，正当时——太B「世D悦享3」的全维度竞争力拆解",
  },
  {
    id: 'course_62',
    title: "7.25%派息+3%保底+5年回本——「Y耀」的硬核数字游戏",
    cover_image: 'https://picsum.photos/280/160?random=prod62',
    video_url: VIDEO_BASE + '/product_53.mp4',
    stage: 'PRODUCT',
    stage_name: '产品训',
    duration_minutes: 62,
    description: "产品训: 7.25%派息+3%保底+5年回本——「Y耀」的硬核数字游戏",
  },
  {
    id: 'course_63',
    title: "6年缴、7年预期回本、15年保证回本——安D「传C守创V-丰达」的双层保本",
    cover_image: 'https://picsum.photos/280/160?random=prod63',
    video_url: VIDEO_BASE + '/product_54.mp4',
    stage: 'PRODUCT',
    stage_name: '产品训',
    duration_minutes: 70,
    description: "产品训: 6年缴、7年预期回本、15年保证回本——安D「传C守创V-丰达」的双层保本",
  },
  {
    id: 'course_64',
    title: "选择大于努力-HK产品选择逻辑(Part2)",
    cover_image: 'https://picsum.photos/280/160?random=prod64',
    video_url: VIDEO_BASE + '/product_55.mp4',
    stage: 'PRODUCT',
    stage_name: '产品训',
    duration_minutes: 80,
    description: "产品训: 选择大于努力-HK产品选择逻辑(Part2)",
  },
  {
    id: 'course_65',
    title: "内部-富卫盈聚天下",
    cover_image: 'https://picsum.photos/280/160?random=prod65',
    video_url: VIDEO_BASE + '/product_57.mp4',
    stage: 'PRODUCT',
    stage_name: '产品训',
    duration_minutes: 64,
    description: "产品训: 内部-富卫盈聚天下",
  },
  {
    id: 'course_66',
    title: "国寿傲龙传承",
    cover_image: 'https://picsum.photos/280/160?random=prod66',
    video_url: VIDEO_BASE + '/product_58.mp4',
    stage: 'PRODUCT',
    stage_name: '产品训',
    duration_minutes: 48,
    description: "产品训: 国寿傲龙传承",
  },
  {
    id: 'course_67',
    title: "宏利新产品抢先看-宏挚传承",
    cover_image: 'https://picsum.photos/280/160?random=prod67',
    video_url: VIDEO_BASE + '/product_59.mp4',
    stage: 'PRODUCT',
    stage_name: '产品训',
    duration_minutes: 62,
    description: "产品训: 宏利新产品抢先看-宏挚传承",
  },
  {
    id: 'course_68',
    title: "富通守护家倍198",
    cover_image: 'https://picsum.photos/280/160?random=prod68',
    video_url: VIDEO_BASE + '/product_60.mp4',
    stage: 'PRODUCT',
    stage_name: '产品训',
    duration_minutes: 64,
    description: "产品训: 富通守护家倍198",
  },
  {
    id: 'course_69',
    title: "忠意公司及跨越同行危疾计划介绍",
    cover_image: 'https://picsum.photos/280/160?random=prod69',
    video_url: VIDEO_BASE + '/product_61.mp4',
    stage: 'PRODUCT',
    stage_name: '产品训',
    duration_minutes: 59,
    description: "产品训: 忠意公司及跨越同行危疾计划介绍",
  },
  {
    id: 'course_70',
    title: "澳门国寿-大额保单、大有作为",
    cover_image: 'https://picsum.photos/280/160?random=prod70',
    video_url: VIDEO_BASE + '/product_62.mp4',
    stage: 'PRODUCT',
    stage_name: '产品训',
    duration_minutes: 69,
    description: "产品训: 澳门国寿-大额保单、大有作为",
  },
  {
    id: 'course_71',
    title: "盈御多元貨幣計劃 Ⅲ",
    cover_image: 'https://picsum.photos/280/160?random=prod71',
    video_url: VIDEO_BASE + '/product_63.mp4',
    stage: 'PRODUCT',
    stage_name: '产品训',
    duration_minutes: 102,
    description: "产品训: 盈御多元貨幣計劃 Ⅲ",
  },
  {
    id: 'course_72',
    title: "苏黎世-瑞骏万用寿险计划培训",
    cover_image: 'https://picsum.photos/280/160?random=prod72',
    video_url: VIDEO_BASE + '/product_64.mp4',
    stage: 'PRODUCT',
    stage_name: '产品训',
    duration_minutes: 70,
    description: "产品训: 苏黎世-瑞骏万用寿险计划培训",
  },
  {
    id: 'course_73',
    title: "香港储蓄险选购指南240606",
    cover_image: 'https://picsum.photos/280/160?random=prod73',
    video_url: VIDEO_BASE + '/product_65.mp4',
    stage: 'PRODUCT',
    stage_name: '产品训',
    duration_minutes: 59,
    description: "产品训: 香港储蓄险选购指南240606",
  }
]

// ============================================================
// 课件（CourseMaterial）
// 全部为 PDF（PPTX 已提前转为 PDF），本地路径
// ============================================================
const materials: Array<{
  id: string
  course_id: string
  title: string
  file_url: string
  file_type: string
  file_size: number
}> = [
  // 新人训
  {
    id: 'mat_01',
    course_id: 'course_01',
    title: '01第一次课国际保险优势解析.pdf',
    file_url: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
    file_type: 'PDF',
    file_size: 1503495,
  },
  {
    id: 'mat_02',
    course_id: 'course_02',
    title: '02第二次课香港保险主要产品分类介绍.pdf',
    file_url: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
    file_type: 'PDF',
    file_size: 6120760,
  },
  {
    id: 'mat_03',
    course_id: 'course_03',
    title: '03第三次课香港保险安全性深度解析.pdf',
    file_url: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
    file_type: 'PDF',
    file_size: 4049437,
  },
  // 衔接训
  {
    id: 'mat_04',
    course_id: 'course_04',
    title: '04第四次课香港储蓄分红险的场景化销售.pdf',
    file_url: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
    file_type: 'PDF',
    file_size: 1596339,
  },
  {
    id: 'mat_05',
    course_id: 'course_05',
    title: '05第五次课保险公司分红机制.pdf',
    file_url: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
    file_type: 'PDF',
    file_size: 2350209,
  },
  {
    id: 'mat_06',
    course_id: 'course_06',
    title: '06香港保险公司分红实现率解读培训PPT.pdf',
    file_url: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
    file_type: 'PDF',
    file_size: 4356680,
  },
  // 进阶训
  {
    id: 'mat_07',
    course_id: 'course_07',
    title: '（无PDF）',
    file_url: '',
    file_type: 'PDF',
    file_size: 0,
  },
  {
    id: 'mat_08',
    course_id: 'course_08',
    title: '08第八次课资料人寿保险IUL基础概念.pdf',
    file_url: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
    file_type: 'PDF',
    file_size: 1974598,
  },
  // 2026-08-14: mat_09 + mat_10 (对应 course_09/course_10 已下架) 同步移除
]

// 2026-08-13: 产品训课件 (50 个, PDF 优先 + PPTX 兜底, 13 个产品无课件)
const productMaterials: Array<{
  id: string
  course_id: string
  title: string
  file_url: string
  file_type: string
  file_size: number
}> = [

  {
    id: 'mat_11',
    course_id: 'course_11',
    title: "2024-03-12 全球视野下的保单配置-百慕大IUL实操案.pdf",
    file_url: '/uploads/materials/product_01.pdf',
    file_type: 'PDF',
    file_size: 7625380,
  },
  {
    id: 'mat_12',
    course_id: 'course_14',
    title: "2024.11.14匠心传承储蓄计划2.pptx",
    file_url: '/uploads/materials/product_04.pptx',
    file_type: 'PPTX',
    file_size: 9983147,
  },
  {
    id: 'mat_13',
    course_id: 'course_15',
    title: "2024.9.30重磅来袭周D福王者归来-匠X传承2.pdf",
    file_url: '/uploads/materials/product_05.pdf',
    file_type: 'PDF',
    file_size: 7883101,
  },
  {
    id: 'mat_14',
    course_id: 'course_16',
    title: "2025-02-06卷上加卷，领跑市场，万通富R千秋升级归来！.pdf",
    file_url: '/uploads/materials/product_06.pdf',
    file_type: 'PDF',
    file_size: 23836013,
  },
  {
    id: 'mat_15',
    course_id: 'course_17',
    title: "2025-2-13绝冠市场：香港安盛2025年全新储蓄，盛L储蓄计划！.pdf",
    file_url: '/uploads/materials/product_07.pdf',
    file_type: 'PDF',
    file_size: 4130900,
  },
  {
    id: 'mat_16',
    course_id: 'course_18',
    title: "2025-02-27  打破枷锁，友邦新品全面解析.pdf",
    file_url: '/uploads/materials/product_08.pdf',
    file_type: 'PDF',
    file_size: 16590539,
  },
  {
    id: 'mat_17',
    course_id: 'course_19',
    title: "2025-3-6保誠新產品信守明天.pptx",
    file_url: '/uploads/materials/product_09.pptx',
    file_type: 'PPTX',
    file_size: 18955731,
  },
  {
    id: 'mat_18',
    course_id: 'course_20',
    title: "250508短缴快领新标杆，「提领皇者」盈J天下3年期如何碾压市场.pdf",
    file_url: '/uploads/materials/product_10.pdf',
    file_type: 'PDF',
    file_size: 5488362,
  },
  {
    id: 'mat_19',
    course_id: 'course_22',
    title: "6.5%收益下轰动市场的新爆款产品.pdf",
    file_url: '/uploads/materials/product_13.pdf',
    file_type: 'PDF',
    file_size: 16337690,
  },
  {
    id: 'mat_20',
    course_id: 'course_24',
    title: "后7%时代 储蓄产品指南 Part 2.pdf",
    file_url: '/uploads/materials/product_15.pdf',
    file_type: 'PDF',
    file_size: 9465108,
  },
  {
    id: 'mat_21',
    course_id: 'course_25',
    title: "财富稳健增值  颐享养老人生.pdf",
    file_url: '/uploads/materials/product_16.pdf',
    file_type: 'PDF',
    file_size: 18859055,
  },
  {
    id: 'mat_22',
    course_id: 'course_26',
    title: "190 年低调巨头 再次「启航」：一份“时间复利+灵活传承”的双保障.pdf",
    file_url: '/uploads/materials/product_17.pdf',
    file_type: 'PDF',
    file_size: 6176376,
  },
  {
    id: 'mat_23',
    course_id: 'course_27',
    title: "后7%时代 储蓄产品指南 Part 3 鼎峰IUL.pptx",
    file_url: '/uploads/materials/product_18.pptx',
    file_type: 'PPTX',
    file_size: 52645949,
  },
  {
    id: 'mat_24',
    course_id: 'course_28',
    title: "20250926-双重保底+无限回报！苏L世新产品重磅发布.pdf",
    file_url: '/uploads/materials/product_19.pdf',
    file_type: 'PDF',
    file_size: 5086942,
  },
  {
    id: 'mat_25',
    course_id: 'course_29',
    title: "2025-10-16 新王诞生，周D福「飞Y·盛世」“动静双生”震撼来袭！.pdf",
    file_url: '/uploads/materials/product_20.pdf',
    file_type: 'PDF',
    file_size: 11326520,
  },
  {
    id: 'mat_26',
    course_id: 'course_31',
    title: "2025-10-23 安S「盛LII-至尊」重磅归来——拳拳盛意，百世之利.pdf",
    file_url: '/uploads/materials/product_22.pdf',
    file_type: 'PDF',
    file_size: 6666393,
  },
  {
    id: 'mat_27',
    course_id: 'course_32',
    title: "2025-10-30 安全与增长的终极答案：揭秘「瑞J（尊尚版）」如何重塑储蓄险价值.pdf",
    file_url: '/uploads/materials/product_23.pdf',
    file_type: 'PDF',
    file_size: 12273732,
  },
  {
    id: 'mat_28',
    course_id: 'course_33',
    title: "2025-11-05 提领之王再升级：市场最快登顶6.5%，极速回报新标杆！.pdf",
    file_url: '/uploads/materials/product_24.pdf',
    file_type: 'PDF',
    file_size: 7191918,
  },
  {
    id: 'mat_29',
    course_id: 'course_34',
    title: "2025-11-13 分红终身人寿全览.pptx",
    file_url: '/uploads/materials/product_25.pptx',
    file_type: 'PPTX',
    file_size: 1534132,
  },
  {
    id: 'mat_30',
    course_id: 'course_35',
    title: "2025-11-19 破局而立：太B全新产品卷起港险市场新高度.pdf",
    file_url: '/uploads/materials/product_26.pdf',
    file_type: 'PDF',
    file_size: 13950744,
  },
  {
    id: 'mat_31',
    course_id: 'course_36',
    title: "2025-12-04 降息周期起步到信守明天 ——应对利率拐点，布局前瞻配置.pdf",
    file_url: '/uploads/materials/product_27.pdf',
    file_type: 'PDF',
    file_size: 5954514,
  },
  {
    id: 'mat_32',
    course_id: 'course_37',
    title: "2025-12-25 香港储蓄险卷王对决！友B_安S_永M，谁才是真顶流？.pdf",
    file_url: '/uploads/materials/product_28.pdf',
    file_type: 'PDF',
    file_size: 8620032,
  },
  {
    id: 'mat_33',
    course_id: 'course_39',
    title: "2025-02-14保诚信守明天课件.pdf",
    file_url: '/uploads/materials/product_30.pdf',
    file_type: 'PDF',
    file_size: 4368195,
  },
  {
    id: 'mat_34',
    course_id: 'course_40',
    title: "2025-4-24HK年金天花板.pdf",
    file_url: '/uploads/materials/product_31.pdf',
    file_type: 'PDF',
    file_size: 5213427,
  },
  {
    id: 'mat_35',
    course_id: 'course_42',
    title: "6.5%时代趋势解读及资产配置策略.pdf",
    file_url: '/uploads/materials/product_33.pdf',
    file_type: 'PDF',
    file_size: 6678136,
  },
  {
    id: 'mat_36',
    course_id: 'course_43',
    title: "限高令后首款6.5%两年期缴产品，如意相伴享养老.pdf",
    file_url: '/uploads/materials/product_34.pdf',
    file_type: 'PDF',
    file_size: 17894408,
  },
  {
    id: 'mat_37',
    course_id: 'course_44',
    title: "2026-01-08 连年收益，尽享优悠，解码国寿新产品—万里优悠！.pdf",
    file_url: '/uploads/materials/product_35.pdf',
    file_type: 'PDF',
    file_size: 16625725,
  },
  {
    id: 'mat_38',
    course_id: 'course_45',
    title: "CTFLife_Ever Shine_Slides_2508_(TradChi)_V1.pdf",
    file_url: '/uploads/materials/product_36.pdf',
    file_type: 'PDF',
    file_size: 6142046,
  },
  {
    id: 'mat_39',
    course_id: 'course_46',
    title: "2026-01-22 分红终身人寿全览——Part2.pptx",
    file_url: '/uploads/materials/product_37.pptx',
    file_type: 'PPTX',
    file_size: 7382552,
  },
  {
    id: 'mat_40',
    course_id: 'course_47',
    title: "2026-02-05 开年王炸！宏L「宏Z家」：3年回本，收益直指6.5%天花板！.pdf",
    file_url: '/uploads/materials/product_38.pdf',
    file_type: 'PDF',
    file_size: 2233757,
  },
  {
    id: 'mat_41',
    course_id: 'course_48',
    title: "2026-02-12 新年新风向_2026市场新产品一览.pdf",
    file_url: '/uploads/materials/product_39.pdf',
    file_type: 'PDF',
    file_size: 18589433,
  },
  {
    id: 'mat_42',
    course_id: 'course_49',
    title: "2026-02-28 独家震撼！市场最高保证复利产品归来（加场）.pdf",
    file_url: '/uploads/materials/product_40.pdf',
    file_type: 'PDF',
    file_size: 3806849,
  },
  {
    id: 'mat_43',
    course_id: 'course_50',
    title: "2026-03-05 港险生态新体验-太保产品服务体系详解.pdf",
    file_url: '/uploads/materials/product_41.pdf',
    file_type: 'PDF',
    file_size: 38738488,
  },
  {
    id: 'mat_44',
    course_id: 'course_51',
    title: "2026-03-06 3年，3.21%，锁死！— B_ue「Go息B3」开年爆品，短期高息锁定期.pdf",
    file_url: '/uploads/materials/product_42.pdf',
    file_type: 'PDF',
    file_size: 12213229,
  },
  {
    id: 'mat_45',
    course_id: 'course_52',
    title: "2026-03-12 指数万用寿险的特点与比较.pdf",
    file_url: '/uploads/materials/product_43.pdf',
    file_type: 'PDF',
    file_size: 25208326,
  },
  {
    id: 'mat_46',
    course_id: 'course_53',
    title: "2026-03-20 除了15年IRR破 6%，苏L世「瑞Y」还有哪些让你“哇塞”的隐藏功能.pdf",
    file_url: '/uploads/materials/product_44.pdf',
    file_type: 'PDF',
    file_size: 11672856,
  },
  {
    id: 'mat_47',
    course_id: 'course_54',
    title: "2026-04-01 地缘冲突下资产确定性配置的破局之道.pptx",
    file_url: '/uploads/materials/product_45.pptx',
    file_type: 'PPTX',
    file_size: 28161772,
  },
  {
    id: 'mat_48',
    course_id: 'course_55',
    title: "盈聚天下2三年期優惠培訓_20260402(1).pdf",
    file_url: '/uploads/materials/product_46.pdf',
    file_type: 'PDF',
    file_size: 4315059,
  },
  {
    id: 'mat_49',
    course_id: 'course_56',
    title: "2026-04-09 从一代爆款到二代王炸 安S「盛LⅡ」2年期升级产品深度拆解.pptx",
    file_url: '/uploads/materials/product_47.pptx',
    file_type: 'PPTX',
    file_size: 10068097,
  },
  {
    id: 'mat_50',
    course_id: 'course_59',
    title: "2026-04-30 深扒出绝品，友B使惊诧：论活然人生.pdf",
    file_url: '/uploads/materials/product_50.pdf',
    file_type: 'PDF',
    file_size: 18799435,
  },
  {
    id: 'mat_51',
    course_id: 'course_60',
    title: "2026-05-28 选择大于努力—HK产品选择逻辑.pdf",
    file_url: '/uploads/materials/product_51.pdf',
    file_type: 'PDF',
    file_size: 11304834,
  },
  {
    id: 'mat_52',
    course_id: 'course_61',
    title: "好产品，正当时——太B「世D悦享3」的全维度竞争力拆解V_20260612154622.pdf",
    file_url: '/uploads/materials/product_52.pdf',
    file_type: 'PDF',
    file_size: 4993987,
  },
  {
    id: 'mat_53',
    course_id: 'course_64',
    title: "2026-07-23 选择大于努力-HK产品选择逻辑(Part2).pdf",
    file_url: '/uploads/materials/product_55.pdf',
    file_type: 'PDF',
    file_size: 11649301,
  },
  {
    id: 'mat_54',
    course_id: 'course_65',
    title: "WS20240307线上培训  春晖渐进、风正扬帆盈聚天下分享资料.pdf",
    file_url: '/uploads/materials/product_57.pdf',
    file_type: 'PDF',
    file_size: 5672046,
  },
  {
    id: 'mat_55',
    course_id: 'course_67',
    title: "宏挚提取+功能一页通2405.pdf",
    file_url: '/uploads/materials/product_59.pdf',
    file_type: 'PDF',
    file_size: 728618,
  },
  {
    id: 'mat_56',
    course_id: 'course_68',
    title: "守护家倍198240314.pdf",
    file_url: '/uploads/materials/product_60.pdf',
    file_type: 'PDF',
    file_size: 7174656,
  },
  {
    id: 'mat_57',
    course_id: 'course_69',
    title: "公司介绍.pdf",
    file_url: '/uploads/materials/product_61.pdf',
    file_type: 'PDF',
    file_size: 54036491,
  },
  {
    id: 'mat_58',
    course_id: 'course_71',
    title: "友邦盈御3-.pdf",
    file_url: '/uploads/materials/product_63.pdf',
    file_type: 'PDF',
    file_size: 5067000,
  },
  {
    id: 'mat_59',
    course_id: 'course_72',
    title: "瑞骏万用寿险计划培训.pdf",
    file_url: '/uploads/materials/product_64.pdf',
    file_type: 'PDF',
    file_size: 5619766,
  },
  {
    id: 'mat_60',
    course_id: 'course_73',
    title: "HK储蓄险选购指南-2024.6.18 .pptx",
    file_url: '/uploads/materials/product_65.pptx',
    file_type: 'PPTX',
    file_size: 47369948,
  }
]

async function main() {
  console.log('🌱 开始初始化融合以琳培训数据（新人训/衔接训/进阶训）...\n')

  // ============================================================
  // 1. 用户清理 (走 4in1 IdP, 不再 seed User)
  // ============================================================
  // 删除旧 seed 用户 (u_001 + u_admin) + 关联进度, schema 上 cascade 会自动清理
  // 不预占位 admin — 让 4in1 真实 user (firebase_uid='SrlFST...' for 123@qqq.com)
  //   首次进 iframe 时由 JwtStrategy.validate → findOrCreateFromJwt 自然 upsert
  await prisma.user.deleteMany({ where: { id: { in: ['u_001', 'u_admin'] } } })
  console.log('🗑️  已删除旧 seed 用户 (u_001, u_admin)')
  console.log('ℹ️   4in1 IdP: 不预占位 User 记录, dev-bypass/真实 user 首次进 iframe 自然 upsert')

  // ============================================================
  // 2. 删除旧数据 (含 8 节新人训 + 63 节产品训)
  // ============================================================
  const oldIds = [
    'course_01', 'course_02', 'course_03', 'course_04', 'course_05',
    'course_06', 'course_07', 'course_08', 'course_09', 'course_10',
    ...productCourses.map((c) => c.id),
    'nb_01', 'nb_02', 'nb_03', 'nb_04', 'nb_05',
    'nb_06', 'nb_07', 'nb_08', 'nb_09', 'nb_10',
    'c_001', 'c_002', 'c_003',
  ]
  await prisma.courseMaterial.deleteMany({ where: { course_id: { in: oldIds } } })
  await prisma.course.deleteMany({ where: { id: { in: oldIds } } })
  console.log('🗑️  已清除旧数据')

  // ============================================================
  // 3. 创建 71 节课程 (8 新人训 + 63 产品训)
  // ============================================================
  for (const course of [...courses, ...productCourses]) {
    await prisma.course.upsert({
      where: { id: course.id },
      update: {},
      create: course,
    })
    console.log(`✅ 课程 ${course.id}: ${course.title} [${course.stage_name}]`)
  }

  // ============================================================
  // 4. 创建课件（course_07 无 PDF 跳过, 产品训无课件的也跳过）
  // ============================================================
  for (const mat of [...materials, ...productMaterials]) {
    if (mat.title === '（无PDF）') {
      console.log(`⏭️  课件 ${mat.course_id}: 无 PDF 课件，跳过`)
      continue
    }
    await prisma.courseMaterial.upsert({
      where: { id: mat.id },
      update: {
        title: mat.title,
        file_url: mat.file_url,
        file_type: mat.file_type,
        file_size: mat.file_size,
      },
      create: {
        id: mat.id,
        course_id: mat.course_id,
        title: mat.title,
        file_url: mat.file_url,
        file_type: mat.file_type,
        file_size: mat.file_size,
      },
    })
    console.log(`✅ 课件 ${mat.course_id}: ${mat.title}`)
  }

  // ============================================================
  // 5. 不再初始化 userCourseProgress (依赖真实 user_id, 由首次进 iframe 自然创建)
  // ============================================================
  console.log(`ℹ️   课程进度由用户首次进 iframe 时, App.vue / 学员接口按需创建`)

  // ============================================================
  // 6. 等级配置
  // ============================================================
  for (const cfg of [
    { level: 1, name: '初阶阶段',    min_minutes: 0,     next_level_minutes: 3000 },
    { level: 2, name: '进阶阶段',    min_minutes: 3000,  next_level_minutes: 10000 },
    { level: 3, name: '高阶阶段',    min_minutes: 10000, next_level_minutes: null },
  ]) {
    await prisma.levelConfig.upsert({ where: { level: cfg.level }, update: {}, create: cfg })
  }

  // ============================================================
  // 7. 基本法配置 (Config 表) — id=key, value=JSON.stringify(value)
  //   - 2026-08-13: M_PROMOTE total6m 调整 — M2 6m 100000→200000, M3 6m 300000→400000
  //   - 用 upsert (idempotent): 已存在则跳过, 缺失则补全 — 不会覆盖手工改的 value
  // ============================================================
  const configDefaults: Array<{ key: string; value: any }> = [
    { key: 'L_PROMOTE_HK', value: { L2: 50000, L3: 100000 } },
    { key: 'L_PROMOTE_SG', value: { L2: 50000, L3: 100000 } },
    { key: 'M_PROMOTE',    value: { M2: { directRecruits: 2, total6m: 200000 }, M3: { directRecruits: 4, total6m: 400000 } } },
    // 2026-08-14: 评分公式权重 (默认 50/30/20, Config 化可覆盖)
    { key: 'PERFORMANCE_FORMULA', value: { sales: 50, tree: 30, learning: 20 } },
    { key: 'RECRUITER_RATES', value: { HK_L1: 0.027, HK_L2: 0.018, SG_L1: 0.03, SG_L2: 0.02, ART_BONUS_L1: 0.015, ART_BONUS_L2: 0.005 } },
    { key: 'MGMT_RATES',      value: { HK: 0.03, SG: 0.075, ART_PER_LEVEL: 0.01 } },
    { key: 'ART_RATES',       value: { ART_MODERN_SELF: 0.06, ART_CONTEMP_SELF: 0.15 } },
    { key: 'COMMISSION_TABLE_VERSION', value: 'PENDING' },
  ]
  for (const c of configDefaults) {
    const existing = await prisma.config.findUnique({ where: { key: c.key } })
    if (!existing) {
      await prisma.config.create({
        data: {
          key: c.key,
          value: typeof c.value === 'string' ? c.value : JSON.stringify(c.value),
        },
      })
      console.log(`✅ Config ${c.key} 已初始化`)
    } else {
      console.log(`⏭️  Config ${c.key} 已存在, 跳过`)
    }
  }

  // ============================================================
  // 8. 输出总览
  // ============================================================
  console.log('\n🎉 融合以琳培训数据初始化完成！')
  console.log(`\n课程总览: ${courses.length} 节新人训 + ${productCourses.length} 节产品训 = ${courses.length + productCourses.length} 节`)
  console.log('─'.repeat(80))
  console.log('【新人训 ONBOARDING】')
  for (const c of courses) {
    const mat = materials.find(m => m.course_id === c.id && m.title !== '（无PDF）')
    const matTag = mat ? `[PDF]` : '[无]'
    console.log(`  ${c.id}  ${c.title.padEnd(28)} ${matTag}  ${c.duration_minutes}min`)
  }
  console.log('\n【产品训 PRODUCT】 (8 节新人训 ≥50% 解锁, 即完成 4/8 节)')
  for (const c of productCourses) {
    const mat = productMaterials.find(m => m.course_id === c.id)
    const matTag = mat ? `[${mat.file_type}]` : '[无]'
    console.log(`  ${c.id}  ${c.title.slice(0, 28).padEnd(28)} ${matTag}  ${c.duration_minutes}min`)
  }
  console.log('─'.repeat(80))
  console.log(`总计: ${courses.length + productCourses.length} 节课，${materials.filter(m => m.title !== '（无PDF）').length + productMaterials.length} 个课件`)
  console.log('\n⚠️  视频/课件均为本地路径（已 copy 到 ./docker/training/data/uploads/），ECS 部署需额外 scp 上传')
}

main()
  .catch((e) => { console.error('❌ 失败:', e); process.exit(1) })
  .finally(async () => { await prisma.$disconnect() })
