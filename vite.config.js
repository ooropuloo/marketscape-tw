import { defineConfig } from 'vite';
const stamp = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date()).replace(' ', ' ');
export default defineConfig(({ mode }) => ({
  base: './', // assets resolve relative to the page, so the same dist works at /, behind a path-prefixed reverse proxy, and on GitHub Pages /marketscape-tw/
  define: { __BUILD_TIME__: JSON.stringify(stamp), __STATIC__: mode === 'static' }, // `vite build --mode static` = read public/snapshot/*.json instead of /api (GitHub Pages)
  server: { proxy: { '/api': 'http://127.0.0.1:5303' } },
  build: { target: 'es2022' },
}));
