'use strict';

(async () => {
  const form = document.getElementById('login-form');
  const msg = document.getElementById('login-msg');
  const btn = document.getElementById('login-btn');

  try {
    const info = await (await fetch('/api/auth/info')).json();
    if (info.mode === 'none') return location.replace('/');
    if (info.mode === 'byd') {
      document.getElementById('login-sub').textContent = `SAP ByD 계정으로 로그인 · ${info.tenant}`;
      document.getElementById('user').placeholder = 'SAP 사용자 ID';
      document.getElementById('login-note').textContent =
        'SAP Business ByDesign 로그인과 같은 ID/비밀번호를 입력하세요. 여러 번 틀리면 SAP 계정이 잠길 수 있습니다.';
    } else {
      document.getElementById('login-sub').textContent = '포털 계정으로 로그인';
    }
  } catch {
    // 정보 조회 실패해도 로그인은 시도할 수 있게 둔다
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    msg.hidden = true;
    btn.disabled = true;
    btn.textContent = '확인 중…';
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: form.user.value, password: form.password.value }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `로그인 실패 (HTTP ${res.status})`);
      location.replace('/');
    } catch (err) {
      msg.textContent = err.message;
      msg.hidden = false;
      form.password.value = '';
      form.password.focus();
    } finally {
      btn.disabled = false;
      btn.textContent = '로그인';
    }
  });
})();
