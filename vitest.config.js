import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./test/setup.js'],
    include: ['test/**/*.test.js', 'test/**/*.test.jsx'],
    threads: false, // 禁用多线程，避免 SQLite 和覆盖率问题
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: [
        'server/**/*.js',
        'client/**/*.js',
        'client/**/*.jsx',
        'minimal-claude.js',
        'minimal-opencode.js',
      ],
      exclude: [
        'server/index.js',
        'server/logger.js',
        'test/**',
        'node_modules/**',
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './client'),
    },
  },
});
