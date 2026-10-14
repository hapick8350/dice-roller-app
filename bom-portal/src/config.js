'use strict';

const fs = require('node:fs');
const path = require('node:path');

// .env 파일이 있으면 읽는다 (외부 라이브러리 없이 KEY=VALUE 형식만 지원)
function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

loadDotEnv(path.join(__dirname, '..', '.env'));

const env = process.env;

module.exports = {
  port: Number(env.PORT || 3000),
  dataDir: env.DATA_DIR || path.join(__dirname, '..', 'data'),

  // mock: 내장 샘플 데이터로 동작 / byd: 실제 ByD 테넌트 연동
  bydMode: env.BYD_MODE || 'mock',

  // 웹 로그인 사용자 (예: "hong:pass1,kim:pass2"). 비우면 로그인 없이 'anonymous'로 동작
  appUsers: (env.APP_USERS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const i = s.indexOf(':');
      return { name: s.slice(0, i), password: s.slice(i + 1) };
    }),

  byd: {
    // 예: https://my123456.sapbydesign.com
    baseUrl: (env.BYD_BASE_URL || '').replace(/\/$/, ''),
    // Communication Arrangement 의 통신 사용자
    user: env.BYD_USER || '',
    password: env.BYD_PASSWORD || '',
    // Custom OData 서비스 경로 (ByD: Application and User Management > OData Services)
    odataBomPath: env.BYD_ODATA_BOM_PATH || '/sap/byd/odata/cust/v1/zbom',
    odataMaterialPath: env.BYD_ODATA_MATERIAL_PATH || '/sap/byd/odata/cust/v1/zmaterial',
    // BOM 관리 SOAP 서비스 엔드포인트 (Communication Arrangement 에서 확인)
    soapBomUrl: env.BYD_SOAP_BOM_URL || '',
    timeoutMs: Number(env.BYD_TIMEOUT_MS || 30000),
  },

  upload: {
    maxFileBytes: Number(env.UPLOAD_MAX_BYTES || 5 * 1024 * 1024),
    maxRows: Number(env.UPLOAD_MAX_ROWS || 5000),
  },
};
