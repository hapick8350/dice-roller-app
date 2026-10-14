'use strict';

// ── 공통 유틸 ─────────────────────────────────────────────
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const STATUS = { IN_PREPARATION: '작성중', RELEASED: '해제(유효)', OBSOLETE: '폐기' };
const CHANGE = { CREATED: '최초 등록', ADDED: '구성품 추가', REMOVED: '구성품 삭제', QTY_CHANGED: '수량 변경', UNIT_CHANGED: '단위 변경' };
const ACTION = { CREATE: '신규 등록', NEW_VERSION: '새 버전', NO_CHANGE: '변경 없음' };
const JOB = { VALIDATED: '검증완료', INVALID: '검증오류', POSTING: '반영중', POSTED: '반영완료', PARTIAL: '일부실패', FAILED: '반영실패' };

const badge = (code, labels) => `<span class="st st-${esc(code)}">${esc(labels[code] || code)}</span>`;
const fmtDt = (s) => {
  if (!s) return '';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return String(s);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
const fmtNum = (n) => (n === null || n === undefined || n === '' ? '' : Number(n).toLocaleString('ko-KR', { maximumFractionDigits: 6 }));

function toast(msg, isErr = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `show${isErr ? ' err' : ''}`;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.className = ''), isErr ? 6000 : 3000);
}

async function api(url, opts = {}) {
  const res = await fetch(url, opts);
  const isJson = (res.headers.get('content-type') || '').includes('json');
  const body = isJson ? await res.json() : await res.text();
  if (!res.ok) throw new Error((isJson && body.error) || body || `HTTP ${res.status}`);
  return body;
}

const formParams = (form) => {
  const p = new URLSearchParams();
  for (const [k, v] of new FormData(form)) if (typeof v === 'string' && v.trim()) p.set(k, v.trim());
  return p;
};

function download(url) {
  const a = document.createElement('a');
  a.href = url;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function guard(fn) {
  return async (...args) => {
    try {
      await fn(...args);
    } catch (e) {
      toast(e.message, true);
    }
  };
}

// ── 탭 ───────────────────────────────────────────────────
$('#tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-tab]');
  if (!b) return;
  showTab(b.dataset.tab);
});
function showTab(name) {
  $$('#tabs button').forEach((x) => x.classList.toggle('active', x.dataset.tab === name));
  $$('.tab').forEach((x) => x.classList.toggle('active', x.id === `tab-${name}`));
  if (name === 'jobs') loadJobs();
}

// ── BOM 조회 ─────────────────────────────────────────────
let selectedBom = null;

$('#bom-search').addEventListener('submit', guard(async (e) => {
  e.preventDefault();
  await loadBoms();
}));

async function loadBoms() {
  const rows = await api(`/api/boms?${formParams($('#bom-search'))}`);
  const tb = $('#bom-list tbody');
  tb.innerHTML = rows.length
    ? rows
        .map(
          (r) => `<tr data-material="${esc(r.material)}" data-plant="${esc(r.plant)}">
          <td>${esc(r.material)}</td><td>${esc(r.description)}</td><td>${esc(r.plant)}</td>
          <td>${r.releasedVersion ? 'v' + esc(r.releasedVersion) : '<span class="st st-INVALID">없음</span>'}</td>
          <td>${esc(r.releasedValidFrom || '')}</td>
          <td class="num">${r.itemCount}</td><td class="num">${r.versionCount}</td>
          <td>${r.draftCount ? badge('IN_PREPARATION', STATUS) : ''}</td>
          <td>${esc(r.lastChangedBy || '')} ${esc(fmtDt(r.lastChangedAt))}</td></tr>`
        )
        .join('')
    : '<tr><td colspan="9" class="empty">조회 결과가 없습니다</td></tr>';
}

$('#bom-list tbody').addEventListener('click', guard(async (e) => {
  const tr = e.target.closest('tr[data-material]');
  if (!tr) return;
  $$('#bom-list tbody tr').forEach((x) => x.classList.toggle('sel', x === tr));
  await openBom(tr.dataset.material, tr.dataset.plant);
}));

