import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { MxDeskWorkbench } from '@/pages/MxDeskWorkbench'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MxDeskWorkbench />
  </StrictMode>,
)
