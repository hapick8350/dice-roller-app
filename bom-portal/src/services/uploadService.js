'use strict';

const { diffItems, effectiveVersion } = require('./bomService');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(s) {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function toNumber(v) {
  if (typeof v === 'number') return v;
  const s = String(v).replace(/,/g, '').trim();
  if (s === '') return NaN;
  return Number(s);
}

const str = (v) => String(v ?? '').trim();

// 업로드 행 검증 + 현재 SAP BOM과 비교.
// byd: ByD 클라이언트, currentBoms: 전체 BOM 목록 (순환 검사·비교용)
async function validateRows(rows, { byd, currentBoms, today }) {
  const issues = [];
  const err = (rowNo, material, plant, field, message) => issues.push({ level: 'error', rowNo, material, plant, field, message });
  const warn = (rowNo, material, plant, field, message) => issues.push({ level: 'warning', rowNo, material, plant, field, message });

  // 1) 행 단위 형식 검사 + BOM 묶기
  const groups = new Map();
  for (const r of rows) {
    const material = str(r.material).toUpperCase();
    const plant = str(r.plant).toUpperCase();
    const component = str(r.component).toUpperCase();
    const qty = toNumber(r.qty);
    const baseQty = toNumber(r.baseQty);
    const validFrom = str(r.validFrom);
    let ok = true;
    const need = (val, field) => {
      if (val === '' || val === undefined) {
        err(r.rowNo, material, plant, field, `${field}은(는) 필수입니다`);
        ok = false;
      }
    };
    need(material, '모품목코드');
    need(plant, '플랜트');
    need(component, '구성품코드');
    need(str(r.unit), '단위');
    need(str(r.baseUnit), '기준단위');
    need(validFrom, '유효시작일');
    if (!(qty > 0)) {
      err(r.rowNo, material, plant, '구성수량', `구성수량은 0보다 큰 숫자여야 합니다 (입력값: ${str(r.qty) || '빈칸'})`);
      ok = false;
    }
    if (!(baseQty > 0)) {
      err(r.rowNo, material, plant, '기준수량', `기준수량은 0보다 큰 숫자여야 합니다 (입력값: ${str(r.baseQty) || '빈칸'})`);
      ok = false;
    }
    if (validFrom && !isValidDate(validFrom)) {
      err(r.rowNo, material, plant, '유효시작일', `날짜 형식은 YYYY-MM-DD 입니다 (입력값: ${validFrom})`);
      ok = false;
    }
    if (material && component && material === component) {
      err(r.rowNo, material, plant, '구성품코드', '모품목과 구성품이 같을 수 없습니다');
      ok = false;
    }
    if (!material || !plant) continue;

    const key = `${material}|${plant}`;
    if (!groups.has(key)) {
      groups.set(key, {
        material,
        plant,
        baseQty,
        baseUnit: str(r.baseUnit).toUpperCase(),
        validFrom,
        description: str(r.description),
        items: [],
        rowNos: [],
        firstRow: r.rowNo,
        hasRowError: false,
      });
    }
    const g = groups.get(key);
    g.rowNos.push(r.rowNo);
    if (!ok) g.hasRowError = true;
    // 같은 BOM 안에서 헤더 값이 다르면 오류
    if (ok && (g.baseQty !== baseQty || g.baseUnit !== str(r.baseUnit).toUpperCase() || g.validFrom !== validFrom)) {
      err(r.rowNo, material, plant, '헤더', `같은 BOM의 기준수량/기준단위/유효시작일이 ${g.firstRow}행과 다릅니다`);
      g.hasRowError = true;
    }
    if (!g.description && str(r.description)) g.description = str(r.description);
    if (ok) g.items.push({ rowNo: r.rowNo, itemNo: str(r.itemNo), component, qty, unit: str(r.unit).toUpperCase() });
  }

  // 2) BOM 단위 검사
  for (const g of groups.values()) {
    // 항목번호 자동 부여 + 중복 검사
    let next = 10;
    const usedNos = new Set(g.items.map((i) => i.itemNo).filter(Boolean));
    for (const it of g.items) {
      if (!it.itemNo) {
        while (usedNos.has(String(next).padStart(4, '0'))) next += 10;
        it.itemNo = String(next).padStart(4, '0');
        usedNos.add(it.itemNo);
        next += 10;
      }
    }
    const seenNo = new Map();
    const seenComp = new Map();
    for (const it of g.items) {
      if (seenNo.has(it.itemNo)) {
        err(it.rowNo, g.material, g.plant, '항목번호', `항목번호 ${it.itemNo}가 ${seenNo.get(it.itemNo)}행과 중복됩니다`);
        g.hasRowError = true;
      } else seenNo.set(it.itemNo, it.rowNo);
      if (seenComp.has(it.component)) {
        warn(it.rowNo, g.material, g.plant, '구성품코드', `구성품 ${it.component}가 ${seenComp.get(it.component)}행에도 있습니다 (의도한 것인지 확인)`);
      } else seenComp.set(it.component, it.rowNo);
    }
    if (g.validFrom && today && g.validFrom < today) {
      warn(g.firstRow, g.material, g.plant, '유효시작일', `유효시작일(${g.validFrom})이 오늘보다 과거입니다`);
    }
  }

  // 3) 자재 마스터 존재 여부 / 단위 확인
  const ids = [...groups.values()].flatMap((g) => [g.material, ...g.items.map((i) => i.component)]);
  const mats = await byd.getMaterials(ids);
  for (const g of groups.values()) {
    const pm = mats.get(g.material);
    if (!pm) {
      err(g.firstRow, g.material, g.plant, '모품목코드', `SAP에 없는 자재입니다: ${g.material}`);
      g.hasRowError = true;
    } else if (pm.unit && g.baseUnit && pm.unit !== g.baseUnit) {
      warn(g.firstRow, g.material, g.plant, '기준단위', `자재 기본단위(${pm.unit})와 다릅니다: ${g.baseUnit}`);
    }
    for (const it of g.items) {
      const m = mats.get(it.component);
      if (!m) {
        err(it.rowNo, g.material, g.plant, '구성품코드', `SAP에 없는 자재입니다: ${it.component}`);
        g.hasRowError = true;
      } else if (m.unit && m.unit !== it.unit) {
        warn(it.rowNo, g.material, g.plant, '단위', `자재 기본단위(${m.unit})와 다릅니다: ${it.unit} (단위 환산 설정 확인)`);
      }
    }
  }

  // 4) 순환 참조 검사: 현재 유효 BOM 위에 업로드 내용을 덮어쓴 구조로 확인
  const graph = new Map();
  for (const b of currentBoms) {
    const v = effectiveVersion(b);
    if (v) graph.set(`${b.material}|${b.plant}`, v.items.map((i) => i.component));
  }
  for (const g of groups.values()) graph.set(`${g.material}|${g.plant}`, g.items.map((i) => i.component));
  for (const g of groups.values()) {
    const cycle = findCycle(g.material, g.plant, graph);
    if (cycle) {
      err(g.firstRow, g.material, g.plant, '구성품코드', `순환 참조가 생깁니다: ${cycle.join(' → ')}`);
      g.hasRowError = true;
    }
  }

  // 5) 현재 SAP BOM과 비교
  const byKey = new Map(currentBoms.map((b) => [`${b.material}|${b.plant}`, b]));
  // 삭제될 구성품의 품명도 표시하도록 현재 BOM 구성품까지 자재 정보를 채운다
  const removedIds = [...groups.values()].flatMap((g) => {
    const cur = byKey.get(`${g.material}|${g.plant}`);
    const v = cur ? effectiveVersion(cur) || cur.versions.at(-1) : null;
    return (v?.items || []).map((i) => i.component).filter((id) => !mats.has(id));
  });
  if (removedIds.length) for (const [k, v] of await byd.getMaterials(removedIds)) mats.set(k, v);
  const boms = [...groups.values()].map((g) => {
    const cur = byKey.get(`${g.material}|${g.plant}`);
    const curVer = cur ? effectiveVersion(cur) || cur.versions.at(-1) : null;
    const items = g.items.map(({ itemNo, component, qty, unit }) => ({ itemNo, component, qty, unit }));
    const changes = diffItems(curVer?.items || [], items);
    const headerChanged = !!cur && (cur.baseQty !== g.baseQty || cur.baseUnit !== g.baseUnit);
    let action = 'CREATE';
    if (cur) action = changes.length || headerChanged ? 'NEW_VERSION' : 'NO_CHANGE';
    const draft = cur?.versions.find((v) => v.status === 'IN_PREPARATION');
    if (draft && action === 'NEW_VERSION') {
      warn(g.firstRow, g.material, g.plant, '버전', `작성중인 버전 v${draft.version}이 이미 있습니다. 새 버전이 추가로 생성됩니다`);
    }
    return {
      material: g.material,
      materialDescription: mats.get(g.material)?.description || '',
      plant: g.plant,
      baseQty: g.baseQty,
      baseUnit: g.baseUnit,
      validFrom: g.validFrom,
      description: g.description,
      items,
      rowNos: g.rowNos,
      valid: !g.hasRowError,
      action,
      compareVersion: curVer?.version || null,
      headerChanged,
      changes: changes.map((c) => ({ ...c, componentDescription: mats.get(c.component)?.description || '' })),
    };
  });

  issues.sort((a, z) => (a.rowNo ?? 0) - (z.rowNo ?? 0) || (a.level === z.level ? 0 : a.level === 'error' ? -1 : 1));
  return { boms, issues, errorCount: issues.filter((i) => i.level === 'error').length };
}

function findCycle(material, plant, graph) {
  const stack = [[material, [material]]];
  while (stack.length) {
    const [node, path] = stack.pop();
    for (const child of graph.get(`${node}|${plant}`) || []) {
      if (child === material) return [...path, child];
      if (!path.includes(child) && path.length < 50) stack.push([child, [...path, child]]);
    }
  }
  return null;
}

class UploadService {
  constructor(db, byd, bomService) {
    this.db = db;
    this.byd = byd;
    this.bomService = bomService;
  }

  // 검증 후 작업(job)으로 저장. SAP에는 아직 반영하지 않는다.
  async preview(rows, fileName, user) {
    this.bomService.invalidate();
    const currentBoms = await this.bomService.allBoms();
    const today = new Date().toISOString().slice(0, 10);
    const result = await validateRows(rows, { byd: this.byd, currentBoms, today });
    const status = result.errorCount ? 'INVALID' : 'VALIDATED';
    const info = this.db
      .prepare(
        `INSERT INTO upload_jobs (file_name, uploaded_by, uploaded_at, status, bom_count, error_count, payload_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(fileName, user, new Date().toISOString(), status, result.boms.length, result.errorCount, JSON.stringify(result));
    return { jobId: Number(info.lastInsertRowid), status, ...result };
  }

  getJob(id) {
    const job = this.db.prepare('SELECT * FROM upload_jobs WHERE id = ?').get(id);
    if (!job) return null;
    const results = this.db.prepare('SELECT * FROM upload_results WHERE job_id = ? ORDER BY id').all(id);
    const { payload_json, ...rest } = job;
    return { ...rest, ...JSON.parse(payload_json), results };
  }

  listJobs(limit = 100) {
    return this.db
      .prepare(
        `SELECT id, file_name, uploaded_by, uploaded_at, status, release_now, bom_count, error_count, posted_at, posted_by
         FROM upload_jobs ORDER BY id DESC LIMIT ?`
      )
      .all(limit);
  }

  // 검증된 작업을 SAP에 반영. 같은 작업을 두 번 반영하지 않도록 상태를 먼저 잠근다.
  async commit(jobId, user, { release = false } = {}) {
    const lock = this.db
      .prepare("UPDATE upload_jobs SET status = 'POSTING', posted_by = ?, release_now = ? WHERE id = ? AND status = 'VALIDATED'")
      .run(user, release ? 1 : 0, jobId);
    if (lock.changes !== 1) {
      const job = this.db.prepare('SELECT status FROM upload_jobs WHERE id = ?').get(jobId);
      if (!job) throw httpError(404, '업로드 작업을 찾을 수 없습니다');
      throw httpError(409, `반영할 수 없는 상태입니다 (현재: ${job.status})`);
    }
    const { boms } = JSON.parse(this.db.prepare('SELECT payload_json FROM upload_jobs WHERE id = ?').get(jobId).payload_json);
    const ins = this.db.prepare(
      'INSERT INTO upload_results (job_id, material, plant, action, success, version, message) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    let ok = 0;
    let fail = 0;
    for (const b of boms) {
      if (b.action === 'NO_CHANGE') {
        ins.run(jobId, b.material, b.plant, b.action, 1, b.compareVersion, '현재 버전과 같아 반영하지 않음');
        continue;
      }
      try {
        const r = await this.byd.postBom({ ...b, release }, user);
        ins.run(jobId, b.material, b.plant, r.action, 1, r.version ?? null, release ? '등록 및 해제 완료' : '등록 완료 (작성중)');
        ok++;
      } catch (e) {
        ins.run(jobId, b.material, b.plant, b.action, 0, null, e.message);
        fail++;
      }
    }
    const status = fail === 0 ? 'POSTED' : ok === 0 ? 'FAILED' : 'PARTIAL';
    this.db.prepare('UPDATE upload_jobs SET status = ?, posted_at = ? WHERE id = ?').run(status, new Date().toISOString(), jobId);
    this.bomService.invalidate();
    return this.getJob(jobId);
  }
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

module.exports = { UploadService, validateRows, httpError };
