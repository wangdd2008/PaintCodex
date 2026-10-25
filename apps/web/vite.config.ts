import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/paint': 'http://127.0.0.1:3210',
      '/health': 'http://127.0.0.1:3210',
    },
  },
});
