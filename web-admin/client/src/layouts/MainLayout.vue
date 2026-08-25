<script setup>
import { ref, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { ElMessageBox } from 'element-plus'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const isCollapse = ref(false)
const currentPath = computed(() => route.path)

const menuItems = [
  { index: '/dashboard', title: '仪表盘', icon: 'Monitor' },
  { index: '/rag-tuning', title: 'RAG调优', icon: 'Operation' },
  { index: '/conversations', title: '用户对话记录', icon: 'ChatDotRound' },
  { index: '/feedback', title: '用户反馈管理', icon: 'ChatLineSquare' },
  { index: '/system', title: '系统配置', icon: 'Setting' }
]

function handleMenuSelect(index) {
  router.push(index)
}

async function handleLogout() {
  try {
    await ElMessageBox.confirm('确定要退出登录吗？', '确认退出', {
      confirmButtonText: '退出',
      cancelButtonText: '取消',
      type: 'warning'
    })
    auth.logout()
  } catch {}
}

watch(currentPath, (path) => {
  if (path === '/') {
    router.push('/dashboard')
  }
}, { immediate: true })
</script>

<template>
  <el-container class="main-layout">
    <el-aside :width="isCollapse ? '64px' : '220px'" class="sidebar">
      <div class="logo">
        <span v-if="!isCollapse" class="logo-text">📚 砷智答后台</span>
        <span v-else class="logo-text-collapsed">📚</span>
      </div>

      <el-menu
        :default-active="currentPath"
        :collapse="isCollapse"
        background-color="#1a1a2e"
        text-color="#a0a0b8"
        active-text-color="#409eff"
        @select="handleMenuSelect"
        class="sidebar-menu"
      >
        <el-menu-item v-for="item in menuItems" :key="item.index" :index="item.index">
          <el-icon><component :is="item.icon" /></el-icon>
          <template #title>{{ item.title }}</template>
        </el-menu-item>
      </el-menu>

      <div class="sidebar-footer" @click="isCollapse = !isCollapse">
        <el-icon><component :is="isCollapse ? 'Expand' : 'Fold'" /></el-icon>
        <span v-if="!isCollapse" class="collapse-text">收起菜单</span>
      </div>
    </el-aside>

    <el-container>
      <el-header class="top-header">
        <div class="header-left">
          <el-breadcrumb separator="/">
            <el-breadcrumb-item :to="{ path: '/dashboard' }">首页</el-breadcrumb-item>
            <el-breadcrumb-item v-if="route.meta.title && route.path !== '/dashboard'">
              {{ route.meta.title }}
            </el-breadcrumb-item>
          </el-breadcrumb>
        </div>
        <div class="header-right">
          <el-dropdown trigger="click">
            <span class="user-info">
              <el-avatar :size="32" icon="UserFilled" />
              <span class="username">{{ auth.user?.nickname || auth.user?.username || '管理员' }}</span>
              <el-icon><ArrowDown /></el-icon>
            </span>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item disabled>
                  角色: {{ auth.isAdmin ? '超级管理员' : '普通用户' }}
                </el-dropdown-item>
                <el-dropdown-item divided @click="handleLogout">
                  <span style="color: #f56c6c;">退出登录</span>
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </el-header>

      <el-main class="main-content">
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<style scoped>
.main-layout {
  height: 100vh;
}

.sidebar {
  background: #1a1a2e;
  display: flex;
  flex-direction: column;
  transition: width 0.3s;
  overflow: hidden;
}

.logo {
  height: 60px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.logo-text {
  color: #fff;
  font-size: 16px;
  font-weight: 700;
  white-space: nowrap;
}

.logo-text-collapsed {
  color: #fff;
  font-size: 20px;
}

.sidebar-menu {
  flex: 1;
  border-right: none;
}

.sidebar-menu .el-menu-item {
  height: 48px;
  line-height: 48px;
}

.sidebar-menu .el-menu-item.is-active {
  background: rgba(64, 158, 255, 0.1) !important;
  border-right: 3px solid #409eff;
}

.sidebar-footer {
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: #a0a0b8;
  cursor: pointer;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  transition: color 0.3s;
  font-size: 14px;
}

.sidebar-footer:hover {
  color: #fff;
}

.collapse-text {
  font-size: 12px;
}

.top-header {
  background: #fff;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
  z-index: 10;
  height: 60px;
}

.header-right {
  display: flex;
  align-items: center;
}

.user-info {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.username {
  font-size: 14px;
  color: #333;
}

.main-content {
  background: #f0f2f5;
  min-height: calc(100vh - 60px);
  padding: 20px;
}
</style>