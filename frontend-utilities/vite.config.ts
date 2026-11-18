import path from 'path';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { defineConfig, loadEnv } from 'vite';
import svgr from 'vite-plugin-svgr';
import react from '@vitejs/plugin-react';

const PORT = 3040;

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // ดึงค่าตัวแปรสิ่งแวดล้อมตาม mode (development/production)
  const env = loadEnv(mode, process.cwd(), '');

  // backend ที่หน้าเว็บตอน dev (npm run dev) ส่ง /api /ws /storage /static ไปหา — ตั้งใน .env.development
  // VITE_BASE_URL = origin ของ backend-utilities (nginx) เช่น https://localhost — ไม่ใส่ path
  // WebSocket ใช้ host เดียวกัน (https → wss) ; ต่างกันได้ด้วย VITE_WS_TARGET
  // (โหมด production VITE_BASE_URL = /api เป็น path ของหน้าเว็บ ไม่ใช่ origin → vite preview ใช้ https://localhost)
  const apiTarget = (/^https?:\/\//i.test(env.VITE_BASE_URL || '') ? env.VITE_BASE_URL : 'https://localhost').replace(/\/+$/, '');
  const wsTarget = env.VITE_WS_TARGET || apiTarget.replace(/^http/i, 'ws');

  const configureProxy = (proxy: any) => {
    proxy.on('error', (err: any) => {
      if (err.code === 'ECONNRESET' || err.code === 'ECONNREFUSED') return;
      console.warn('[vite proxy error]', err.message);
    });
    proxy.on('proxyReqWs', (_proxyReq: any, _req: any, socket: any) => {
      socket.on('error', (err: any) => {
        if (err.code === 'ECONNRESET' || err.code === 'ECONNREFUSED') return;
      });
    });
  };

  const proxyOptions = {
    '/api': {
      target: apiTarget,
      changeOrigin: true,
      secure: false,
      configure: configureProxy,
    },
    '/ws': {
      target: wsTarget,
      ws: true,
      changeOrigin: true,
      secure: false,
      configure: configureProxy,
    },
    '/storage': {
      target: apiTarget,
      changeOrigin: true,
      secure: false,
      configure: configureProxy,
    },
    '/static': {
      target: apiTarget,
      changeOrigin: true,
      secure: false,
      configure: configureProxy,
    },
  };

  return {
    base: '/',
    plugins: [
      react(),
      basicSsl(),
      svgr({
        svgrOptions: {
          exportType: 'named',
          ref: true,
          svgo: false,
          titleProp: true,
          namedExport: 'ReactComponent',
        },
        include: '**/*.svg?react',
      }),
    ],
    resolve: {
      alias: {
        '@_types': path.resolve(__dirname, 'types'), // ✅ ให้ Vite match กับ tsconfig
        '@': path.resolve(__dirname, 'src'),
        '~': path.resolve(__dirname, 'node_modules'),
        src: path.resolve(__dirname, 'src'),
      },
    },
    assetsInclude: ['**/*.wasm'], // ระบุว่าไฟล์ .wasm เป็น asset
    server: {
      port: PORT,
      host: true,
      proxy: proxyOptions,
    },
    preview: {
      port: PORT,
      host: true,
      proxy: proxyOptions,
    },
  };
});
