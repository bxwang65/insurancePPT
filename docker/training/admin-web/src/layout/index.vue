<template>
  <el-container class="layout-container">
    <!-- 2026-08-14: 左侧边栏 → 汉堡按钮 + 抽屉 (跟 4in1 主站保持一致) -->
    <el-container>
      <el-header class="header">
        <div class="header-left">
          <el-button text class="hamburger-btn" @click="drawerOpen = true">
            <el-icon size="22"><Operation /></el-icon>
          </el-button>
          <span class="logo-text-inline">融合以琳培训管理系统</span>
          <el-breadcrumb separator="/" class="breadcrumbs-inline">
            <el-breadcrumb-item :to="{ path: '/' }">首页</el-breadcrumb-item>
            <el-breadcrumb-item v-for="item in breadcrumbs" :key="item.path">
              {{ item.meta.title }}
            </el-breadcrumb-item>
          </el-breadcrumb>
        </div>
        <div class="header-right">
          <el-dropdown>
            <span class="admin-avatar">
              <el-avatar :size="32" src="https://cube.elemecdn.com/0/88/03b0d39583f48206768a7534e55bcpng.png" />
            </span>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item>个人中心</el-dropdown-item>
                <el-dropdown-item divided @click="handleLogout">退出登录</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </el-header>

      <el-main class="main-content">
        <router-view v-slot="{ Component }">
          <transition name="fade" mode="out-in">
            <component :is="Component" />
          </transition>
        </router-view>
      </el-main>
    </el-container>

    <!-- 抽屉菜单 (左侧滑出) -->
    <el-drawer
      v-model="drawerOpen"
      direction="ltr"
      size="280px"
      :with-header="false"
      class="nav-drawer"
    >
      <div class="drawer-logo">
        <span class="drawer-logo-text">融合以琳培训管理系统</span>
      </div>
      <el-menu
        :default-active="activeMenu"
        class="drawer-menu"
        background-color="#1a1a2e"
        text-color="#e0e0e0"
        active-text-color="#409eff"
        router
        @select="drawerOpen = false"
      >
        <el-menu-item index="/dashboard">
          <el-icon><DataAnalysis /></el-icon>
          <span>学情看板</span>
        </el-menu-item>
        <el-menu-item index="/course">
          <el-icon><Reading /></el-icon>
          <span>课程与课件</span>
        </el-menu-item>
        <el-menu-item index="/upload">
          <el-icon><UploadFilled /></el-icon>
          <span>内容上传</span>
        </el-menu-item>
        <el-menu-item index="/student">
          <el-icon><User /></el-icon>
          <span>学员档案</span>
        </el-menu-item>
        <el-menu-item index="/transaction">
          <el-icon><Money /></el-icon>
          <span>业绩录入</span>
        </el-menu-item>
        <!-- 2026-08-16: 佣金费率查询 (Phase 1) -->
        <el-menu-item index="/rates">
          <el-icon><Coin /></el-icon>
          <span>佣金费率查询</span>
        </el-menu-item>
        <el-menu-item index="/rates-refresh">
          <el-icon><Refresh /></el-icon>
          <span>季度刷新</span>
        </el-menu-item>
        <el-menu-item index="/tree">
          <el-icon><Share /></el-icon>
          <span>推管树</span>
        </el-menu-item>
        <el-menu-item index="/level">
          <el-icon><Trophy /></el-icon>
          <span>等级管理</span>
        </el-menu-item>
        <el-menu-item index="/config">
          <el-icon><Setting /></el-icon>
          <span>基本法配置</span>
        </el-menu-item>
      </el-menu>
    </el-drawer>
  </el-container>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { DataAnalysis, Reading, User, UploadFilled, Money, Share, Trophy, Setting, Operation, Coin, Refresh } from '@element-plus/icons-vue'
import { useUserStore } from '@/store/user'

const route = useRoute()
const userStore = useUserStore()

const drawerOpen = ref(false)
const activeMenu = computed(() => route.path)

const breadcrumbs = computed(() => {
  return (route.matched || []).filter(r => r.meta && r.meta.title)
})

const handleLogout = async () => {
  try {
    await ElMessageBox.confirm('确定要退出登录吗？退出将同时登出 4in1 主页', '提示', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning',
    })
    userStore.clearToken()
    ElMessage.success('已退出登录')
    try {
      if (window.parent && window.parent !== window) {
        window.parent.location.href = '/'
      } else {
        window.location.href = '/'
      }
    } catch {
      window.location.href = '/'
    }
  } catch {
    // 用户取消操作
  }
}
</script>

<style scoped>
.layout-container {
  height: 100vh;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background-color: #fff;
  border-bottom: 1px solid #e8e8e8;
  padding: 0 20px;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.hamburger-btn {
  padding: 8px;
  color: #475569;
}
.hamburger-btn:hover {
  background: rgba(0, 0, 0, 0.04);
}

.logo-text-inline {
  color: #409eff;
  font-size: 15px;
  font-weight: 600;
}

.breadcrumbs-inline {
  margin-left: 16px;
}

.header-right {
  display: flex;
  align-items: center;
}

.admin-avatar {
  cursor: pointer;
}

.main-content {
  background-color: #f5f7fa;
  padding: 20px;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* 抽屉菜单样式 — 整条深蓝色, 无圆角无白边 */
/* 全局兜底: Element Plus el-overlay-dialog 默认白底覆盖 */
:global(.el-overlay),
:deep(.el-overlay) {
  background-color: transparent !important;
}
:global(.el-overlay-dialog),
:deep(.el-overlay-dialog) {
  background-color: transparent !important;
  box-shadow: none !important;
  overflow: hidden !important;
}
:global(.el-drawer),
.nav-drawer :deep(.el-drawer) {
  background-color: #1a1a2e !important;
  border-radius: 0 !important;
  box-shadow: none !important;
  border: none !important;
}
:global(.el-drawer__header),
.nav-drawer :deep(.el-drawer__header) {
  margin: 0 !important;
  padding: 0 !important;
  display: none !important;
}
:global(.el-drawer__body),
.nav-drawer :deep(.el-drawer__body) {
  background-color: #1a1a2e !important;
  padding: 0 !important;
  height: 100vh !important;
  overflow: hidden !important;
}
.drawer-logo {
  height: 60px;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: #16213e;
  border-bottom: 1px solid #2d2d44;
}
.drawer-logo-text {
  color: #409eff;
  font-size: 15px;
  font-weight: 600;
  text-align: center;
  line-height: 1.3;
}
.drawer-menu {
  border-right: none;
  background-color: #1a1a2e;
  height: calc(100vh - 60px);
}
.drawer-menu :deep(.el-menu-item) {
  background-color: #1a1a2e;
}
</style>