import { defineConfig } from 'vite';
import { lanHttps } from './plugins/lanHttps';
import { remoteCamHub } from './plugins/remoteCamHub';

export default defineConfig({
  base: './',
  plugins: [lanHttps(), remoteCamHub()],
  server: {
    host: true,
    port: 5173,
    headers: {
      'Permissions-Policy': 'accelerometer=(self), gyroscope=(self), magnetometer=(self)',
    },
  },
  preview: {
    host: true,
  },
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    exclude: ['splat.js'],
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2048,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three-gpu-pathtracer') || id.includes('node_modules/three-mesh-bvh')) return 'pathtracer';
          if (id.includes('node_modules/three')) return 'three';
          if (id.includes('node_modules/@sparkjsdev')) return 'spark';
          if (id.includes('node_modules/splat.js')) return 'splat-train';
          return undefined;
        },
      },
    },
  },
});
