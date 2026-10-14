'use strict';

const { STATUS } = require('../byd/model');

const CACHE_TTL_MS = 60 * 1000;

// 날짜 기준 유효 버전: 해당 날짜에 시작된 해제/폐기 버전 중 가장 최근 것.
// 날짜가 없으면 현재 해제(RELEASED) 버전.
function effectiveVersion(bom, date) {
  if (!date) return bom.versions.find((v) => v.status === STATUS.RELEASED) || null;
  const cands = bom.versions
    .filter((v) => v.status !== STATUS.IN_PREPARATION && v.validFrom <= date)
    .sort((a, z) => (a.validFrom === z.validFrom ? Number(a.version) - Number(z.version) : a.validFrom < z.validFrom ? -1 : 1));
  return cands.at(-1) || null;
}

// 두 구성품 목록 비교. 구성품 코드 기준으로 맞춘다 (같은 구성품이 여러 줄이면 순번으로 구분).
function diffItems(oldItems = [], newItems = []) {
  const keyed = (items) => {
    const seen = new Map();
    const out = new Map();
    for (const it of items) {
      const n = (seen.get(it.component) || 0) + 1;
      seen.set(it.component, n);
      out.set(n === 1 ? it.component : `${it.component}#${n}`, it);
    }
    return out;
  };
  const a = keyed(oldItems);
  const b = keyed(newItems);
  const changes = [];
  for (const [k, o] of a) {
    const n = b.get(k);
    if (!n) {
      changes.push({ type: 'REMOVED', component: o.component, oldQty: o.qty, oldUnit: o.unit });
    } else if (o.qty !== n.qty || o.unit !== n.unit) {
      changes.push({
        type: o.unit !== n.unit ? 'UNIT_CHANGED' : 'QTY_CHANGED',
        component: o.component,
        oldQty: o.qty,
        newQty: n.qty,
        oldUnit: o.unit,
        newUnit: n.unit,
      });
    }
  }
  for (const [k, n] of b) {
    if (!a.has(k)) changes.push({ type: 'ADDED', component: n.component, newQty: n.qty, newUnit: n.unit });
  }
  return changes;
}

class BomService {
  constructor(byd) {
    this.byd = byd;
    this._cache = null;
  }

  invalidate() {
    this._cache = null;
  }

  async allBoms() {
    if (this._cache && Date.now() - this._cache.at < CACHE_TTL_MS) return this._cache.boms;
    const boms = await this.byd.getAllBoms();
    this._cache = { at: Date.now(), boms };
    return boms;
  }

  async _index(plant) {
    const boms = await this.allBoms();
    const map = new Map();
    for (const b of boms) if (!plant || b.plant === plant) map.set(`${b.material}|${b.plant}`, b);
    return map;
  }

  async _descriptions(ids) {
    const mats = await this.byd.getMaterials(ids);
    return (id) => mats.get(id)?.description || '';
  }

  // BOM 목록 검색
  async search({ q, plant, status } = {}) {
    const boms = await this.allBoms();
    const desc = await this._descriptions(boms.map((b) => b.material));
    const text = (q || '').trim().toLowerCase();
    return boms
      .filter((b) => !plant || b.plant === plant)
      .filter((b) => !text || b.material.toLowerCase().includes(text) || desc(b.material).toLowerCase().includes(text))
      .filter((b) => !status || b.versions.some((v) => v.status === status))
      .map((b) => {
        const cur = effectiveVersion(b);
        const last = b.versions.at(-1);
        return {
          material: b.material,
          description: desc(b.material),
          plant: b.plant,
          baseQty: b.baseQty,
          baseUnit: b.baseUnit,
          releasedVersion: cur?.version || null,
          releasedValidFrom: cur?.validFrom || null,
          itemCount: cur?.items.length ?? 0,
          versionCount: b.versions.length,
          draftCount: b.versions.filter((v) => v.status === STATUS.IN_PREPARATION).length,
          lastChangedAt: last?.changedAt || null,
          lastChangedBy: last?.changedBy || null,
        };
      });
  }

  // BOM 상세 (모든 버전 + 구성품 내역)
  async detail(material, plant) {
    const bom = await this.byd.getBom(material, plant);
    if (!bom) return null;
    const ids = [bom.material, ...bom.versions.flatMap((v) => v.items.map((i) => i.component))];
    const desc = await this._descriptions(ids);
    const index = await this._index(plant);
    return {
      ...bom,
      description: desc(bom.material),
      versions: bom.versions.map((v) => ({
        ...v,
        items: v.items.map((i) => ({
          ...i,
          componentDescription: desc(i.component),
          hasBom: index.has(`${i.component}|${plant}`),
        })),
      })),
    };
  }

