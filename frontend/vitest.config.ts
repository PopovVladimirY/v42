import { defineConfig } from 'vitest/config';
import path from 'path';

// Separate from vite.config.ts on purpose: the build pipeline and the test
// pipeline have different appetites. Keep them in their own corners.
// No @vitejs/plugin-react here -- tests don't need Fast Refresh, and esbuild's
// automatic JSX runtime compiles <Component /> without an explicit React import.
export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'react',
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    css: false,
  },
});
