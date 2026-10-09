import react from '@vitejs/plugin-react';
import {defineConfig} from 'vite';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // sqlite-wasm locates its .wasm file relative to its own module URL;
  // pre-bundling breaks that.
  optimizeDeps: {exclude: ['@sqlite.org/sqlite-wasm']},
  worker: {format: 'es'},
});