async function openBom(material, plant, version) {
  const el = $('#bom-detail');
  el.innerHTML = '<p class="loading">불러오는 중…</p>';
  const bom = await api(`/api/boms/${encodeURIComponent(plant)}/${encodeURIComponent(material)}`);
  selectedBom = bom;
  const released = bom.versions.find((v) => v.status === 'RELEASED');
  const cur = bom.versions.find((v) => v.version === version) || released || bom.versions.at(-1);
  renderBomDetail(cur.version);
}

function renderBomDetail(version) {
  const bom = selectedBom;
  const v = bom.versions.find((x) => x.version === version);
  const opts = bom.versions.map((x) => `<option value="${esc(x.version)}">v${esc(x.version)} (${esc(STATUS[x.status] || x.status)})</option>`).join('');
  $('#bom-detail').innerHTML = `
    <div class="detail-head">
      <div>
        <h2>${esc(bom.material)} <small>${esc(bom.description)}</small></h2>
        <div class="meta">플랜트 ${esc(bom.plant)} · 기준수량 ${fmtNum(bom.baseQty)} ${esc(bom.baseUnit)}</div>
      </div>
      <div>
        <button data-act="explode">정전개</button>
        <button data-act="history">변경이력</button>
        <button data-act="xlsx">엑셀</button>
      </div>
    </div>
    <div class="versions">
      ${bom.versions
        .map((x) => `<button data-ver="${esc(x.version)}" class="${x.version === version ? 'active' : ''}">v${esc(x.version)} ${badge(x.status, STATUS)}</button>`)
        .join('')}
    </div>
    <div class="ver-info">
      <span>유효시작일 <b>${esc(v.validFrom)}</b></span>
      <span>변경자 <b>${esc(v.changedBy)}</b> ${esc(fmtDt(v.changedAt))}</span>
      <span>설명 <b>${esc(v.description)}</b></span>
      ${v.status === 'IN_PREPARATION' ? `<button class="ok" data-act="release" data-ver="${esc(v.version)}">이 버전 해제(유효화)</button>` : ''}
    </div>
    <table class="grid">
      <thead><tr><th>항목</th><th>구성품</th><th>품명</th><th class="num">수량</th><th>단위</th><th>하위BOM</th></tr></thead>
      <tbody>${v.items
        .map(
          (i) => `<tr><td>${esc(i.itemNo)}</td><td>${esc(i.component)}</td><td>${esc(i.componentDescription)}</td>
          <td class="num">${fmtNum(i.qty)}</td><td>${esc(i.unit)}</td><td>${i.hasBom ? '있음' : ''}</td></tr>`
        )
        .join('')}</tbody>
    </table>
    ${
      bom.versions.length > 1
        ? `<div class="compare-bar">버전 비교
            <select id="cmp-from">${opts}</select> → <select id="cmp-to">${opts}</select>
            <button data-act="compare">비교</button></div>
           <div id="compare-result"></div>`
        : ''
    }`;
  if (bom.versions.length > 1) {
    const idx = bom.versions.findIndex((x) => x.version === version);
    $('#cmp-from').value = bom.versions[Math.max(0, idx - 1)].version;
    $('#cmp-to').value = version;
  }
}

