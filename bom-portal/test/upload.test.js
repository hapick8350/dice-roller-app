'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp, makeUploadXlsx, postUpload, row } = require('./helpers');

test('엑셀 업로드: 신규 BOM 검증 → SAP 반영 → 조회', async (t) => {
  const app = await startApp();
  t.after(app.close);

  const buf = await makeUploadXlsx([row('FG-3000', 'SA-1100', 1), row('FG-3000', 'SA-1200', 2), row('FG-3000', 'PK-0001', 1)]);
  // FG-3000 은 자재 마스터에 없으므로 먼저 오류가 나야 한다
  const bad = await postUpload(app.base, buf);
  assert.equal(bad.status, 200);
  assert.equal(bad.body.status, 'INVALID');
  assert.ok(bad.body.issues.some((i) => i.level === 'error' && i.message.includes('FG-3000')));
  const blocked = await fetch(`${app.base}/api/upload/jobs/${bad.body.jobId}/commit`, { method: 'POST' });
  assert.equal(blocked.status, 409);

  // 자재 마스터에 있는 FG-2000 의 새 버전 등록
  const buf2 = await makeUploadXlsx([
    row('FG-2000', 'SA-1100', 1),
    row('FG-2000', 'SA-1200', 3), // 2 → 3
    row('FG-2000', 'SA-1300', 1),
    row('FG-2000', 'PK-0001', 1),
    row('FG-2000', 'PK-0002', 1),
    // RM-0013 삭제
  ]);
  const ok = await postUpload(app.base, buf2);
  assert.equal(ok.body.status, 'VALIDATED', JSON.stringify(ok.body.issues));
  const b = ok.body.boms[0];
  assert.equal(b.action, 'NEW_VERSION');
  assert.deepEqual(b.changes.map((c) => `${c.type}:${c.component}`).sort(), ['QTY_CHANGED:SA-1200', 'REMOVED:RM-0013']);
  assert.deepEqual(b.items.map((i) => i.itemNo), ['0010', '0020', '0030', '0040', '0050']);

  const commit = await fetch(`${app.base}/api/upload/jobs/${ok.body.jobId}/commit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ release: false }),
  });
  const job = await commit.json();
  assert.equal(job.status, 'POSTED');
  assert.equal(job.results[0].version, '2');

  // 같은 작업 재반영 방지
  const again = await fetch(`${app.base}/api/upload/jobs/${ok.body.jobId}/commit`, { method: 'POST' });
  assert.equal(again.status, 409);

  // 작성중 버전으로 등록됐는지 확인 후 해제
  const bom = await (await fetch(`${app.base}/api/boms/P100/FG-2000`)).json();
  assert.deepEqual(bom.versions.map((v) => v.status), ['RELEASED', 'IN_PREPARATION']);
  const rel = await fetch(`${app.base}/api/boms/P100/FG-2000/versions/2/release`, { method: 'POST' });
  assert.equal(rel.status, 200);
  const bom2 = await (await fetch(`${app.base}/api/boms/P100/FG-2000`)).json();
  assert.deepEqual(bom2.versions.map((v) => v.status), ['OBSOLETE', 'RELEASED']);

  // 변경이력에 반영
  const hist = await (await fetch(`${app.base}/api/history?material=FG-2000`)).json();
  assert.ok(hist.some((h) => h.version === '2' && h.type === 'REMOVED' && h.component === 'RM-0013' && h.changedBy === 'anonymous'));
});

test('엑셀 업로드: 형식/중복/순환참조 오류를 잡아낸다', async (t) => {
  const app = await startApp();
  t.after(app.close);

  const buf = await makeUploadXlsx([
    row('SA-1200', 'RM-0004', 0), // 수량 0
    row('SA-1200', 'RM-0005', 1, { validFrom: '2099-13-01' }), // 잘못된 날짜
    row('SA-1300', 'RM-0008', 1, { itemNo: '0010' }),
    row('SA-1300', 'RM-0009', 1, { itemNo: '0010' }), // 항목번호 중복
    row('SA-1100', 'FG-1000', 1), // FG-1000 → SA-1100 → FG-1000 순환
    row('SA-1100', 'NOPE-1', 1), // 없는 자재
  ]);
  const r = await postUpload(app.base, buf);
  assert.equal(r.body.status, 'INVALID');
  const msgs = r.body.issues.filter((i) => i.level === 'error').map((i) => `${i.rowNo}:${i.field}`);
  assert.ok(msgs.includes('2:구성수량'), msgs.join());
  assert.ok(msgs.includes('3:유효시작일'), msgs.join());
  assert.ok(msgs.includes('5:항목번호'), msgs.join());
  assert.ok(msgs.includes('7:구성품코드'), msgs.join());
  assert.ok(r.body.issues.some((i) => i.message.includes('순환 참조')));
});

test('엑셀 업로드: 현재와 같으면 변경 없음, 즉시 해제 옵션', async (t) => {
  const app = await startApp();
  t.after(app.close);

  const same = await makeUploadXlsx([
    row('SA-1200', 'RM-0004', 1),
    row('SA-1200', 'RM-0005', 1),
    row('SA-1200', 'RM-0006', 1),
    row('SA-1200', 'RM-0007', 3),
  ]);
  const r = await postUpload(app.base, same);
  assert.equal(r.body.boms[0].action, 'NO_CHANGE');

  const changed = await makeUploadXlsx([row('SA-1200', 'RM-0004', 2), row('SA-1200', 'RM-0005', 1)]);
  const r2 = await postUpload(app.base, changed);
  const job = await (
    await fetch(`${app.base}/api/upload/jobs/${r2.body.jobId}/commit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ release: true }),
    })
  ).json();
  assert.equal(job.status, 'POSTED');
  const bom = await (await fetch(`${app.base}/api/boms/P100/SA-1200`)).json();
  assert.equal(bom.versions.at(-1).status, 'RELEASED');
  assert.equal(bom.versions.at(-1).items.length, 2);
});

