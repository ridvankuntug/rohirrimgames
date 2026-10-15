import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8090',
      // Online quiz/taboo routes and their WebSockets, served by `npx wrangler dev`.
      '/rt': { target: 'http://localhost:8787', ws: true }
    }
  }
});