$('#bom-detail').addEventListener('click', guard(async (e) => {
  const b = e.target.closest('button');
  if (!b || !selectedBom) return;
  const { material, plant } = selectedBom;
  if (b.dataset.ver && !b.dataset.act) return renderBomDetail(b.dataset.ver);
  switch (b.dataset.act) {
    case 'release': {
      if (!confirm(`${material} v${b.dataset.ver} 을(를) 해제(유효화)하시겠습니까?\n기존 유효 버전은 폐기 상태가 됩니다.`)) return;
      await api(`/api/boms/${encodeURIComponent(plant)}/${encodeURIComponent(material)}/versions/${encodeURIComponent(b.dataset.ver)}/release`, { method: 'POST' });
      toast('해제되었습니다');
      await openBom(material, plant, b.dataset.ver);
      await loadBoms();
      break;
    }
    case 'compare': {
      const from = $('#cmp-from').value;
      const to = $('#cmp-to').value;
      const r = await api(`/api/boms/${encodeURIComponent(plant)}/${encodeURIComponent(material)}/compare?from=${from}&to=${to}`);
      $('#compare-result').innerHTML = changesTable(r.changes, `v${from} → v${to}`);
      break;
    }
    case 'explode': {
      const f = $('#explode-form');
      f.material.value = material;
      f.plant.value = plant;
      showTab('analysis');
      f.requestSubmit();
      break;
    }
    case 'history': {
      const f = $('#history-form');
      f.reset();
      f.material.value = material;
      f.plant.value = plant;
      showTab('history');
      f.requestSubmit();
      break;
    }
    case 'xlsx':
      download(`/api/boms/${encodeURIComponent(plant)}/${encodeURIComponent(material)}?format=xlsx`);
      break;
  }
}));

function changesTable(changes, title = '') {
  if (!changes.length) return `<div class="msg info">${esc(title)} 변경된 구성품이 없습니다.</div>`;
  return `<table class="grid">
    <thead><tr><th>유형</th><th>구성품</th><th>품명</th><th class="num">이전</th><th class="num">변경</th></tr></thead>
    <tbody>${changes
      .map(
        (c) => `<tr><td>${badge(c.type, CHANGE)}</td><td>${esc(c.component)}</td><td>${esc(c.componentDescription || '')}</td>
        <td class="num">${c.oldQty !== undefined ? fmtNum(c.oldQty) + ' ' + esc(c.oldUnit) : ''}</td>
        <td class="num">${c.newQty !== undefined ? fmtNum(c.newQty) + ' ' + esc(c.newUnit) : ''}</td></tr>`
      )
      .join('')}</tbody></table>`;
}

// ── 전개 분석 ─────────────────────────────────────────────
$('#explode-form').addEventListener('submit', guard(async (e) => {
  e.preventDefault();
  const r = await api(`/api/explode?${formParams(e.target)}`);
  $('#analysis-result').innerHTML = `
    <h3 class="section">정전개: ${esc(r.material)} ${esc(r.description)} — v${esc(r.version || '-')} · 수량 ${fmtNum(r.qty)}${r.date ? ' · 기준일 ' + esc(r.date) : ''}</h3>
    ${r.warnings.map((w) => `<div class="msg warn">${esc(w)}</div>`).join('')}
    <table class="grid">
      <thead><tr><th>레벨</th><th>구성품</th><th>품명</th><th class="num">단위수량</th><th class="num">소요량</th><th>단위</th><th>하위BOM</th></tr></thead>
      <tbody>${r.rows
        .map(
          (x) => `<tr><td class="lvl">${'·'.repeat(x.level)}${x.level}</td>
          <td><span class="indent" style="width:${(x.level - 1) * 18}px"></span><span class="${x.hasBom ? 'subasm' : ''}">${esc(x.component)}</span></td>
          <td>${esc(x.componentDescription)}</td><td class="num">${fmtNum(x.qtyPer)}</td><td class="num">${fmtNum(x.totalQty)}</td>
          <td>${esc(x.unit)}</td><td>${x.hasBom ? 'v' + esc(x.version || '-') : ''}</td></tr>`
        )
        .join('')}</tbody>
    </table>
    <h3 class="section">최하위 자재 소요량 합계</h3>
    <table class="grid">
      <thead><tr><th>자재</th><th>품명</th><th class="num">총 소요량</th><th>단위</th></tr></thead>
      <tbody>${r.leafTotals
        .map((t) => `<tr><td>${esc(t.component)}</td><td>${esc(t.componentDescription)}</td><td class="num">${fmtNum(t.totalQty)}</td><td>${esc(t.unit)}</td></tr>`)
        .join('')}</tbody>
    </table>`;
}));

