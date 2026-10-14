'use strict';

// 실제 SAP Business ByDesign 연동 클라이언트.
//   읽기: Custom OData (OData v2, JSON)
//   쓰기: BOM 관리 SOAP 웹서비스 (Communication Arrangement)
// 인증: Communication Arrangement 의 통신 사용자 (Basic 인증)

const mapping = require('./mapping');
const soap = require('./soap');

class BydClient {
  constructor(cfg) {
    for (const k of ['baseUrl', 'user', 'password']) {
      if (!cfg[k]) throw new Error(`BYD_MODE=byd 에는 ${k} 설정이 필요합니다 (.env 확인)`);
    }
    this.cfg = cfg;
    this.mode = 'byd';
    this.auth = 'Basic ' + Buffer.from(`${cfg.user}:${cfg.password}`).toString('base64');
  }

  async _fetch(url, init = {}) {
    const res = await fetch(url, {
      ...init,
      headers: { Authorization: this.auth, ...(init.headers || {}) },
      signal: AbortSignal.timeout(this.cfg.timeoutMs),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`ByD 호출 실패 (${res.status}): ${text.slice(0, 300)}`);
    return text;
  }

  // OData v2 컬렉션을 페이지 단위로 모두 읽는다.
  async _odataAll(servicePath, entitySet, params) {
    const out = [];
    const qs = new URLSearchParams({ $format: 'json', ...params });
    let url = `${this.cfg.baseUrl}${servicePath}/${entitySet}?${qs}`;
    while (url) {
      const json = JSON.parse(await this._fetch(url, { headers: { Accept: 'application/json' } }));
      out.push(...json.d.results);
      url = json.d.__next || null;
    }
    return out;
  }

  async ping() {
    await this._fetch(`${this.cfg.baseUrl}${this.cfg.odataBomPath}/$metadata`);
    return { ok: true, mode: this.mode };
  }

  _mapMaterial(r) {
    const f = mapping.odata.material;
    return { id: r[f.id], description: r[f.description], unit: r[f.unit], type: r[f.type] };
  }

  async getMaterials(ids) {
    const out = new Map();
    const unique = [...new Set(ids)];
    const f = mapping.odata.material;
    // URL 길이 제한 때문에 40건씩 나누어 조회
    for (let i = 0; i < unique.length; i += 40) {
      const chunk = unique.slice(i, i + 40);
      const filter = chunk.map((id) => `${f.id} eq '${odataStr(id)}'`).join(' or ');
      const rows = await this._odataAll(this.cfg.odataMaterialPath, mapping.odata.materialEntitySet, { $filter: filter });
      for (const r of rows) out.set(r[f.id], this._mapMaterial(r));
    }
    return out;
  }

  async searchMaterials(text, limit = 20) {
    const f = mapping.odata.material;
    const t = odataStr(text || '');
    const rows = await this._odataAll(this.cfg.odataMaterialPath, mapping.odata.materialEntitySet, {
      $filter: `substringof('${t}',${f.id}) or substringof('${t}',${f.description})`,
      $top: String(limit),
    });
    return rows.slice(0, limit).map((r) => this._mapMaterial(r));
  }

  _mapBom(r) {
    const { bom: b, version: v, item: it, statusMap } = mapping.odata;
    const versions = (r[b.versionsNav]?.results || []).map((ver) => ({
      version: String(ver[v.version]),
      status: statusMap[ver[v.status]] || ver[v.status],
      validFrom: odataDate(ver[v.validFrom]),
      description: ver[v.description] || '',
      changedBy: ver[v.changedBy] || '',
      changedAt: odataDateTime(ver[v.changedAt]),
      items: (ver[v.itemsNav]?.results || []).map((i) => ({
        itemNo: String(i[it.itemNo]),
        component: i[it.component],
        qty: Number(i[it.qty]),
        unit: i[it.unit],
      })),
    }));
    versions.sort((a, z) => Number(a.version) - Number(z.version));
    return {
      material: r[b.material],
      plant: r[b.plant],
      baseQty: Number(r[b.baseQty]),
      baseUnit: r[b.baseUnit],
      versions,
    };
  }

  async getAllBoms() {
    const rows = await this._odataAll(this.cfg.odataBomPath, mapping.odata.bomEntitySet, {
      $expand: mapping.odata.bomExpand,
    });
    return rows.map((r) => this._mapBom(r));
  }

  async getBom(material, plant) {
    const b = mapping.odata.bom;
    const rows = await this._odataAll(this.cfg.odataBomPath, mapping.odata.bomEntitySet, {
      $filter: `${b.material} eq '${odataStr(material)}' and ${b.plant} eq '${odataStr(plant)}'`,
      $expand: mapping.odata.bomExpand,
    });
    return rows.length ? this._mapBom(rows[0]) : null;
  }

  async _soap(xml) {
    if (!this.cfg.soapBomUrl) throw new Error('BYD_SOAP_BOM_URL 이 설정되지 않았습니다');
    const text = await this._fetch(this.cfg.soapBomUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=utf-8' },
      body: xml,
    });
    const r = soap.parseResponse(text);
    if (!r.ok) throw new Error(r.messages.join(' / ') || 'ByD 오류 응답');
    return r;
  }

  async postBom(bom, user) {
    const before = await this.getBom(bom.material, bom.plant);
    const r = await this._soap(soap.buildMaintainBom(bom));
    let version = r.version;
    if (!version) {
      // 응답에 버전이 없으면 다시 읽어서 최신 버전을 찾는다
      const after = await this.getBom(bom.material, bom.plant);
      version = after?.versions.at(-1)?.version;
    }
    if (bom.release && version) await this.releaseVersion(bom.material, bom.plant, version, user);
    return { action: before ? 'NEW_VERSION' : 'CREATE', version };
  }

  async releaseVersion(material, plant, version) {
    await this._soap(soap.buildReleaseVersion(material, plant, version));
  }
}

function odataStr(s) {
  return String(s).replace(/'/g, "''");
}

// OData v2 날짜 "/Date(1767225600000)/" 또는 ISO 문자열 → YYYY-MM-DD
function odataDate(v) {
  const iso = odataDateTime(v);
  return iso ? iso.slice(0, 10) : '';
}

function odataDateTime(v) {
  if (!v) return '';
  const m = String(v).match(/\/Date\((-?\d+)/);
  return m ? new Date(Number(m[1])).toISOString() : String(v);
}

module.exports = { BydClient, odataDate };
