import axios from 'axios'
import { ElMessage } from 'element-plus'
import router from '@/router'

const api = axios.create({
  baseURL: '/api',
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' }
})

api.interceptors.request.use(config => {
  const token = localStorage.getItem('admin_token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
}, error => Promise.reject(error))

api.interceptors.response.use(
  response => response,
  error => {
    const serverMessage = typeof error.response?.data?.error === 'string' ? error.response.data.error : ''
    const tuningHandlesError = String(error.config?.url || '').startsWith('/rag-tuning/')
    if (error.response?.status === 401) {
      localStorage.removeItem('admin_token')
      localStorage.removeItem('admin_user')
      router.push('/login')
      ElMessage.error('登录已过期，请重新登录')
    } else if (tuningHandlesError) {
      // The tuning screen owns per-record errors and retry state. Avoid a second,
      // generic toast that hides the useful message shown beside the question.
      if (!serverMessage && error.response?.status >= 500) error.message = '页面无法取得后台有效响应，请检查 3000 端口后台及其日志'
    } else if (error.response?.status === 403) {
      ElMessage.error(serverMessage || '权限不足，无法执行此操作')
    } else if (error.response?.status === 429) {
      ElMessage.error(serverMessage || '请求过于频繁，请稍后再试')
    } else if (error.response?.status >= 500) {
      ElMessage.error(serverMessage || '后台未返回有效响应，请检查后台连接')
    }
    return Promise.reject(error)
  }
)

export default api