$('#whereused-form').addEventListener('submit', guard(async (e) => {
  e.preventDefault();
  const r = await api(`/api/where-used?${formParams(e.target)}`);
  $('#analysis-result').innerHTML = `
    <h3 class="section">역전개: ${esc(r.component)} ${esc(r.description)}${r.date ? ' · 기준일 ' + esc(r.date) : ''}</h3>
    ${
      r.rows.length
        ? `<table class="grid">
      <thead><tr><th>레벨</th><th>자재</th><th>사용 상위품목</th><th>품명</th><th>버전</th><th class="num">수량</th><th>단위</th><th>최상위</th></tr></thead>
      <tbody>${r.rows
        .map(
          (x) => `<tr><td class="lvl">${x.level}</td><td><span class="indent" style="width:${(x.level - 1) * 18}px"></span>${esc(x.component)}</td>
          <td>${esc(x.parent)}</td><td>${esc(x.parentDescription)}</td><td>v${esc(x.version)}</td>
          <td class="num">${fmtNum(x.qty)}</td><td>${esc(x.unit)}</td><td>${x.topLevel ? '●' : ''}</td></tr>`
        )
        .join('')}</tbody></table>`
        : '<div class="msg info">이 자재를 사용하는 유효 BOM이 없습니다.</div>'
    }`;
}));

// ── 변경이력 ─────────────────────────────────────────────
$('#history-form').addEventListener('submit', guard(async (e) => {
  e.preventDefault();
  const rows = await api(`/api/history?${formParams(e.target)}`);
  $('#history-table tbody').innerHTML = rows.length
    ? rows
        .map(
          (r) => `<tr>
        <td>${esc(fmtDt(r.changedAt))}</td><td>${esc(r.changedBy)}</td>
        <td title="${esc(r.materialDescription)}">${esc(r.material)}</td><td>${esc(r.plant)}</td>
        <td>v${esc(r.version)}</td><td>${badge(r.status, STATUS)}</td><td>${badge(r.type, CHANGE)}</td>
        <td>${esc(r.component || '')}</td><td>${esc(r.componentDescription || '')}</td>
        <td class="num">${r.oldQty !== undefined ? fmtNum(r.oldQty) + ' ' + esc(r.oldUnit) : ''}</td>
        <td class="num">${r.newQty !== undefined ? fmtNum(r.newQty) + ' ' + esc(r.newUnit) : ''}</td>
        <td>${esc(r.validFrom)}</td><td class="wrap">${esc(r.reason)}</td></tr>`
        )
        .join('')
    : '<tr><td colspan="13" class="empty">변경이력이 없습니다</td></tr>';
}));

// ── 엑셀 내보내기 버튼 ───────────────────────────────────
document.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-export]');
  if (!b) return;
  const map = {
    boms: ['/api/boms', '#bom-search'],
    explode: ['/api/explode', '#explode-form'],
    whereused: ['/api/where-used', '#whereused-form'],
    history: ['/api/history', '#history-form'],
  };
  const [url, form] = map[b.dataset.export];
  const f = $(form);
  if (!f.checkValidity()) return f.reportValidity();
  const p = formParams(f);
  p.set('format', 'xlsx');
  download(`${url}?${p}`);
});

// ── 엑셀 등록 ─────────────────────────────────────────────
$('#upload-form').addEventListener('submit', guard(async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const out = $('#upload-result');
  out.innerHTML = '<p class="loading">검증 중…</p>';
  try {
    const r = await api('/api/upload/preview', { method: 'POST', body: fd });
    renderPreview(r);
  } catch (err) {
    out.innerHTML = `<div class="msg err">${esc(err.message)}</div>`;
  }
}));

