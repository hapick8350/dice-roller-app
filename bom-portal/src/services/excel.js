'use strict';

const ExcelJS = require('exceljs');

const SHEET = 'BOM업로드';

// 업로드 양식 컬럼 정의. 헤더 문구로 컬럼을 찾으므로 순서가 바뀌어도 된다.
const COLUMNS = [
  { key: 'material', header: '모품목코드*', width: 16 },
  { key: 'plant', header: '플랜트*', width: 10 },
  { key: 'baseQty', header: '기준수량*', width: 10 },
  { key: 'baseUnit', header: '기준단위*', width: 10 },
  { key: 'validFrom', header: '유효시작일*', width: 13 },
  { key: 'description', header: '변경사유', width: 28 },
  { key: 'itemNo', header: '항목번호', width: 10 },
  { key: 'component', header: '구성품코드*', width: 16 },
  { key: 'qty', header: '구성수량*', width: 10 },
  { key: 'unit', header: '단위*', width: 8 },
];

const norm = (s) => String(s || '').replace(/[*\s]/g, '');

function styleHeader(ws) {
  const row = ws.getRow(1);
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
  row.alignment = { vertical: 'middle', horizontal: 'center' };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
}

async function buildTemplate() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(SHEET);
  ws.columns = COLUMNS;
  styleHeader(ws);
  const example = [
    ['FG-3000', 'P100', 1, 'EA', '2026-12-01', '신규 모델 등록', '0010', 'SA-1100', 1, 'EA'],
    ['FG-3000', 'P100', 1, 'EA', '2026-12-01', '신규 모델 등록', '0020', 'SA-1200', 2, 'EA'],
    ['FG-3000', 'P100', 1, 'EA', '2026-12-01', '신규 모델 등록', '0030', 'PK-0001', 1, 'EA'],
  ];
  for (const r of example) ws.addRow(r);
  ws.getColumn('validFrom').numFmt = '@';

  const guide = wb.addWorksheet('작성방법');
  guide.columns = [{ width: 18 }, { width: 90 }];
  const lines = [
    ['항목', '설명'],
    ['기본 규칙', '한 행이 구성품 하나입니다. 같은 모품목코드+플랜트의 행들이 하나의 BOM이 됩니다.'],
    ['', '업로드한 행이 그 BOM의 "전체 구성품 목록"입니다. 빠진 구성품은 새 버전에서 삭제됩니다.'],
    ['신규/변경', '해당 BOM이 SAP에 없으면 신규 등록, 있으면 새 버전(작성중)으로 등록됩니다.'],
    ['', '현재 유효 버전과 내용이 같으면 변경 없음으로 건너뜁니다.'],
    ['모품목코드*', 'SAP 자재 코드 (상위 품목)'],
    ['플랜트*', 'SAP 사이트(플랜트) ID'],
    ['기준수량/단위*', '구성수량의 기준이 되는 상위 품목 수량과 단위 (보통 1 EA)'],
    ['유효시작일*', 'YYYY-MM-DD 형식. 같은 BOM의 행끼리 같아야 합니다.'],
    ['변경사유', '버전 설명으로 SAP에 저장되고 변경이력에 표시됩니다.'],
    ['항목번호', '비우면 0010, 0020 … 순서로 자동 부여됩니다.'],
    ['구성품코드*', 'SAP 자재 코드 (하위 품목)'],
    ['구성수량*', '기준수량당 소요 수량 (0보다 커야 함)'],
    ['단위*', '구성품 수량 단위'],
    ['예시', '"BOM업로드" 시트의 예시 행은 지우고 작성하세요.'],
  ];
  for (const l of lines) guide.addRow(l);
  guide.getRow(1).font = { bold: true };
  return wb.xlsx.writeBuffer();
}

function cellValue(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('result' in v) return cellValue(v.result);
    if ('richText' in v) return v.richText.map((t) => t.text).join('');
    if ('text' in v) return String(v.text);
  }
  return typeof v === 'string' ? v.trim() : v;
}

// 업로드 파일 → 행 배열. 헤더 행이 맞지 않으면 예외.
async function parseUpload(buffer, maxRows) {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch {
    throw new Error('엑셀(.xlsx) 파일을 읽을 수 없습니다');
  }
  const ws = wb.getWorksheet(SHEET) || wb.worksheets[0];
  if (!ws) throw new Error('워크시트가 없습니다');

  const colOf = {};
  ws.getRow(1).eachCell((cell, col) => {
    const h = norm(cellValue(cell.value));
    const def = COLUMNS.find((c) => norm(c.header) === h);
    if (def) colOf[def.key] = col;
  });
  const missing = COLUMNS.filter((c) => c.header.endsWith('*') && !colOf[c.key]).map((c) => c.header);
  if (missing.length) throw new Error(`필수 컬럼이 없습니다: ${missing.join(', ')} (양식을 다시 내려받아 주세요)`);

  const rows = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const rec = { rowNo: r };
    let empty = true;
    for (const c of COLUMNS) {
      const v = colOf[c.key] ? cellValue(row.getCell(colOf[c.key]).value) : '';
      if (v !== '') empty = false;
      rec[c.key] = v;
    }
    if (empty) continue;
    rows.push(rec);
    if (rows.length > maxRows) throw new Error(`한 번에 최대 ${maxRows}행까지 업로드할 수 있습니다`);
  }
  if (!rows.length) throw new Error('업로드할 데이터 행이 없습니다');
  return rows;
}

// 검증 결과(오류/경고) 엑셀
async function buildIssuesWorkbook(issues) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('검증결과');
  ws.columns = [
    { header: '구분', key: 'level', width: 8 },
    { header: '행번호', key: 'rowNo', width: 8 },
    { header: '모품목', key: 'material', width: 16 },
    { header: '플랜트', key: 'plant', width: 10 },
    { header: '항목', key: 'field', width: 14 },
    { header: '내용', key: 'message', width: 70 },
  ];
  styleHeader(ws);
  for (const i of issues) ws.addRow({ ...i, level: i.level === 'error' ? '오류' : '경고', rowNo: i.rowNo ?? '' });
  return wb.xlsx.writeBuffer();
}

// 조회 결과를 엑셀로 내보내기 (columns: [{ key, header, width }])
async function buildTableWorkbook(sheetName, columns, rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName.slice(0, 31));
  ws.columns = columns.map((c) => ({ width: 14, ...c }));
  styleHeader(ws);
  for (const r of rows) ws.addRow(r);
  return wb.xlsx.writeBuffer();
}

module.exports = { buildTemplate, parseUpload, buildIssuesWorkbook, buildTableWorkbook, COLUMNS, SHEET };
