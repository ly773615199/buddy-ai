import { createRoot } from 'react-dom/client'
import './i18n/index.ts'  // i18n 初始化，必须在 App 之前
import 'highlight.js/styles/github-dark.min.css'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <App />
)
