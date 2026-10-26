import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * 画布页通过这个代理保持一条 SSE 长连接。daemon 退出时 http-proxy 只会打一条
 * ECONNRESET 日志，却把浏览器侧的响应挂着不结束，于是前端的 EventSource 永远
 * 不会触发 `error`，状态栏一直谎称「实时中」。在代理报错时主动销毁客户端响应，
 * EventSource 才能看见断线并自行重连。
 */
const target = 'http://127.0.0.1:3210';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/paint': {
        target,
        configure(proxy) {
          proxy.on('error', (_error, _request, response) => {
            if (response && !response.writableEnded) {
              response.destroy();
            }
          });
        },
      },
      '/health': target,
      '/monitor': target,
    },
  },
});
