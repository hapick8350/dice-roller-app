'use strict';

const mapping = require('./mapping');

function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function envelope(body) {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:glob="${mapping.soap.namespace}">` +
    '<soapenv:Header/>' +
    `<soapenv:Body>${body}</soapenv:Body>` +
    '</soapenv:Envelope>'
  );
}

// BOM 등록/새 버전 생성 요청.
// 요소 구조는 ByD BOM 관리 서비스 WSDL 기준으로 PoC 때 확정한다.
function buildMaintainBom(bom) {
  const root = mapping.soap.maintainRequest;
  const items = bom.items
    .map(
      (it) =>
        '<Item actionCode="01">' +
        `<ItemID>${esc(it.itemNo)}</ItemID>` +
        `<ComponentProductID>${esc(it.component)}</ComponentProductID>` +
        `<Quantity unitCode="${esc(it.unit)}">${esc(it.qty)}</Quantity>` +
        '</Item>'
    )
    .join('');
  return envelope(
    `<glob:${root}>` +
      '<BillOfMaterial actionCode="04">' +
      `<ProductID>${esc(bom.material)}</ProductID>` +
      `<SiteID>${esc(bom.plant)}</SiteID>` +
      `<BaseQuantity unitCode="${esc(bom.baseUnit)}">${esc(bom.baseQty)}</BaseQuantity>` +
      '<Version actionCode="01">' +
      `<ValidityStartDate>${esc(bom.validFrom)}</ValidityStartDate>` +
      `<Description>${esc(bom.description)}</Description>` +
      items +
      '</Version>' +
      '</BillOfMaterial>' +
      `</glob:${root}>`
  );
}

function buildReleaseVersion(material, plant, version) {
  const root = mapping.soap.releaseRequest;
  return envelope(
    `<glob:${root}>` +
      `<ProductID>${esc(material)}</ProductID>` +
      `<SiteID>${esc(plant)}</SiteID>` +
      `<VersionID>${esc(version)}</VersionID>` +
      `</glob:${root}>`
  );
}

// 응답 XML에서 오류 메시지와 버전 번호를 꺼낸다 (XML 파서 없이 최소한으로 처리).
function parseResponse(xml) {
  const fault = xml.match(/<faultstring[^>]*>([\s\S]*?)<\/faultstring>/);
  if (fault) return { ok: false, messages: [fault[1].trim()] };
  const messages = [];
  let hasError = false;
  const re = /<Item>\s*<TypeID>[^<]*<\/TypeID>\s*<CategoryCode>([^<]*)<\/CategoryCode>\s*<SeverityCode>(\d)<\/SeverityCode>\s*<Note>([^<]*)<\/Note>/g;
  let m;
  while ((m = re.exec(xml))) {
    // SeverityCode: 1=정보, 2=경고, 3=오류
    if (m[2] === '3') hasError = true;
    messages.push(m[3]);
  }
  const ver = xml.match(/<VersionID>([^<]+)<\/VersionID>/);
  return { ok: !hasError, messages, version: ver ? ver[1] : undefined };
}

module.exports = { buildMaintainBom, buildReleaseVersion, parseResponse, esc };
