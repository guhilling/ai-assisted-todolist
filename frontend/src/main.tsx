/**
 * Browser entry point: mounts the app into the #root element from index.html.
 *
 * StrictMode is on, so effects run twice in development. The mount effect in App is written
 * to tolerate that -- it only reads.
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
