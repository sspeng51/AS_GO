<script setup>
import { ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { ElMessage } from 'element-plus'

const router = useRouter()
const route = useRoute()
const auth = useAuthStore()

const loginForm = ref({
  username: '',
  password: ''
})

const loading = ref(false)
const errorMsg = ref('')

async function handleLogin() {
  if (!loginForm.value.username || !loginForm.value.password) {
    errorMsg.value = '请输入用户名和密码'
    return
  }

  loading.value = true
  errorMsg.value = ''

  const result = await auth.login(loginForm.value.username, loginForm.value.password)

  loading.value = false

  if (result.success) {
    ElMessage.success('登录成功')
    const redirect = route.query.redirect || '/dashboard'
    router.push(redirect)
  } else {
    errorMsg.value = result.error
  }
}

function handleKeyup(e) {
  if (e.key === 'Enter') handleLogin()
}
</script>

<template>
  <div class="login-container">
    <div class="login-card">
      <div class="login-header">
        <div class="login-logo">📚</div>
        <h2>砷智答知识库管理后台</h2>
        <p class="subtitle">Arsenic Knowledge Base Admin</p>
      </div>

      <el-form class="login-form" @keyup="handleKeyup">
        <el-form-item>
          <el-input
            v-model="loginForm.username"
            placeholder="用户名"
            :prefix-icon="'User'"
            size="large"
            clearable
          />
        </el-form-item>

        <el-form-item>
          <el-input
            v-model="loginForm.password"
            type="password"
            placeholder="密码"
            :prefix-icon="'Lock'"
            size="large"
            show-password
          />
        </el-form-item>

        <el-alert v-if="errorMsg" :title="errorMsg" type="error" show-icon :closable="false" style="margin-bottom: 16px;" />

        <el-form-item>
          <el-button
            type="primary"
            size="large"
            :loading="loading"
            style="width: 100%;"
            @click="handleLogin"
          >
            登 录
          </el-button>
        </el-form-item>
      </el-form>

      <div class="login-footer">
        <span>请使用管理员分配的账号登录</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.login-container {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
}

.login-card {
  width: 400px;
  padding: 40px;
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.15);
}

.login-header {
  text-align: center;
  margin-bottom: 32px;
}

.login-logo {
  font-size: 48px;
  margin-bottom: 8px;
}

.login-header h2 {
  margin: 0 0 8px;
  font-size: 22px;
  color: #1a1a2e;
}

.subtitle {
  margin: 0;
  font-size: 13px;
  color: #8c8c8c;
}

.login-footer {
  text-align: center;
  margin-top: 16px;
  font-size: 12px;
  color: #bfbfbf;
}
</style>
