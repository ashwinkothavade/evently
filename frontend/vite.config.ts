import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// In development the API gateway runs on :8080; proxying keeps the browser on
// one origin so no CORS setup is needed locally.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8080' },
  },
});
