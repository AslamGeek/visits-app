import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

const hadServiceWorkerController = Boolean(navigator.serviceWorker?.controller)
let refreshingForUpdate = false

if ('serviceWorker' in navigator) {
  if (hadServiceWorkerController) {
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshingForUpdate) return
      refreshingForUpdate = true
      window.location.reload()
    })
  }

  void navigator.serviceWorker.register('/sw.js', {
    scope: '/',
    updateViaCache: 'none',
  }).then((registration) => {
    const checkForUpdate = () => {
      if (navigator.onLine) void registration.update().catch(() => undefined)
    }

    // Mobile Chrome and installed PWAs can remain alive in the background for
    // days. Check immediately as well as whenever the app becomes active.
    checkForUpdate()
    window.addEventListener('online', checkForUpdate)
    window.addEventListener('focus', checkForUpdate)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') checkForUpdate()
    })
    window.setInterval(checkForUpdate, 5 * 60 * 1000)
  }).catch(() => undefined)
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
