'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const soap = require('../src/byd/soap');
const { BydClient, odataDate } = require('../src/byd/bydClient');

test('SOAP 요청 XML은 값을 이스케이프한다', () => {
  const xml = soap.buildMaintainBom({
    material: 'A<&>',
    plant: 'P100',
    baseQty: 1,
    baseUnit: 'EA',
    validFrom: '2026-01-01',
    description: '"사유"',
    items: [{ itemNo: '0010', component: 'B', qty: 2, unit: 'EA' }],
  });
  assert.ok(xml.includes('<ProductID>A&lt;&amp;&gt;</ProductID>'));
  assert.ok(xml.includes('&quot;사유&quot;'));
  assert.ok(xml.includes('<Quantity unitCode="EA">2</Quantity>'));
});

test('SOAP 응답 파싱: 오류 심각도 3이면 실패', () => {
  const okXml = '<Log><Item><TypeID>1</TypeID><CategoryCode>INF</CategoryCode><SeverityCode>1</SeverityCode><Note>저장됨</Note></Item></Log><VersionID>4</VersionID>';
  assert.deepEqual(soap.parseResponse(okXml), { ok: true, messages: ['저장됨'], version: '4' });
  const errXml = '<Item><TypeID>1</TypeID><CategoryCode>PRE</CategoryCode><SeverityCode>3</SeverityCode><Note>자재 없음</Note></Item>';
  assert.equal(soap.parseResponse(errXml).ok, false);
  assert.equal(soap.parseResponse('<faultstring>Unauthorized</faultstring>').ok, false);
});

test('OData 날짜 변환', () => {
  assert.equal(odataDate('/Date(1767225600000)/'), '2026-01-01');
  assert.equal(odataDate('2026-03-05T00:00:00'), '2026-03-05');
  assert.equal(odataDate(null), '');
});

test('BydClient: OData 응답을 포털 모델로 변환하고 페이지를 이어 읽는다', async (t) => {
  let calls = 0;
  const server = http.createServer((req, res) => {
    calls++;
    assert.equal(req.headers.authorization, 'Basic ' + Buffer.from('u:p').toString('base64'));
    res.setHeader('Content-Type', 'application/json');
    if (!req.url.includes('skiptoken')) {
      return res.end(JSON.stringify({ d: { results: [bom('FG-1')], __next: `http://127.0.0.1:${server.address().port}/odata/BillOfMaterialCollection?skiptoken=1` } }));
    }
    res.end(JSON.stringify({ d: { results: [bom('FG-2')] } }));
  });
  await new Promise((r) => server.listen(0, r));
  t.after(() => server.close());

  const c = new BydClient({
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    user: 'u',
    password: 'p',
    odataBomPath: '/odata',
    odataMaterialPath: '/odata',
    timeoutMs: 5000,
  });
  const boms = await c.getAllBoms();
  assert.equal(calls, 2);
  assert.deepEqual(boms.map((b) => b.material), ['FG-1', 'FG-2']);
  assert.deepEqual(boms[0].versions.map((v) => [v.version, v.status, v.validFrom]), [
    ['1', 'OBSOLETE', '2026-01-01'],
    ['2', 'RELEASED', '2026-01-01'],
  ]);
  assert.deepEqual(boms[0].versions[1].items[0], { itemNo: '10', component: 'RM-1', qty: 2, unit: 'EA' });
});

function bom(id) {
  const ver = (v, status) => ({
    VersionID: v,
    LifeCycleStatusCode: status,
    ValidityStartDate: '/Date(1767225600000)/',
    Description: '',
    LastChangedBy: 'X',
    LastChangeDateTime: '/Date(1767225600000)/',
    Item: { results: [{ ItemID: '10', ComponentProductID: 'RM-1', Quantity: '2', QuantityUnitCode: 'EA' }] },
  });
  return {
    ProductID: id,
    SiteID: 'P100',
    BaseQuantity: '1',
    BaseQuantityUnitCode: 'EA',
    Version: { results: [ver('2', '2'), ver('1', '3')] },
  };
}
