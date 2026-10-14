'use strict';

const { spawn } = require('node:child_process');
const config = require('./config');
const { createApp } = require('./app');

let app;
let byd;
try {
  ({ app, byd } = createApp(config));
} catch (e) {
  console.error(`[설정 오류] ${e.message}`);
  console.error('.env 파일을 확인하세요 (Windows: setup.bat 으로 다시 설정할 수 있습니다)');
  process.exit(1);
}

const server = app.listen(config.port, () => {
  const url = `http://localhost:${config.port}`;
  console.log(`BOM 포털 실행: ${url}`);
  console.log(`  로그인: ${{ byd: `SAP ByD 계정 (${config.byd.baseUrl})`, local: '포털 계정 (APP_USERS)', none: '없음' }[config.authMode]}`);
  console.log(`  BOM 데이터: ${byd.mode === 'mock' ? '샘플(MOCK)' : `SAP ByD (${config.byd.baseUrl})`}`);
  if (process.env.OPEN_BROWSER === '1') openBrowser(url);
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`포트 ${config.port} 가 이미 사용 중입니다. 포털이 이미 실행 중이거나, .env 의 PORT 를 바꿔야 합니다.`);
  } else {
    console.error(e);
  }
  process.exit(1);
});

function openBrowser(url) {
  const [cmd, args] =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
  } catch {
    // 브라우저를 못 열어도 서버는 계속 동작
  }
}
