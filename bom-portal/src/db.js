'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

// 포털 자체 DB: 업로드 이력과 Mock 모드의 ByD 데이터를 저장한다.
// SAP 데이터의 원본은 항상 ByD이며, 이 DB는 로그와 Mock 용도로만 쓴다.
function openDb(dataDir) {
  let file = ':memory:';
  if (dataDir !== ':memory:') {
    fs.mkdirSync(dataDir, { recursive: true });
    file = path.join(dataDir, 'portal.db');
  }
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS upload_jobs (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      file_name     TEXT NOT NULL,
      uploaded_by   TEXT NOT NULL,
      uploaded_at   TEXT NOT NULL,
      status        TEXT NOT NULL,          -- VALIDATED / INVALID / POSTED / PARTIAL / FAILED
      release_now   INTEGER NOT NULL DEFAULT 0,
      bom_count     INTEGER NOT NULL DEFAULT 0,
      error_count   INTEGER NOT NULL DEFAULT 0,
      payload_json  TEXT NOT NULL,          -- 검증된 BOM 묶음
      posted_at     TEXT,
      posted_by     TEXT
    );

    CREATE TABLE IF NOT EXISTS upload_results (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id        INTEGER NOT NULL REFERENCES upload_jobs(id),
      material      TEXT NOT NULL,
      plant         TEXT NOT NULL,
      action        TEXT NOT NULL,          -- CREATE / NEW_VERSION / NO_CHANGE
      success       INTEGER NOT NULL,
      version       TEXT,
      message       TEXT
    );
  `);
  return db;
}

module.exports = { openDb };
