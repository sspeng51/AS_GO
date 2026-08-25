import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import router from '@/router'
import api from '@/api'

export const useAuthStore = defineStore('auth', () => {
  const token = ref(localStorage.getItem('admin_token') || '')
  const user = ref(JSON.parse(localStorage.getItem('admin_user') || 'null'))

  const isLoggedIn = computed(() => !!token.value)
  const isAdmin = computed(() => user.value?.role === 'admin')

  async function login(username, password) {
    try {
      const res = await api.post('/auth/login', { username, password })
      const { token: newToken, user: userData } = res.data

      token.value = newToken
      user.value = userData

      localStorage.setItem('admin_token', newToken)
      localStorage.setItem('admin_user', JSON.stringify(userData))

      return { success: true }
    } catch (err) {
      const msg = err.response?.data?.error || '登录失败，请检查网络连接'
      return { success: false, error: msg }
    }
  }

  function logout() {
    token.value = ''
    user.value = null
    localStorage.removeItem('admin_token')
    localStorage.removeItem('admin_user')
    router.push('/login')
  }

  return { token, user, isLoggedIn, isAdmin, login, logout }
})