'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { startApp } = require('./helpers');

// 가짜 ByD: HONG/pw → 200, NOPERM/pw → 403, 그 외 → 401
async function fakeByd(t) {
  const calls = [];
  const server = http.createServer((req, res) => {
    const auth = Buffer.from((req.headers.authorization || '').replace('Basic ', ''), 'base64').toString();
    calls.push({ url: req.url, auth });
    if (auth === 'HONG:pw') return res.end('<edmx/>');
    if (auth === 'NOPERM:pw') return res.writeHead(403).end();
    res.writeHead(401).end();
  });
  await new Promise((r) => server.listen(0, r));
  t.after(() => server.close());
  return { url: `http://127.0.0.1:${server.address().port}`, calls };
}

async function login(base, user, password) {
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user, password }),
  });
  const cookie = (res.headers.get('set-cookie') || '').split(';')[0];
  return { status: res.status, body: await res.json(), cookie };
}

test('SAP ByD 로그인: ByD가 인정한 사용자만 로그인되고 세션으로 API를 쓴다', async (t) => {
  const byd = await fakeByd(t);
  const app = await startApp({
    authMode: 'byd',
    byd: { baseUrl: byd.url, authCheckPath: '/sap/byd/odata/cust/v1/zbom/$metadata', timeoutMs: 5000 },
  });
  t.after(app.close);

  // 로그인 전: API 401, 화면은 로그인 페이지로
  assert.equal((await fetch(`${app.base}/api/boms`)).status, 401);
  const page = await fetch(`${app.base}/`, { redirect: 'manual' });
  assert.equal(page.status, 302);
  assert.equal(page.headers.get('location'), '/login.html');
  assert.equal((await fetch(`${app.base}/login.html`)).status, 200);

  const info = await (await fetch(`${app.base}/api/auth/info`)).json();
  assert.equal(info.mode, 'byd');

  // 잘못된 비밀번호 / 권한 없음
  assert.equal((await login(app.base, 'hong', 'bad')).status, 401);
  const noperm = await login(app.base, 'noperm', 'pw');
  assert.equal(noperm.status, 403);
  assert.match(noperm.body.error, /권한/);

  // 성공 (소문자 입력도 대문자 ID로 처리)
  const ok = await login(app.base, 'hong', 'pw');
  assert.equal(ok.status, 200);
  assert.equal(ok.body.user, 'HONG');
  assert.match(ok.cookie, /^bom_sid=/);
  assert.ok(byd.calls.some((c) => c.url === '/sap/byd/odata/cust/v1/zbom/$metadata' && c.auth === 'HONG:pw'));

  const me = await (await fetch(`${app.base}/api/me`, { headers: { cookie: ok.cookie } })).json();
  assert.equal(me.user, 'HONG');
  assert.equal(me.authMode, 'byd');
  assert.equal((await fetch(`${app.base}/api/boms`, { headers: { cookie: ok.cookie } })).status, 200);

  // 로그아웃 후 세션 무효
  await fetch(`${app.base}/api/auth/logout`, { method: 'POST', headers: { cookie: ok.cookie } });
  assert.equal((await fetch(`${app.base}/api/me`, { headers: { cookie: ok.cookie } })).status, 401);
});

test('SAP ByD 로그인: 반복 실패 시 ByD로 보내기 전에 차단한다 (계정 잠금 방지)', async (t) => {
  const byd = await fakeByd(t);
  const app = await startApp({ authMode: 'byd', byd: { baseUrl: byd.url, authCheckPath: '/x', timeoutMs: 5000 } });
  t.after(app.close);
  for (let i = 0; i < 5; i++) assert.equal((await login(app.base, 'kim', 'bad')).status, 401);
  const before = byd.calls.length;
  const blocked = await login(app.base, 'kim', 'bad');
  assert.equal(blocked.status, 429);
  assert.equal(byd.calls.length, before, '차단 중에는 ByD를 호출하지 않아야 한다');
});

