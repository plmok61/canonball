import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { guardDrops } from './dropGuard'
import { applyInitialTheme } from './theme/useTheme'

applyInitialTheme()
guardDrops(window)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
