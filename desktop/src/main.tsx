import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { createBackend } from './lib/backend';
import './index.css';

// Follows the system's light or dark appearance, as the window's frame does.
const dark = window.matchMedia('(prefers-color-scheme: dark)');
const applyTheme = () => document.documentElement.classList.toggle('dark', dark.matches);
applyTheme();
dark.addEventListener('change', applyTheme);

const backend = await createBackend();
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App backend={backend} />
  </StrictMode>
);