  // 정전개 (Multi-level). qty: 상위 품목 생산 수량
  async explode(material, plant, { date, qty = 1, version } = {}) {
    const index = await this._index(plant);
    const root = index.get(`${material}|${plant}`);
    if (!root) return null;
    const rootVer = version ? root.versions.find((v) => v.version === String(version)) : effectiveVersion(root, date);
    if (!rootVer) return { material, plant, version: null, rows: [], warnings: ['유효한 해제 버전이 없습니다'] };

    const rows = [];
    const warnings = [];
    const walk = (bom, ver, parentQty, level, pathArr) => {
      const factor = parentQty / (bom.baseQty || 1);
      for (const it of ver.items) {
        const total = round(it.qty * factor);
        const child = index.get(`${it.component}|${plant}`);
        const childVer = child ? effectiveVersion(child, date) : null;
        const cyclic = pathArr.includes(it.component);
        rows.push({
          level,
          parent: bom.material,
          itemNo: it.itemNo,
          component: it.component,
          qtyPer: it.qty,
          totalQty: total,
          unit: it.unit,
          hasBom: !!child,
          version: childVer?.version || null,
        });
        if (cyclic) {
          warnings.push(`순환 참조: ${[...pathArr, it.component].join(' → ')}`);
          continue;
        }
        if (child && childVer) walk(child, childVer, total, level + 1, [...pathArr, it.component]);
        else if (child) warnings.push(`${it.component}: 기준일에 유효한 BOM 버전이 없어 하위 전개를 생략했습니다`);
      }
    };
    walk(root, rootVer, qty, 1, [material]);

    const desc = await this._descriptions([material, ...rows.map((r) => r.component)]);
    rows.forEach((r) => (r.componentDescription = desc(r.component)));
    // 최하위 자재 소요량 합계
    const totals = new Map();
    for (const r of rows.filter((x) => !x.hasBom)) {
      const k = `${r.component}|${r.unit}`;
      const t = totals.get(k) || { component: r.component, componentDescription: r.componentDescription, unit: r.unit, totalQty: 0 };
      t.totalQty = round(t.totalQty + r.totalQty);
      totals.set(k, t);
    }
    return {
      material,
      description: desc(material),
      plant,
      qty,
      date: date || null,
      version: rootVer.version,
      rows,
      leafTotals: [...totals.values()].sort((a, z) => a.component.localeCompare(z.component)),
      warnings,
    };
  }

  // 역전개 (Where-used): 이 자재를 쓰는 상위 품목을 최상위까지 찾는다
  async whereUsed(component, plant, { date } = {}) {
    const index = await this._index(plant);
    const usedBy = new Map(); // component → [{ parent, plant, version, qty, unit }]
    for (const b of index.values()) {
      const v = effectiveVersion(b, date);
      if (!v) continue;
      for (const it of v.items) {
        if (!usedBy.has(it.component)) usedBy.set(it.component, []);
        usedBy.get(it.component).push({ parent: b.material, plant: b.plant, version: v.version, qty: it.qty, unit: it.unit });
      }
    }
    const rows = [];
    const walk = (comp, level, pathArr) => {
      for (const u of usedBy.get(comp) || []) {
        rows.push({ level, component: comp, ...u, topLevel: !usedBy.has(u.parent) });
        if (!pathArr.includes(u.parent)) walk(u.parent, level + 1, [...pathArr, u.parent]);
      }
    };
    walk(component, 1, [component]);
    const desc = await this._descriptions([component, ...rows.map((r) => r.parent)]);
    rows.forEach((r) => (r.parentDescription = desc(r.parent)));
    return { component, description: desc(component), plant, date: date || null, rows };
  }

  // 두 버전 비교
  async compare(material, plant, v1, v2) {
    const bom = await this.byd.getBom(material, plant);
    if (!bom) return null;
    const a = bom.versions.find((v) => v.version === String(v1));
    const b = bom.versions.find((v) => v.version === String(v2));
    if (!a || !b) return null;
    const changes = diffItems(a.items, b.items);
    const desc = await this._descriptions(changes.map((c) => c.component));
    changes.forEach((c) => (c.componentDescription = desc(c.component)));
    return { material, plant, from: a.version, to: b.version, changes };
  }

  // 변경이력: 버전을 순서대로 비교해 구성품 단위 변경 내역을 만든다
  async history({ material, plant, from, to, user, type } = {}) {
    const boms = (await this.allBoms()).filter(
      (b) => (!material || b.material.toLowerCase().includes(material.toLowerCase())) && (!plant || b.plant === plant)
    );
    const events = [];
    for (const b of boms) {
      b.versions.forEach((v, i) => {
        const prev = b.versions[i - 1];
        const base = {
          material: b.material,
          plant: b.plant,
          version: v.version,
          prevVersion: prev?.version || null,
          status: v.status,
          validFrom: v.validFrom,
          changedAt: v.changedAt,
          changedBy: v.changedBy,
          reason: v.description,
        };
        if (!prev) {
          events.push({ ...base, type: 'CREATED', component: null });
          return;
        }
        for (const c of diffItems(prev.items, v.items)) events.push({ ...base, ...c });
      });
    }
    const filtered = events
      .filter((e) => !from || (e.changedAt || '').slice(0, 10) >= from)
      .filter((e) => !to || (e.changedAt || '').slice(0, 10) <= to)
      .filter((e) => !user || (e.changedBy || '').toLowerCase().includes(user.toLowerCase()))
      .filter((e) => !type || e.type === type)
      .sort((a, z) => (a.changedAt < z.changedAt ? 1 : a.changedAt > z.changedAt ? -1 : 0));
    const desc = await this._descriptions(filtered.flatMap((e) => [e.material, e.component].filter(Boolean)));
    filtered.forEach((e) => {
      e.materialDescription = desc(e.material);
      if (e.component) e.componentDescription = desc(e.component);
    });
    return filtered;
  }
}

function round(n) {
  return Math.round(n * 1e6) / 1e6;
}

module.exports = { BomService, diffItems, effectiveVersion };
