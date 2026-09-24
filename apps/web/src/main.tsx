import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';

import { router } from './router.tsx';
import './styles.css';
import './grid.css';
import './share.css';
import './view.css';

const container = document.getElementById('root');
if (!container) throw new Error('missing #root');

createRoot(container).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
