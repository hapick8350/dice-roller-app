'use strict';

const config = require('./config');
const { createApp } = require('./app');

const { app, byd } = createApp(config);

app.listen(config.port, () => {
  console.log(`BOM 포털 실행: http://localhost:${config.port} (ByD 모드: ${byd.mode})`);
  if (!config.appUsers.length) console.log('주의: APP_USERS 가 설정되지 않아 로그인 없이 동작합니다');
});