function renderPreview(r) {
  const count = (a) => r.boms.filter((b) => b.action === a).length;
  const warns = r.issues.filter((i) => i.level === 'warning').length;
  const canPost = r.status === 'VALIDATED' && r.boms.some((b) => b.action !== 'NO_CHANGE');
  $('#upload-result').innerHTML = `
    <div class="summary">
      <div class="card"><div class="k">BOM</div><div class="v">${r.boms.length}</div></div>
      <div class="card"><div class="k">신규 등록</div><div class="v">${count('CREATE')}</div></div>
      <div class="card"><div class="k">새 버전</div><div class="v">${count('NEW_VERSION')}</div></div>
      <div class="card"><div class="k">변경 없음</div><div class="v">${count('NO_CHANGE')}</div></div>
      <div class="card"><div class="k">오류</div><div class="v ${r.errorCount ? 'err' : ''}">${r.errorCount}</div></div>
      <div class="card"><div class="k">경고</div><div class="v ${warns ? 'warn' : ''}">${warns}</div></div>
    </div>
    ${
      r.errorCount
        ? `<div class="msg err">오류가 있어 SAP에 반영할 수 없습니다. 파일을 수정한 후 다시 업로드하세요.
           <a href="/api/upload/jobs/${r.jobId}/issues.xlsx">검증결과 엑셀</a></div>`
        : canPost
          ? `<div class="commit-bar card">
              <label><input type="checkbox" id="release-now"> 등록 후 바로 해제(유효화)</label>
              <button class="ok" id="commit-btn" data-job="${r.jobId}">SAP 반영</button>
              <span class="lvl">체크하지 않으면 작성중 버전으로 등록되며, BOM 조회 화면에서 검토 후 해제할 수 있습니다.</span>
            </div>`
          : '<div class="msg info">현재 SAP BOM과 달라진 내용이 없습니다.</div>'
    }
    ${r.issues.length ? issuesTable(r.issues) : ''}
    <h3 class="section">BOM별 변경 내용</h3>
    ${r.boms
      .map(
        (b) => `<details class="bom-change" ${b.action !== 'NO_CHANGE' && r.boms.length <= 10 ? 'open' : ''}>
        <summary>${badge(b.action, ACTION)} <b>${esc(b.material)}</b> ${esc(b.materialDescription)} · ${esc(b.plant)}
          · 유효시작 ${esc(b.validFrom)} · 구성품 ${b.items.length}개
          ${b.compareVersion ? `· 비교기준 v${esc(b.compareVersion)}` : ''}
          ${b.valid ? '' : '<span class="st st-INVALID">오류</span>'}
          ${b.headerChanged ? '<span class="st st-QTY_CHANGED">기준수량/단위 변경</span>' : ''}</summary>
        <div>${b.action === 'CREATE' ? itemsTable(b.items) : changesTable(b.changes)}</div>
      </details>`
      )
      .join('')}`;
}

function issuesTable(issues) {
  return `<h3 class="section">검증 결과</h3><table class="grid">
    <thead><tr><th>구분</th><th>행</th><th>모품목</th><th>항목</th><th>내용</th></tr></thead>
    <tbody>${issues
      .map(
        (i) => `<tr><td>${i.level === 'error' ? '<span class="st st-INVALID">오류</span>' : '<span class="st st-IN_PREPARATION">경고</span>'}</td>
        <td>${esc(i.rowNo ?? '')}</td><td>${esc(i.material)}</td><td>${esc(i.field)}</td><td class="wrap">${esc(i.message)}</td></tr>`
      )
      .join('')}</tbody></table>`;
}

function itemsTable(items) {
  return `<table class="grid"><thead><tr><th>항목</th><th>구성품</th><th class="num">수량</th><th>단위</th></tr></thead>
    <tbody>${items.map((i) => `<tr><td>${esc(i.itemNo)}</td><td>${esc(i.component)}</td><td class="num">${fmtNum(i.qty)}</td><td>${esc(i.unit)}</td></tr>`).join('')}</tbody></table>`;
}

