import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';

function viteBase() {
  const raw = process.env.SITE_BASE || '/';
  if (raw === '/' || raw === '') return '/';
  const trimmed = raw.replace(/\/+$/, '');
  return `${trimmed.startsWith('/') ? trimmed : `/${trimmed}`}/`;
}

export default defineConfig({ base: viteBase(), plugins: [vue(), tailwindcss()], server: { port: 5186, strictPort: true }, preview: { port: 4186, strictPort: true } });