test('SAP ByD 로그인: ByD에 연결할 수 없으면 503', async (t) => {
  const app = await startApp({ authMode: 'byd', byd: { baseUrl: 'http://127.0.0.1:1', authCheckPath: '/x', timeoutMs: 2000 } });
  t.after(app.close);
  const r = await login(app.base, 'hong', 'pw');
  assert.equal(r.status, 503);
  assert.match(r.body.error, /연결할 수 없습니다/);
});

test('허용 사용자 목록(ALLOWED_USERS)에 없으면 거부', async (t) => {
  const byd = await fakeByd(t);
  const app = await startApp({
    authMode: 'byd',
    allowedUsers: ['PARK'],
    byd: { baseUrl: byd.url, authCheckPath: '/x', timeoutMs: 5000 },
  });
  t.after(app.close);
  assert.equal((await login(app.base, 'hong', 'pw')).status, 403);
});

test('로그인한 SAP 사용자 ID가 업로드 반영자로 기록된다', async (t) => {
  const byd = await fakeByd(t);
  const app = await startApp({ authMode: 'byd', byd: { baseUrl: byd.url, authCheckPath: '/x', timeoutMs: 5000 } });
  t.after(app.close);
  const { cookie } = await login(app.base, 'hong', 'pw');
  const rel = await fetch(`${app.base}/api/boms/P100/FG-1000/versions/3/release`, { method: 'POST', headers: { cookie } });
  assert.equal(rel.status, 200);
  const bom = await (await fetch(`${app.base}/api/boms/P100/FG-1000`, { headers: { cookie } })).json();
  assert.equal(bom.versions.find((v) => v.version === '3').changedBy, 'HONG');
});

test('local 로그인 (APP_USERS)', async (t) => {
  const app = await startApp({ authMode: 'local', appUsers: [{ name: 'admin', password: 'pw' }] });
  t.after(app.close);
  assert.equal((await login(app.base, 'admin', 'x')).status, 401);
  const ok = await login(app.base, 'admin', 'pw');
  assert.equal(ok.status, 200);
  assert.equal((await fetch(`${app.base}/api/me`, { headers: { cookie: ok.cookie } })).status, 200);
});

// 실제 ByD 상황 재현: 확인용 OData 서비스가 없으면 인증 통과 후 500, 인증 실패면 401
async function bydWithoutService(t, { authEnforced = true } = {}) {
  const calls = [];
  const server = http.createServer((req, res) => {
    const auth = Buffer.from((req.headers.authorization || '').replace('Basic ', ''), 'base64').toString();
    calls.push(auth.split(':')[0]);
    if (authEnforced && auth !== 'HONG:pw') return res.writeHead(401).end();
    res.writeHead(500, { 'Content-Type': 'text/html' }).end('<html>Service cannot be reached</html>');
  });
  await new Promise((r) => server.listen(0, r));
  t.after(() => server.close());
  return { url: `http://127.0.0.1:${server.address().port}`, calls };
}

test('SAP ByD 로그인: 확인용 서비스가 없어 500 이 와도, 인증을 요구하는 주소면 로그인된다', async (t) => {
  const byd = await bydWithoutService(t);
  const app = await startApp({ authMode: 'byd', byd: { baseUrl: byd.url, authCheckPath: '/sap/byd/odata/cust/v1/zbom/$metadata', timeoutMs: 5000 } });
  t.after(app.close);
  const ok = await login(app.base, 'hong', 'pw');
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.ok(byd.calls.some((u) => u.startsWith('ZZPROBE')), '가짜 계정 프로브를 보내야 한다');
  // 틀린 비밀번호는 여전히 거부
  const bad = await login(app.base, 'hong', 'nope');
  assert.equal(bad.status, 401);
});

test('SAP ByD 로그인: 가짜 계정에도 500 이면 판단 불가로 거부한다 (아무 비밀번호나 통과 방지)', async (t) => {
  const byd = await bydWithoutService(t, { authEnforced: false });
  const app = await startApp({ authMode: 'byd', byd: { baseUrl: byd.url, authCheckPath: '/x', timeoutMs: 5000 } });
  t.after(app.close);
  const r = await login(app.base, 'hong', 'anything');
  assert.equal(r.status, 502);
  assert.match(r.body.error, /BYD_AUTH_CHECK_PATH/);
});
