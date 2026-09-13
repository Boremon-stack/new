import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// styles.css first: the shared design system must be the BASE layer so each
// module's own stylesheet wins equal-specificity ties instead of losing them.
import './styles.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
