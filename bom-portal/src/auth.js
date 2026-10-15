'use strict';

// 로그인 / 세션 처리
//
// byd 모드: 사용자가 입력한 ByD ID/비밀번호로 ByD에 요청을 한 번 보내 인증 여부를 확인한다.
//   - 2xx             → 로그인 성공
//   - 401 / 로그인 화면으로 리다이렉트 → ID 또는 비밀번호 오류
//   - 403             → 인증은 됐지만 해당 서비스(작업센터) 권한 없음 → 로그인 거부
//   - 그 밖(404, 500 등) → 확인용 서비스가 아직 없거나 오류. 이때는 존재하지 않는 가짜 계정으로
//                       같은 주소를 한 번 더 호출(프로브)해서, 그 주소가 인증을 요구하는지(401) 확인한다.
//                       인증을 요구하는 주소라면 실제 계정의 404/500 은 "인증 통과 후 서비스 오류"이므로 성공 처리.
//                       가짜 계정에도 401 이 아니면 판단할 수 없으므로 로그인 거부 (보안상 안전한 쪽)
//   - 502/503/504     → ByD 연결 오류
// 비밀번호는 저장하지 않는다.

const crypto = require('node:crypto');

const COOKIE = 'bom_sid';
const MAX_FAILS = 5;
const FAIL_WINDOW_MS = 10 * 60 * 1000;

class AuthError extends Error {
  constructor(message, status = 401) {
    super(message);
    this.status = status;
    this.expected = true; // 로그에 스택을 남기지 않는다
  }
}

