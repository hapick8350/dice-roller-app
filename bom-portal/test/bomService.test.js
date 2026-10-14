'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../src/db');
const { MockBydClient } = require('../src/byd/mockClient');
const { BomService, diffItems, effectiveVersion } = require('../src/services/bomService');

function service() {
  return new BomService(new MockBydClient(openDb(':memory:')));
}

test('diffItems: 추가/삭제/수량/단위 변경을 구분한다', () => {
  const a = [
    { component: 'A', qty: 1, unit: 'EA' },
    { component: 'B', qty: 2, unit: 'EA' },
    { component: 'C', qty: 1, unit: 'M' },
  ];
  const b = [
    { component: 'A', qty: 1, unit: 'EA' },
    { component: 'B', qty: 3, unit: 'EA' },
    { component: 'C', qty: 100, unit: 'CM' },
    { component: 'D', qty: 1, unit: 'EA' },
  ];
  const d = diffItems(a, b);
  assert.deepEqual(
    d.map((x) => `${x.type}:${x.component}`).sort(),
    ['ADDED:D', 'QTY_CHANGED:B', 'UNIT_CHANGED:C']
  );
  assert.deepEqual(diffItems(b, a).map((x) => x.type).sort(), ['QTY_CHANGED', 'REMOVED', 'UNIT_CHANGED']);
  assert.equal(diffItems(a, a).length, 0);
});

test('effectiveVersion: 기준일에 따라 유효 버전이 달라진다', async () => {
  const bom = await service().byd.getBom('FG-1000', 'P100');
  assert.equal(effectiveVersion(bom).version, '2');
  assert.equal(effectiveVersion(bom, '2026-02-01').version, '1');
  assert.equal(effectiveVersion(bom, '2026-05-01').version, '2');
  assert.equal(effectiveVersion(bom, '2025-12-31'), null);
});

test('explode: 다단계 소요량을 곱해서 계산한다', async () => {
  const r = await service().explode('FG-1000', 'P100', { qty: 2 });
  assert.equal(r.version, '2');
  const screw = r.leafTotals.find((t) => t.component === 'RM-0003');
  // SA-1100 v2: 6개 + SA-1300: 4개 → 제품 1개당 10개, 2개면 20개
  assert.equal(screw.totalQty, 20);
  const tube = r.leafTotals.find((t) => t.component === 'RM-0012');
  assert.equal(tube.totalQty, 2.4);
  assert.ok(r.rows.some((x) => x.level === 2));
});

test('explode: 과거 기준일이면 과거 버전으로 전개한다', async () => {
  const r = await service().explode('FG-1000', 'P100', { date: '2026-02-01' });
  assert.equal(r.version, '1');
  // 2026-02-01 기준 SA-1100은 v1 (나사 8개)
  const screw = r.leafTotals.find((t) => t.component === 'RM-0003');
  assert.equal(screw.totalQty, 12);
  assert.ok(!r.rows.some((x) => x.component === 'PK-0002'));
});

test('whereUsed: 최상위 품목까지 거슬러 올라간다', async () => {
  const r = await service().whereUsed('RM-0004', 'P100');
  const parents = r.rows.map((x) => x.parent);
  assert.ok(parents.includes('SA-1200'));
  assert.ok(parents.includes('FG-1000'));
  assert.ok(parents.includes('FG-2000'));
  assert.ok(r.rows.filter((x) => x.topLevel).every((x) => x.parent.startsWith('FG-')));
});

test('history: 버전 간 차이를 변경이력으로 만든다', async () => {
  const rows = await service().history({ material: 'SA-1100' });
  const types = rows.map((r) => `${r.version}:${r.type}:${r.component ?? ''}`).sort();
  assert.deepEqual(types, ['1:CREATED:', '2:QTY_CHANGED:RM-0003', '2:QTY_CHANGED:RM-0012']);
  const screw = rows.find((r) => r.component === 'RM-0003');
  assert.equal(screw.oldQty, 8);
  assert.equal(screw.newQty, 6);
  assert.equal(screw.changedBy, 'LEE');
});

test('history: 유형/변경자 필터', async () => {
  const s = service();
  const added = await s.history({ type: 'ADDED' });
  assert.ok(added.length > 0 && added.every((r) => r.type === 'ADDED'));
  const park = await s.history({ user: 'park' });
  assert.ok(park.length > 0 && park.every((r) => r.changedBy === 'PARK'));
});
