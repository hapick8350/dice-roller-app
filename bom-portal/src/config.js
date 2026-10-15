'use strict';

const fs = require('node:fs');
const path = require('node:path');

// .env 파일이 있으면 읽는다 (외부 라이브러리 없이 KEY=VALUE 형식만 지원)
function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

loadDotEnv(path.join(__dirname, '..', '.env'));

// ByD 주소는 어떤 형태로 입력해도 "https://호스트" 만 남긴다.
//   my123456.sapbydesign.com
//   https://my434992.businessbydesign.cloud.sap/sap/public/ap/ui/repository/...client.html?...
function normalizeTenantUrl(v) {
  let s = String(v).trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    return new URL(s).origin;
  } catch {
    return s.replace(/\/+$/, '');
  }
}

const env = process.env;

module.exports = {
  normalizeTenantUrl,
  port: Number(env.PORT || 3000),
  dataDir: env.DATA_DIR || path.join(__dirname, '..', 'data'),

  // mock: 내장 샘플 데이터로 동작 / byd: 실제 ByD 테넌트 연동
  bydMode: env.BYD_MODE || 'mock',

  // 로그인 방식
  //   byd   : SAP ByD 사용자 ID/비밀번호로 로그인 (ByD에 직접 확인)
  //   local : APP_USERS 에 적은 계정으로 로그인
  //   none  : 로그인 없음 (개발/체험용)
  authMode: env.AUTH_MODE || (env.BYD_BASE_URL ? 'byd' : env.APP_USERS ? 'local' : 'none'),

  // local 로그인 사용자 (예: "hong:pass1,kim:pass2")
  appUsers: (env.APP_USERS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const i = s.indexOf(':');
      return { name: s.slice(0, i), password: s.slice(i + 1) };
    }),

  // byd 로그인을 허용할 ByD 사용자 ID (쉼표 구분, 비우면 ByD 인증에 성공한 모든 사용자)
  allowedUsers: (env.ALLOWED_USERS || '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean),

  sessionHours: Number(env.SESSION_HOURS || 8),
  // HTTPS 리버스 프록시(Nginx/IIS 등) 뒤에서 실행할 때 1
  trustProxy: env.TRUST_PROXY === '1',

  byd: {
    // 예: https://my123456.sapbydesign.com
    baseUrl: normalizeTenantUrl(env.BYD_BASE_URL || ''),
    // 로그인 확인에 쓰는 ByD 경로. 사용자의 ID/비밀번호로 이 주소를 호출해 인증 여부를 판단한다
    authCheckPath: env.BYD_AUTH_CHECK_PATH || `${env.BYD_ODATA_BOM_PATH || '/sap/byd/odata/cust/v1/zbom'}/$metadata`,
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