$('#upload-result').addEventListener('click', guard(async (e) => {
  const b = e.target.closest('#commit-btn');
  if (!b) return;
  const release = $('#release-now').checked;
  if (!confirm(`SAP에 반영하시겠습니까?${release ? '\n등록 후 바로 해제(유효화)됩니다.' : ''}`)) return;
  b.disabled = true;
  b.textContent = '반영 중…';
  try {
    const job = await api(`/api/upload/jobs/${b.dataset.job}/commit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ release }),
    });
    $('#upload-result').innerHTML = jobResult(job);
    toast(`반영 결과: ${JOB[job.status] || job.status}`, job.status !== 'POSTED');
    $('#upload-form').reset();
  } catch (err) {
    b.disabled = false;
    b.textContent = 'SAP 반영';
    throw err;
  }
}));

function jobResult(job) {
  const cls = job.status === 'POSTED' ? 'ok' : job.status === 'PARTIAL' ? 'warn' : 'err';
  return `<div class="msg ${cls}">작업 #${job.id} ${esc(JOB[job.status] || job.status)}</div>
    <table class="grid"><thead><tr><th>모품목</th><th>플랜트</th><th>처리</th><th>결과</th><th>버전</th><th>메시지</th></tr></thead>
    <tbody>${job.results
      .map(
        (x) => `<tr><td>${esc(x.material)}</td><td>${esc(x.plant)}</td><td>${badge(x.action, ACTION)}</td>
        <td>${x.success ? '<span class="st st-POSTED">성공</span>' : '<span class="st st-FAILED">실패</span>'}</td>
        <td>${x.version ? 'v' + esc(x.version) : ''}</td><td class="wrap">${esc(x.message)}</td></tr>`
      )
      .join('')}</tbody></table>`;
}

// ── 업로드 내역 ───────────────────────────────────────────
$('#jobs-refresh').addEventListener('click', guard(loadJobs));

async function loadJobs() {
  const rows = await api('/api/upload/jobs');
  $('#jobs-table tbody').innerHTML = rows.length
    ? rows
        .map(
          (j) => `<tr data-id="${j.id}"><td>${j.id}</td><td>${esc(j.file_name)}</td><td>${esc(j.uploaded_by)}</td>
        <td>${esc(fmtDt(j.uploaded_at))}</td><td>${badge(j.status, JOB)}</td><td class="num">${j.bom_count}</td>
        <td class="num">${j.error_count}</td><td>${esc(j.posted_by || '')}</td><td>${esc(fmtDt(j.posted_at))}</td>
        <td>${j.posted_at ? (j.release_now ? '예' : '아니오') : ''}</td></tr>`
        )
        .join('')
    : '<tr><td colspan="10" class="empty">업로드 내역이 없습니다</td></tr>';
}

$('#jobs-table tbody').addEventListener('click', guard(async (e) => {
  const tr = e.target.closest('tr[data-id]');
  if (!tr) return;
  $$('#jobs-table tbody tr').forEach((x) => x.classList.toggle('sel', x === tr));
  const job = await api(`/api/upload/jobs/${tr.dataset.id}`);
  const el = $('#job-detail');
  if (job.results.length) el.innerHTML = `<h3 class="section">작업 #${job.id} 반영 결과</h3>${jobResult(job)}`;
  else if (job.status === 'VALIDATED') {
    el.innerHTML = '<div class="msg info">검증만 완료되고 아직 SAP에 반영되지 않은 작업입니다.</div>';
  } else {
    el.innerHTML = `<h3 class="section">작업 #${job.id}</h3>${job.issues.length ? issuesTable(job.issues) : ''}
      <p><a href="/api/upload/jobs/${job.id}/issues.xlsx">검증결과 엑셀</a></p>`;
  }
}));

// ── 시작 ─────────────────────────────────────────────────
(async () => {
  try {
    const me = await api('/api/me');
    $('#user-name').textContent = me.user;
    const mb = $('#mode-badge');
    mb.textContent = me.mode === 'mock' ? 'MOCK 데이터' : 'ByD 연동';
    if (me.mode === 'mock') mb.classList.add('mock');
    await loadBoms();
  } catch (e) {
    toast(e.message, true);
  }
})();
