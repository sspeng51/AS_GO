<script setup>
import { useAuthStore } from './stores/auth'
import zhCn from 'element-plus/es/locale/lang/zh-cn'

const auth = useAuthStore()
</script>

<template>
  <el-config-provider :locale="zhCn">
    <router-view />
  </el-config-provider>
</template>

<style>
#app {
  font-family: 'Helvetica Neue', Helvetica, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
}
</style>
