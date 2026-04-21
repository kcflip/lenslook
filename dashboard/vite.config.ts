import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  // Serve the lenslook root as static files so fetch('/output/results.json') works
  publicDir: path.resolve(__dirname, '..'),
  server: {
    fs: { allow: ['..'] },
  },
  build: {
    outDir: '../dist-dashboard',
    copyPublicDir: false,
  },
});
