import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import App from './ui/App'
import './styles.css'

const container = document.getElementById('root')
if (!container) {
  throw new Error('找不到 #root 容器，index.html 可能被改坏了。')
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
