import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cpSync, readdirSync, writeFileSync } from 'node:fs';
import * as config from './src/config.ts';

// 화면 페이지. 여기 있는 HTML만 dist에 빌드되고 배포된다
const pages = ['index.html', ...readdirSync('.').filter(d => d.startsWith('sub_')).map(d => `${d}/Index.html`)];

// 옛 <script src>(모듈 아님)·서비스워커·아이콘은 Vite가 묶지 않으므로 그대로 복사한다
const LEGACY = ['js', 'icons', 'sw.js', 'manifest.webmanifest'];

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'copy-legacy',
      closeBundle: () => {
        LEGACY.forEach(p => cpSync(p, `dist/${p}`, { recursive: true }));
        // 서비스워커(sw.js)는 묶이지 않으므로 연결 값(src/config.ts)을 일반 스크립트로 내놓는다
        writeFileSync('dist/js/config.js', Object.entries(config).map(([k, v]) => `const ${k} = ${JSON.stringify(v)};`).join('\n') + '\n');
      }
    }
  ],
  build: { rollupOptions: { input: pages } }
});
