'use strict';

const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const multer = require('multer');

const { openDb } = require('./db');
const { createBydClient } = require('./byd');
const { BomService } = require('./services/bomService');
const { UploadService, httpError } = require('./services/uploadService');
const excel = require('./services/excel');
const { STATUS_LABEL } = require('./byd/model');

const CHANGE_LABEL = {
  CREATED: '최초 등록',
  ADDED: '구성품 추가',
  REMOVED: '구성품 삭제',
  QTY_CHANGED: '수량 변경',
  UNIT_CHANGED: '단위 변경',
};

function createApp(config, deps = {}) {
  const db = deps.db || openDb(config.dataDir);
  const byd = deps.byd || createBydClient(config, db);
  const bomService = new BomService(byd);
  const uploadService = new UploadService(db, byd, bomService);

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use(authMiddleware(config.appUsers));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: config.upload.maxFileBytes, files: 1, fields: 5 },
  });

  const sendXlsx = async (res, name, bufPromise) => {
    const buf = await bufPromise;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
    res.send(Buffer.from(buf));
  };
  const wantsXlsx = (req) => req.query.format === 'xlsx';

  // ── 공통 ───────────────────────────────────────────────
  app.get('/api/me', (req, res) => res.json({ user: req.user, mode: byd.mode }));

  app.get('/api/health', async (req, res) => {
    try {
      res.json(await byd.ping());
    } catch (e) {
      res.status(503).json({ ok: false, mode: byd.mode, error: e.message });
    }
  });

  app.get('/api/materials', async (req, res) => {
    res.json(await byd.searchMaterials(String(req.query.q || ''), 20));
  });

  // ── BOM 조회 ───────────────────────────────────────────
  app.get('/api/boms', async (req, res) => {
    const rows = await bomService.search({
      q: req.query.q,
      plant: req.query.plant,
      status: req.query.status,
    });
    if (!wantsXlsx(req)) return res.json(rows);
    await sendXlsx(
      res,
      'BOM목록.xlsx',
      excel.buildTableWorkbook(
        'BOM목록',
        [
          { key: 'material', header: '모품목', width: 16 },
          { key: 'description', header: '품명', width: 30 },
          { key: 'plant', header: '플랜트', width: 10 },
          { key: 'releasedVersion', header: '유효버전', width: 10 },
          { key: 'releasedValidFrom', header: '유효시작일', width: 12 },
          { key: 'itemCount', header: '구성품수', width: 10 },
          { key: 'versionCount', header: '버전수', width: 10 },
          { key: 'draftCount', header: '작성중', width: 10 },
          { key: 'lastChangedBy', header: '최종변경자', width: 12 },
          { key: 'lastChangedAt', header: '최종변경일시', width: 22 },
        ],
        rows
      )
    );
  });

  app.get('/api/boms/:plant/:material', async (req, res) => {
    const bom = await bomService.detail(req.params.material, req.params.plant);
    if (!bom) throw httpError(404, 'BOM을 찾을 수 없습니다');
    if (!wantsXlsx(req)) return res.json(bom);
    const rows = bom.versions.flatMap((v) =>
      v.items.map((i) => ({ version: v.version, status: STATUS_LABEL[v.status] || v.status, validFrom: v.validFrom, ...i }))
    );
    await sendXlsx(
      res,
      `BOM_${bom.material}_${bom.plant}.xlsx`,
      excel.buildTableWorkbook(
        bom.material,
        [
          { key: 'version', header: '버전', width: 8 },
          { key: 'status', header: '상태', width: 12 },
          { key: 'validFrom', header: '유효시작일', width: 12 },
          { key: 'itemNo', header: '항목', width: 8 },
          { key: 'component', header: '구성품', width: 16 },
          { key: 'componentDescription', header: '품명', width: 30 },
          { key: 'qty', header: '수량', width: 10 },
          { key: 'unit', header: '단위', width: 8 },
        ],
        rows
      )
    );
  });

  app.get('/api/boms/:plant/:material/compare', async (req, res) => {
    const r = await bomService.compare(req.params.material, req.params.plant, req.query.from, req.query.to);
    if (!r) throw httpError(404, '비교할 버전을 찾을 수 없습니다');
    res.json(r);
  });

  app.post('/api/boms/:plant/:material/versions/:version/release', async (req, res) => {
    await byd.releaseVersion(req.params.material, req.params.plant, req.params.version, req.user);
    bomService.invalidate();
    res.json({ ok: true });
  });

  // ── 분석 조회 ──────────────────────────────────────────
  app.get('/api/explode', async (req, res) => {
    const { material, plant, date, version } = req.query;
    if (!material || !plant) throw httpError(400, '모품목과 플랜트를 입력하세요');
    const qty = req.query.qty ? Number(req.query.qty) : 1;
    if (!(qty > 0)) throw httpError(400, '수량은 0보다 커야 합니다');
    const r = await bomService.explode(String(material).toUpperCase(), String(plant).toUpperCase(), { date, qty, version });
    if (!r) throw httpError(404, 'BOM을 찾을 수 없습니다');
    if (!wantsXlsx(req)) return res.json(r);
    await sendXlsx(
      res,
      `정전개_${r.material}.xlsx`,
      excel.buildTableWorkbook(
        '정전개',
        [
          { key: 'level', header: '레벨', width: 6 },
          { key: 'parent', header: '상위품목', width: 16 },
          { key: 'component', header: '구성품', width: 16 },
          { key: 'componentDescription', header: '품명', width: 30 },
          { key: 'qtyPer', header: '단위수량', width: 10 },
          { key: 'totalQty', header: '소요량', width: 10 },
          { key: 'unit', header: '단위', width: 8 },
          { key: 'version', header: '하위BOM버전', width: 12 },
        ],
        r.rows.map((x) => ({ ...x, component: `${'  '.repeat(x.level - 1)}${x.component}` }))
      )
    );
  });

  app.get('/api/where-used', async (req, res) => {
    const { component, plant, date } = req.query;
    if (!component || !plant) throw httpError(400, '자재와 플랜트를 입력하세요');
    const r = await bomService.whereUsed(String(component).toUpperCase(), String(plant).toUpperCase(), { date });
    if (!wantsXlsx(req)) return res.json(r);
    await sendXlsx(
      res,
      `역전개_${r.component}.xlsx`,
      excel.buildTableWorkbook(
        '역전개',
        [
          { key: 'level', header: '레벨', width: 6 },
          { key: 'component', header: '자재', width: 16 },
          { key: 'parent', header: '사용 상위품목', width: 16 },
          { key: 'parentDescription', header: '품명', width: 30 },
          { key: 'version', header: '버전', width: 8 },
          { key: 'qty', header: '수량', width: 10 },
          { key: 'unit', header: '단위', width: 8 },
        ],
        r.rows
      )
    );
  });

  // ── 변경이력 ───────────────────────────────────────────
  app.get('/api/history', async (req, res) => {
    const rows = await bomService.history({
      material: req.query.material,
      plant: req.query.plant,
      from: req.query.from,
      to: req.query.to,
      user: req.query.user,
      type: req.query.type,
    });
    if (!wantsXlsx(req)) return res.json(rows);
    await sendXlsx(
      res,
      'BOM변경이력.xlsx',
      excel.buildTableWorkbook(
        '변경이력',
        [
          { key: 'changedAt', header: '변경일시', width: 22 },
          { key: 'changedBy', header: '변경자', width: 12 },
          { key: 'material', header: '모품목', width: 16 },
          { key: 'plant', header: '플랜트', width: 8 },
          { key: 'version', header: '버전', width: 8 },
          { key: 'type', header: '변경유형', width: 12 },
          { key: 'component', header: '구성품', width: 16 },
          { key: 'componentDescription', header: '품명', width: 26 },
          { key: 'oldQty', header: '이전수량', width: 10 },
          { key: 'newQty', header: '변경수량', width: 10 },
          { key: 'oldUnit', header: '이전단위', width: 8 },
          { key: 'newUnit', header: '변경단위', width: 8 },
          { key: 'validFrom', header: '유효시작일', width: 12 },
          { key: 'reason', header: '변경사유', width: 30 },
        ],
        rows.map((r) => ({ ...r, type: CHANGE_LABEL[r.type] || r.type }))
      )
    );
  });

  // ── 엑셀 업로드 ────────────────────────────────────────
  app.get('/api/upload/template', async (req, res) => {
    await sendXlsx(res, 'BOM_업로드양식.xlsx', excel.buildTemplate());
  });

  app.post('/api/upload/preview', upload.single('file'), async (req, res) => {
    if (!req.file) throw httpError(400, '파일을 선택하세요');
    const fileName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
    if (!/\.xlsx$/i.test(fileName)) throw httpError(400, '.xlsx 파일만 업로드할 수 있습니다');
    let rows;
    try {
      rows = await excel.parseUpload(req.file.buffer, config.upload.maxRows);
    } catch (e) {
      throw httpError(400, e.message);
    }
    res.json(await uploadService.preview(rows, fileName, req.user));
  });

  app.post('/api/upload/jobs/:id/commit', async (req, res) => {
    res.json(await uploadService.commit(Number(req.params.id), req.user, { release: !!req.body?.release }));
  });

  app.get('/api/upload/jobs', (req, res) => res.json(uploadService.listJobs()));

  app.get('/api/upload/jobs/:id', (req, res) => {
    const job = uploadService.getJob(Number(req.params.id));
    if (!job) throw httpError(404, '업로드 작업을 찾을 수 없습니다');
    res.json(job);
  });

  app.get('/api/upload/jobs/:id/issues.xlsx', async (req, res) => {
    const job = uploadService.getJob(Number(req.params.id));
    if (!job) throw httpError(404, '업로드 작업을 찾을 수 없습니다');
    await sendXlsx(res, `검증결과_${job.id}.xlsx`, excel.buildIssuesWorkbook(job.issues));
  });

  app.use('/api', (req, res) => res.status(404).json({ error: '없는 API입니다' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? '파일이 너무 큽니다' : `업로드 오류: ${err.message}`;
      return res.status(400).json({ error: msg });
    }
    const status = err.status || 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: err.message || '서버 오류' });
  });

  return { app, db, byd, bomService, uploadService };
}

// HTTP Basic 인증. APP_USERS 가 비어 있으면 인증 없이 anonymous 로 동작한다.
function authMiddleware(users) {
  if (!users.length) {
    return (req, res, next) => {
      req.user = 'anonymous';
      next();
    };
  }
  const safeEq = (a, b) => {
    const x = Buffer.from(a);
    const y = Buffer.from(b);
    return x.length === y.length && crypto.timingSafeEqual(x, y);
  };
  return (req, res, next) => {
    const m = (req.headers.authorization || '').match(/^Basic (.+)$/);
    if (m) {
      const decoded = Buffer.from(m[1], 'base64').toString('utf8');
      const i = decoded.indexOf(':');
      const name = decoded.slice(0, i);
      const pass = decoded.slice(i + 1);
      const u = users.find((x) => x.name === name);
      if (u && safeEq(u.password, pass)) {
        req.user = name;
        return next();
      }
    }
    res.setHeader('WWW-Authenticate', 'Basic realm="BOM Portal", charset="UTF-8"');
    res.status(401).send('로그인이 필요합니다');
  };
}

module.exports = { createApp };