function createAuth(config, { fetchImpl = fetch } = {}) {
  const sessions = new Map(); // sid → { user, name, expires }
  const fails = new Map(); // key → { count, first }
  const ttl = config.sessionHours * 3600 * 1000;
  const mode = config.authMode;

  if (!['byd', 'local', 'none'].includes(mode)) throw new Error(`알 수 없는 AUTH_MODE: ${mode} (byd | local | none)`);
  if (mode === 'byd' && !config.byd.baseUrl) throw new Error('AUTH_MODE=byd 에는 BYD_BASE_URL(ByD 테넌트 주소)이 필요합니다');
  if (mode === 'local' && !config.appUsers.length) throw new Error('AUTH_MODE=local 에는 APP_USERS 설정이 필요합니다');

  const checkUrl = () => `${config.byd.baseUrl}${config.byd.authCheckPath}`;
  let probeCache = null; // { at, status }

  async function callByd(user, password) {
    let res;
    try {
      res = await fetchImpl(checkUrl(), {
        headers: { Authorization: 'Basic ' + Buffer.from(`${user}:${password}`).toString('base64') },
        redirect: 'manual',
        signal: AbortSignal.timeout(config.byd.timeoutMs || 30000),
      });
    } catch (e) {
      throw new AuthError(`SAP ByD에 연결할 수 없습니다 (${config.byd.baseUrl}): ${e.cause?.code || e.message}`, 503);
    }
    const body = await res.text().catch(() => '');
    return { status: res.status, body };
  }

  const isAuthFail = (st) => st === 401 || (st >= 300 && st < 400);

  // 확인 주소가 인증을 요구하는지: 존재하지 않는 계정으로 호출해 401 이 오는지 본다 (10분 캐시)
  async function addressRequiresAuth() {
    if (probeCache && Date.now() - probeCache.at < 10 * 60 * 1000) return isAuthFail(probeCache.status);
    const fakeUser = `ZZPROBE${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const r = await callByd(fakeUser, crypto.randomBytes(12).toString('base64url'));
    probeCache = { at: Date.now(), status: r.status };
    console.log(`[SAP 로그인 확인] 가짜 계정 프로브 → HTTP ${r.status}`);
    return isAuthFail(r.status);
  }

  async function verifyByd(user, password) {
    const r = await callByd(user, password);
    if (r.status >= 200 && r.status < 300) return;
    if (isAuthFail(r.status)) throw new AuthError('SAP 사용자 ID 또는 비밀번호가 올바르지 않습니다');
    if (r.status === 403) throw new AuthError('SAP 인증은 되었지만 BOM 조회 권한이 없습니다. SAP 관리자에게 권한을 요청하세요', 403);
    if ([502, 503, 504].includes(r.status)) {
      throw new AuthError(`SAP ByD 서버가 응답하지 않습니다 (HTTP ${r.status}). 잠시 후 다시 시도하세요`, 503);
    }
    // 404/500 등: 확인용 서비스가 없거나 서비스 오류. 주소가 인증을 요구하면 인증은 통과한 것
    const snippet = r.body.replace(/\s+/g, ' ').slice(0, 200);
    console.log(`[SAP 로그인 확인] ${user}: HTTP ${r.status} (${checkUrl()}) ${snippet}`);
    if (await addressRequiresAuth()) {
      console.log(`[SAP 로그인 확인] ${user}: 인증 통과 (확인용 서비스 응답 HTTP ${r.status} 은 무시)`);
      return;
    }
    throw new AuthError(
      `SAP 응답으로 로그인 여부를 판단할 수 없습니다 (HTTP ${r.status}). ` +
        '.env 의 BYD_AUTH_CHECK_PATH 를 ByD 에 실제로 있는 OData 서비스 주소로 지정하세요',
      502
    );
  }

  function verifyLocal(user, password) {
    const u = config.appUsers.find((x) => x.name.toUpperCase() === user);
    if (!u || !safeEq(u.password, password)) throw new AuthError('아이디 또는 비밀번호가 올바르지 않습니다');
  }

  async function login(rawUser, password, ip) {
    const user = String(rawUser || '').trim().toUpperCase();
    if (!user || !password) throw new AuthError('아이디와 비밀번호를 입력하세요', 400);
    if (mode === 'none') throw new AuthError('로그인이 꺼져 있습니다', 400);

    // 반복 실패 차단: ByD 계정 잠금을 막기 위해 ByD로 보내기 전에 막는다
    const key = `${ip}|${user}`;
    const f = fails.get(key);
    if (f && Date.now() - f.first < FAIL_WINDOW_MS && f.count >= MAX_FAILS) {
      throw new AuthError('로그인 실패가 반복되어 10분간 차단되었습니다. (SAP 계정 잠금 방지)', 429);
    }
    if (config.allowedUsers.length && !config.allowedUsers.includes(user)) {
      throw new AuthError('포털 사용이 허용되지 않은 사용자입니다. 관리자에게 문의하세요', 403);
    }
    try {
      if (mode === 'byd') await verifyByd(user, password);
      else verifyLocal(user, password);
    } catch (e) {
      if (e.status === 401) {
        const cur = f && Date.now() - f.first < FAIL_WINDOW_MS ? f : { count: 0, first: Date.now() };
        cur.count++;
        fails.set(key, cur);
      }
      throw e;
    }
    fails.delete(key);
    const sid = crypto.randomBytes(32).toString('base64url');
    sessions.set(sid, { user, expires: Date.now() + ttl });
    return { sid, user };
  }

  function sessionOf(req) {
    const sid = parseCookies(req.headers.cookie)[COOKIE];
    if (!sid) return null;
    const s = sessions.get(sid);
    if (!s) return null;
    if (s.expires < Date.now()) {
      sessions.delete(sid);
      return null;
    }
    s.expires = Date.now() + ttl; // 사용 중이면 연장
    return { sid, ...s };
  }

  const cookieAttrs = (req) => `Path=/; HttpOnly; SameSite=Lax${req.secure ? '; Secure' : ''}`;

  // 로그인 관련 라우트 (인증 미들웨어보다 먼저 등록)
  function routes(app) {
    app.get('/api/auth/info', (req, res) => {
      res.json({ mode, tenant: mode === 'byd' ? config.byd.baseUrl.replace(/^https?:\/\//, '') : null });
    });

    app.post('/api/auth/login', async (req, res) => {
      const { sid, user } = await login(req.body?.user, req.body?.password, req.ip);
      res.setHeader('Set-Cookie', `${COOKIE}=${sid}; ${cookieAttrs(req)}; Max-Age=${Math.floor(ttl / 1000)}`);
      console.log(`[로그인] ${user} (${req.ip})`);
      res.json({ user });
    });

    app.post('/api/auth/logout', (req, res) => {
      const s = sessionOf(req);
      if (s) sessions.delete(s.sid);
      res.setHeader('Set-Cookie', `${COOKIE}=; ${cookieAttrs(req)}; Max-Age=0`);
      res.json({ ok: true });
    });
  }

  // 로그인 확인. 화면 요청은 로그인 페이지로, API 요청은 401로 응답
  function middleware(req, res, next) {
    if (mode === 'none') {
      req.user = 'anonymous';
      return next();
    }
    if (isPublic(req.path)) return next();
    const s = sessionOf(req);
    if (s) {
      req.user = s.user;
      return next();
    }
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: '로그인이 필요합니다', login: true });
    if (req.path === '/' || req.path.endsWith('.html')) return res.redirect('/login.html');
    return res.status(401).end();
  }

  return { mode, routes, middleware, login };
}

const PUBLIC = new Set(['/login.html', '/login.js', '/style.css', '/api/auth/info', '/api/auth/login', '/api/auth/logout']);
const isPublic = (p) => PUBLIC.has(p);

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function safeEq(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

module.exports = { createAuth, AuthError };
