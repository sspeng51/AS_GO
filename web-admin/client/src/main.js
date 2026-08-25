import { createApp } from 'vue'
import { createPinia } from 'pinia'
import {
  ArrowDown,
  ChatDotRound,
  ChatLineSquare,
  Check,
  Expand,
  Fold,
  Monitor,
  Operation,
  Refresh,
  Setting,
  UserFilled
} from '@element-plus/icons-vue'

import App from './App.vue'
import router from './router'
import './styles/global.css'

const app = createApp(App)

const globalIcons = {
  ArrowDown,
  ChatDotRound,
  ChatLineSquare,
  Check,
  Expand,
  Fold,
  Monitor,
  Operation,
  Refresh,
  Setting,
  UserFilled
}
Object.entries(globalIcons).forEach(([name, component]) => {
  app.component(name, component)
})

app.use(createPinia())
app.use(router)

app.mount('#app')
