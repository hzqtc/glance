import { defineConfig, type Plugin } from 'vite';
import legacy from '@vitejs/plugin-legacy';

/**
 * Forces production HTML to load the ES5 legacy SystemJS bundle directly
 * (no <script type="module">), preventing Safari 12 from mis-selecting
 * modern ESM chunks while preserving the external Autoprefixed CSS link.
 */
function safari12ClassicHtml(): Plugin {
  return {
    name: 'safari12-classic-html',
    apply: 'build',
    enforce: 'post',
    transformIndexHtml(html) {
      return html
        .replace(/<script type="module"[\s\S]*?<\/script>\s*/g, '')
        .replace(/<script nomodule>!function\(\)\{[\s\S]*?<\/script>\s*/g, '')
        .replace(/<script nomodule crossorigin /g, '<script ')
        .replace(/<link rel="stylesheet" crossorigin /g, '<link rel="stylesheet" ');
    },
  };
}

export default defineConfig({
  plugins: [
    legacy({
      targets: ['ios_saf >= 12', 'safari >= 12'],
    }),
    safari12ClassicHtml(),
  ],
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'preact',
  },
  server: {
    port: 5173,
    headers: {
      'Cache-Control': 'no-store',
    },
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8080',
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 4173,
    headers: {
      'Cache-Control': 'no-store',
    },
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8080',
        changeOrigin: true,
      },
    },
  },
  build: {
    cssTarget: 'safari12',
    minify: 'terser',
  },
});
