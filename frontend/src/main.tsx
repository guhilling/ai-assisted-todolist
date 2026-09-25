/**
 * Browser entry point: mounts the app into the #root element from index.html.
 *
 * StrictMode is on, so in development React mounts, runs effects, unmounts and runs them
 * again. App's mount effect has no cleanup, so its two runs overlap and it loads everything
 * twice. That is wasteful rather than wrong, and it is worth leaving: it is exactly the
 * duplication that exposed a check-then-act race in the backend's user creation, which
 * production would have hit with two browser tabs instead.
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
