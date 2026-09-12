import { createRouter, createWebHashHistory } from 'vue-router'
import Layout from '@/layout/index.vue'

const router = createRouter({
  // 2026-08-12: 部署在 /training/admin/ 子路径, WebHistory 在子路径下路由不匹配
  // 改 HashHistory 兜底 (dev 5173 + prod /training/admin/ 都通)
  history: createWebHashHistory(),
  routes: [
    {
      path: '/login',
      name: 'Login',
      component: () => import('@/views/login/index.vue'),
      meta: { title: '登录' }
    },
    {
      path: '/403',
      name: 'Forbidden',
      component: () => import('@/views/login/index.vue'),  // 复用登录页样式 (静态提示)
      meta: { title: '无权限' }
    },
    {
      path: '/',
      component: Layout,
      redirect: '/dashboard',
      children: [
        {
          path: '/dashboard',
          name: 'Dashboard',
          component: () => import('@/views/dashboard/index.vue'),
          meta: { title: '学情看板', requireAdmin: true }
        },
        {
          path: '/course',
          name: 'Course',
          component: () => import('@/views/course/index.vue'),
          meta: { title: '课程与课件管理', requireAdmin: true }
        },
        {
          // 2026-08-12: 从 admin-web-upload 合并进来的上传功能 (新内容/补传/历史 3 tab)
          path: '/upload',
          name: 'Upload',
          component: () => import('@/views/upload/index.vue'),
          meta: { title: '内容上传', requireAdmin: true }
        },
        {
          path: '/student',
          name: 'Student',
          component: () => import('@/views/student/index.vue'),
          meta: { title: '学员档案管理', requireAdmin: true }
        },
        // 2026-08-12: 基本法模块 (推管树 / 业绩录入 / 等级管理 / 配置)
        {
          path: '/tree',
          name: 'Tree',
          component: () => import('@/views/tree/index.vue'),
          meta: { title: '推管树', requireAdmin: true }
        },
        {
          path: '/transaction',
          name: 'Transaction',
          component: () => import('@/views/transaction/index.vue'),
          meta: { title: '业绩录入', requireAdmin: true }
        },
        {
          // 2026-08-16: 佣金费率查询 — Phase 1, 给管理员查 HK 保险代理佣金
          //   - /api/rates/preview 返积分视图 (任何登录用户)
          //   - /api/rates/lookup 返完整明细 (admin only)
          path: '/rates',
          name: 'Rates',
          component: () => import('@/views/rates/index.vue'),
          meta: { title: '佣金费率查询', requireAdmin: true }
        },
        {
          // 2026-08-16: 季度刷新 — Phase 4 (#23), admin 上传 10 PDF + 1 CSV, 后台跑 refresh-rates.sh
          //   - /api/admin/rates/upload (multipart) → 暂存到 db/source_pdfs/inbox/<quarter>/
          //   - /api/admin/rates/calibrate (json) → 后台跑, 返 runId
          //   - /api/admin/rates/calibrate/:runId (GET) → 轮询 status + 日志
          path: '/rates-refresh',
          name: 'RatesRefresh',
          component: () => import('@/views/rates-refresh/index.vue'),
          meta: { title: '季度刷新', requireAdmin: true }
        },
        {
          path: '/level',
          name: 'Level',
          component: () => import('@/views/level/index.vue'),
          meta: { title: '等级管理', requireAdmin: true }
        },
        {
          path: '/config',
          name: 'Config',
          component: () => import('@/views/config/index.vue'),
          meta: { title: '基本法配置', requireAdmin: true }
        }
      ]
    }
  ]
})

// 2026-08-12: 4in1 作 IdP, 同 origin 共享 'token' key
//   - 无 token → 跳 /login (iframe 内静态提示页, 引导回 4in1 主页)
//   - 有 token 但 !isAdmin → 跳 /403 (同上)
//   - 有 token 且 isAdmin → 放行
function decodeJwt(token: string): any | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = payload + '='.repeat((4 - payload.length % 4) % 4)
    return JSON.parse(atob(padded))
  } catch {
    return null
  }
}

router.beforeEach((to, _from, next) => {
  const token = localStorage.getItem('token')
  const publicPaths = ['/login', '/403']

  if (!token && !publicPaths.includes(to.path)) {
    return next('/login')
  }

  // requireAdmin 路由: 必须 isAdmin=true
  if (to.meta?.requireAdmin) {
    const payload = decodeJwt(token!)
    if (!payload?.isAdmin) {
      return next('/403')
    }
  }

  next()
})

export default router
