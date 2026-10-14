'use strict';

const ExcelJS = require('exceljs');
const { createApp } = require('../src/app');
const { COLUMNS, SHEET } = require('../src/services/excel');

function testConfig(over = {}) {
  return {
    port: 0,
    dataDir: ':memory:',
    bydMode: 'mock',
    appUsers: [],
    byd: {},
    upload: { maxFileBytes: 5 * 1024 * 1024, maxRows: 5000 },
    ...over,
  };
}

async function startApp(over) {
  const ctx = createApp(testConfig(over));
  const server = await new Promise((resolve) => {
    const s = ctx.app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { ...ctx, base, close: () => new Promise((r) => server.close(r)) };
}

// rows: [{ material, plant, baseQty, baseUnit, validFrom, description, itemNo, component, qty, unit }]
async function makeUploadXlsx(rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(SHEET);
  ws.columns = COLUMNS;
  for (const r of rows) ws.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function postUpload(base, buf, name = 'test.xlsx') {
  const fd = new FormData();
  fd.append('file', new Blob([buf]), name);
  const res = await fetch(`${base}/api/upload/preview`, { method: 'POST', body: fd });
  return { status: res.status, body: await res.json() };
}

const row = (material, component, qty, extra = {}) => ({
  material,
  plant: 'P100',
  baseQty: 1,
  baseUnit: 'EA',
  validFrom: '2099-01-01',
  description: '테스트',
  itemNo: '',
  component,
  qty,
  unit: 'EA',
  ...extra,
});

module.exports = { testConfig, startApp, makeUploadXlsx, postUpload, row };
