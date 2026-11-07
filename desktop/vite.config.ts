import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig } from 'vite';

// Tauri's dev server conventions, as Quiver's: a fixed port the shell knows (tauri.conf.json's
// devUrl; 1430, beside Quiver's 1420, so both can run), the Rust sources left out of the watch.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  clearScreen: false,
  server: { port: 1430, strictPort: true, watch: { ignored: ['**/src-tauri/**'] } },
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
});
