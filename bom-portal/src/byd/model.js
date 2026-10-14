'use strict';

// 포털 내부 공통 BOM 모델
//
// Bom {
//   material, plant, baseQty, baseUnit,
//   versions: [{ version, status, validFrom, description, changedBy, changedAt,
//                items: [{ itemNo, component, qty, unit }] }]
// }
//
// 상태는 ByD BOM 버전 상태에 대응한다.
const STATUS = Object.freeze({
  IN_PREPARATION: 'IN_PREPARATION', // 작성중 (임시/변경 BOM)
  RELEASED: 'RELEASED', //             해제 (현재 유효 BOM)
  OBSOLETE: 'OBSOLETE', //             폐기 (이전 버전)
});

const STATUS_LABEL = Object.freeze({
  IN_PREPARATION: '작성중',
  RELEASED: '해제(유효)',
  OBSOLETE: '폐기',
});

module.exports = { STATUS, STATUS_LABEL };
