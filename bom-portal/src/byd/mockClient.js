'use strict';

// Mock ByD 클라이언트.
// 실제 ByD와 같은 인터페이스를 제공하며, 포털 DB 안의 mock_* 테이블에 데이터를 둔다.
// ByD처럼 BOM은 "버전" 단위로 관리된다.
//   - 등록/변경 업로드 → 새 버전 생성 (상태 IN_PREPARATION)
//   - 해제(Release)    → 해당 버전 RELEASED, 기존 RELEASED 버전은 OBSOLETE

const { STATUS } = require('./model');

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS mock_materials (
    id    TEXT PRIMARY KEY,
    descr TEXT NOT NULL,
    unit  TEXT NOT NULL,
    type  TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS mock_boms (
    material  TEXT NOT NULL,
    plant     TEXT NOT NULL,
    base_qty  REAL NOT NULL,
    base_unit TEXT NOT NULL,
    PRIMARY KEY (material, plant)
  );
  CREATE TABLE IF NOT EXISTS mock_bom_versions (
    material    TEXT NOT NULL,
    plant       TEXT NOT NULL,
    version     INTEGER NOT NULL,
    status      TEXT NOT NULL,
    valid_from  TEXT NOT NULL,
    descr       TEXT,
    changed_by  TEXT NOT NULL,
    changed_at  TEXT NOT NULL,
    PRIMARY KEY (material, plant, version)
  );
  CREATE TABLE IF NOT EXISTS mock_bom_items (
    material  TEXT NOT NULL,
    plant     TEXT NOT NULL,
    version   INTEGER NOT NULL,
    item_no   TEXT NOT NULL,
    component TEXT NOT NULL,
    qty       REAL NOT NULL,
    unit      TEXT NOT NULL,
    PRIMARY KEY (material, plant, version, item_no)
  );
`;

class MockBydClient {
  constructor(db) {
    this.db = db;
    this.mode = 'mock';
    db.exec(SCHEMA);
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM mock_materials').get();
    if (n === 0) seed(this);
  }

  async ping() {
    return { ok: true, mode: this.mode };
  }

  async getMaterials(ids) {
    const out = new Map();
    if (!ids.length) return out;
    const stmt = this.db.prepare('SELECT id, descr, unit, type FROM mock_materials WHERE id = ?');
    for (const id of new Set(ids)) {
      const r = stmt.get(id);
      if (r) out.set(id, { id: r.id, description: r.descr, unit: r.unit, type: r.type });
    }
    return out;
  }

  async searchMaterials(text, limit = 20) {
    const q = `%${text || ''}%`;
    return this.db
      .prepare('SELECT id, descr, unit, type FROM mock_materials WHERE id LIKE ? OR descr LIKE ? ORDER BY id LIMIT ?')
      .all(q, q, limit)
      .map((r) => ({ id: r.id, description: r.descr, unit: r.unit, type: r.type }));
  }

  // 전체 BOM (헤더 + 모든 버전 + 구성품). 전개/역전개/검색에 사용.
  async getAllBoms() {
    const headers = this.db.prepare('SELECT * FROM mock_boms ORDER BY material, plant').all();
    return headers.map((h) => this._load(h));
  }

  async getBom(material, plant) {
    const h = this.db.prepare('SELECT * FROM mock_boms WHERE material = ? AND plant = ?').get(material, plant);
    return h ? this._load(h) : null;
  }

  _load(h) {
    const versions = this.db
      .prepare('SELECT * FROM mock_bom_versions WHERE material = ? AND plant = ? ORDER BY version')
      .all(h.material, h.plant);
    const itemStmt = this.db.prepare(
      'SELECT * FROM mock_bom_items WHERE material = ? AND plant = ? AND version = ? ORDER BY item_no'
    );
    return {
      material: h.material,
      plant: h.plant,
      baseQty: h.base_qty,
      baseUnit: h.base_unit,
      versions: versions.map((v) => ({
        version: String(v.version),
        status: v.status,
        validFrom: v.valid_from,
        description: v.descr || '',
        changedBy: v.changed_by,
        changedAt: v.changed_at,
        items: itemStmt.all(h.material, h.plant, v.version).map((i) => ({
          itemNo: i.item_no,
          component: i.component,
          qty: i.qty,
          unit: i.unit,
        })),
      })),
    };
  }

  // BOM 등록(최초) 또는 새 버전 생성. release=true 이면 바로 해제한다.
  async postBom(bom, user) {
    const now = new Date().toISOString();
    const db = this.db;
    db.exec('BEGIN');
    try {
      const exists = db
        .prepare('SELECT 1 FROM mock_boms WHERE material = ? AND plant = ?')
        .get(bom.material, bom.plant);
      if (exists) {
        db.prepare('UPDATE mock_boms SET base_qty = ?, base_unit = ? WHERE material = ? AND plant = ?').run(
          bom.baseQty,
          bom.baseUnit,
          bom.material,
          bom.plant
        );
      } else {
        db.prepare('INSERT INTO mock_boms (material, plant, base_qty, base_unit) VALUES (?, ?, ?, ?)').run(
          bom.material,
          bom.plant,
          bom.baseQty,
          bom.baseUnit
        );
      }
      const { maxv } = db
        .prepare('SELECT COALESCE(MAX(version), 0) AS maxv FROM mock_bom_versions WHERE material = ? AND plant = ?')
        .get(bom.material, bom.plant);
      const version = maxv + 1;
      db.prepare(
        `INSERT INTO mock_bom_versions (material, plant, version, status, valid_from, descr, changed_by, changed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(bom.material, bom.plant, version, STATUS.IN_PREPARATION, bom.validFrom, bom.description || '', user, now);
      const ins = db.prepare(
        'INSERT INTO mock_bom_items (material, plant, version, item_no, component, qty, unit) VALUES (?, ?, ?, ?, ?, ?, ?)'
      );
      for (const it of bom.items) ins.run(bom.material, bom.plant, version, it.itemNo, it.component, it.qty, it.unit);
      if (bom.release) this._release(bom.material, bom.plant, version, user, now);
      db.exec('COMMIT');
      return { action: exists ? 'NEW_VERSION' : 'CREATE', version: String(version) };
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }

  async releaseVersion(material, plant, version, user) {
    const v = this.db
      .prepare('SELECT status FROM mock_bom_versions WHERE material = ? AND plant = ? AND version = ?')
      .get(material, plant, Number(version));
    if (!v) throw new Error(`버전을 찾을 수 없습니다: ${material}/${plant} v${version}`);
    if (v.status !== STATUS.IN_PREPARATION) throw new Error(`작성중(IN_PREPARATION) 버전만 해제할 수 있습니다 (현재: ${v.status})`);
    this.db.exec('BEGIN');
    try {
      this._release(material, plant, Number(version), user, new Date().toISOString());
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  _release(material, plant, version, user, now) {
    this.db
      .prepare(
        `UPDATE mock_bom_versions SET status = ?, changed_by = ?, changed_at = ?
         WHERE material = ? AND plant = ? AND status = ? AND version <> ?`
      )
      .run(STATUS.OBSOLETE, user, now, material, plant, STATUS.RELEASED, version);
    this.db
      .prepare(
        'UPDATE mock_bom_versions SET status = ?, changed_by = ?, changed_at = ? WHERE material = ? AND plant = ? AND version = ?'
      )
      .run(STATUS.RELEASED, user, now, material, plant, version);
  }
}

// ── 샘플 데이터 ────────────────────────────────────────────
function seed(client) {
  const db = client.db;
  const mats = [
    ['FG-1000', '스마트 정수기 SW-100', 'EA', 'FG'],
    ['FG-2000', '스마트 정수기 SW-200 (프리미엄)', 'EA', 'FG'],
    ['SA-1100', '본체 어셈블리', 'EA', 'SA'],
    ['SA-1200', '필터 모듈', 'EA', 'SA'],
    ['SA-1300', '제어 보드 ASSY', 'EA', 'SA'],
    ['RM-0001', '외장 케이스 (ABS)', 'EA', 'RM'],
    ['RM-0002', '내부 프레임', 'EA', 'RM'],
    ['RM-0003', '나사 M4x10', 'EA', 'RM'],
    ['RM-0004', '세디먼트 필터', 'EA', 'RM'],
    ['RM-0005', '카본 필터', 'EA', 'RM'],
    ['RM-0006', 'RO 멤브레인', 'EA', 'RM'],
    ['RM-0007', '필터 하우징', 'EA', 'RM'],
    ['RM-0008', 'PCB 메인보드', 'EA', 'RM'],
    ['RM-0009', 'MCU 칩', 'EA', 'RM'],
    ['RM-0010', '터치 패널', 'EA', 'RM'],
    ['RM-0011', '전원 케이블', 'M', 'RM'],
    ['RM-0012', '실리콘 튜브', 'M', 'RM'],
    ['RM-0013', 'UV LED 모듈', 'EA', 'RM'],
    ['PK-0001', '포장 박스', 'EA', 'PK'],
    ['PK-0002', '사용설명서', 'EA', 'PK'],
  ];
  const ins = db.prepare('INSERT INTO mock_materials (id, descr, unit, type) VALUES (?, ?, ?, ?)');
  for (const m of mats) ins.run(...m);

  const P = 'P100';
  const put = (material, versions) => {
    for (const v of versions) {
      db.prepare('INSERT OR IGNORE INTO mock_boms (material, plant, base_qty, base_unit) VALUES (?, ?, 1, ?)').run(
        material,
        P,
        'EA'
      );
      const { maxv } = db
        .prepare('SELECT COALESCE(MAX(version), 0) AS maxv FROM mock_bom_versions WHERE material = ? AND plant = ?')
        .get(material, P);
      const version = maxv + 1;
      db.prepare(
        `INSERT INTO mock_bom_versions (material, plant, version, status, valid_from, descr, changed_by, changed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(material, P, version, v.status, v.validFrom, v.descr, v.by, v.at);
      v.items.forEach(([component, qty, unit], idx) => {
        db.prepare(
          'INSERT INTO mock_bom_items (material, plant, version, item_no, component, qty, unit) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).run(material, P, version, String((idx + 1) * 10).padStart(4, '0'), component, qty, unit);
      });
    }
  };

  put('FG-1000', [
    {
      status: 'OBSOLETE', validFrom: '2026-01-01', descr: '최초 등록', by: 'KIM', at: '2026-01-05T09:00:00Z',
      items: [['SA-1100', 1, 'EA'], ['SA-1200', 1, 'EA'], ['SA-1300', 1, 'EA'], ['PK-0001', 1, 'EA']],
    },
    {
      status: 'RELEASED', validFrom: '2026-04-01', descr: '사용설명서 추가', by: 'LEE', at: '2026-03-20T02:30:00Z',
      items: [['SA-1100', 1, 'EA'], ['SA-1200', 1, 'EA'], ['SA-1300', 1, 'EA'], ['PK-0001', 1, 'EA'], ['PK-0002', 1, 'EA']],
    },
    {
      status: 'IN_PREPARATION', validFrom: '2026-11-01', descr: 'UV 살균 옵션 반영(검토중)', by: 'PARK', at: '2026-10-02T05:10:00Z',
      items: [['SA-1100', 1, 'EA'], ['SA-1200', 1, 'EA'], ['SA-1300', 1, 'EA'], ['RM-0013', 1, 'EA'], ['PK-0001', 1, 'EA'], ['PK-0002', 1, 'EA']],
    },
  ]);
  put('FG-2000', [
    {
      status: 'RELEASED', validFrom: '2026-02-01', descr: '최초 등록', by: 'KIM', at: '2026-01-25T01:00:00Z',
      items: [['SA-1100', 1, 'EA'], ['SA-1200', 2, 'EA'], ['SA-1300', 1, 'EA'], ['RM-0013', 1, 'EA'], ['PK-0001', 1, 'EA'], ['PK-0002', 1, 'EA']],
    },
  ]);
  put('SA-1100', [
    {
      status: 'OBSOLETE', validFrom: '2026-01-01', descr: '최초 등록', by: 'KIM', at: '2026-01-05T09:10:00Z',
      items: [['RM-0001', 1, 'EA'], ['RM-0002', 1, 'EA'], ['RM-0003', 8, 'EA'], ['RM-0012', 1.5, 'M']],
    },
    {
      status: 'RELEASED', validFrom: '2026-06-01', descr: '나사 수량 변경, 튜브 길이 조정', by: 'LEE', at: '2026-05-28T07:45:00Z',
      items: [['RM-0001', 1, 'EA'], ['RM-0002', 1, 'EA'], ['RM-0003', 6, 'EA'], ['RM-0012', 1.2, 'M']],
    },
  ]);
  put('SA-1200', [
    {
      status: 'RELEASED', validFrom: '2026-01-01', descr: '최초 등록', by: 'KIM', at: '2026-01-05T09:20:00Z',
      items: [['RM-0004', 1, 'EA'], ['RM-0005', 1, 'EA'], ['RM-0006', 1, 'EA'], ['RM-0007', 3, 'EA']],
    },
  ]);
  put('SA-1300', [
    {
      status: 'RELEASED', validFrom: '2026-01-01', descr: '최초 등록', by: 'KIM', at: '2026-01-05T09:30:00Z',
      items: [['RM-0008', 1, 'EA'], ['RM-0009', 1, 'EA'], ['RM-0010', 1, 'EA'], ['RM-0011', 1.8, 'M'], ['RM-0003', 4, 'EA']],
    },
  ]);
}

module.exports = { MockBydClient };