test('엑셀 업로드: 양식이 아닌 파일은 거부한다', async (t) => {
  const app = await startApp();
  t.after(app.close);
  const r = await postUpload(app.base, Buffer.from('hello'), 'x.xlsx');
  assert.equal(r.status, 400);
  const r2 = await postUpload(app.base, Buffer.from('a,b'), 'x.csv');
  assert.equal(r2.status, 400);
});

test('양식 다운로드와 조회 엑셀 내보내기', async (t) => {
  const app = await startApp();
  t.after(app.close);
  for (const url of [
    '/api/upload/template',
    '/api/boms?format=xlsx',
    '/api/explode?material=FG-1000&plant=P100&format=xlsx',
    '/api/where-used?component=RM-0003&plant=P100&format=xlsx',
    '/api/history?format=xlsx',
  ]) {
    const res = await fetch(app.base + url);
    assert.equal(res.status, 200, url);
    assert.match(res.headers.get('content-type'), /spreadsheetml/);
    const buf = Buffer.from(await res.arrayBuffer());
    assert.equal(buf.subarray(0, 2).toString(), 'PK', url); // xlsx = zip
  }
});

test('APP_USERS 설정 시 Basic 인증이 필요하다', async (t) => {
  const app = await startApp({ appUsers: [{ name: 'hong', password: 'pw' }] });
  t.after(app.close);
  assert.equal((await fetch(`${app.base}/api/me`)).status, 401);
  const res = await fetch(`${app.base}/api/me`, {
    headers: { Authorization: 'Basic ' + Buffer.from('hong:pw').toString('base64') },
  });
  assert.equal((await res.json()).user, 'hong');
  const wrong = await fetch(`${app.base}/api/me`, {
    headers: { Authorization: 'Basic ' + Buffer.from('hong:x').toString('base64') },
  });
  assert.equal(wrong.status, 401);
});
