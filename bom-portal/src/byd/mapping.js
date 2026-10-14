'use strict';

// ByD 필드 매핑.
//
// ByD의 Custom OData 서비스는 고객이 직접 만드는 것이라 엔티티셋/필드 이름이 테넌트마다 다르다.
// SOAP 서비스도 릴리스에 따라 요소 이름이 다를 수 있다.
// 아래 값은 기본 추정치이며, 연동 PoC 단계에서 실제 $metadata 와 WSDL 을 보고 맞춰야 한다.

module.exports = {
  odata: {
    // BOM Custom OData 서비스 (BO: Bill Of Material)
    bomEntitySet: 'BillOfMaterialCollection',
    bomExpand: 'Variant/Version/Item', // 헤더 → 버전 → 구성품 탐색 경로
    bom: {
      material: 'ProductID',
      plant: 'SiteID',
      baseQty: 'BaseQuantity',
      baseUnit: 'BaseQuantityUnitCode',
      versionsNav: 'Version',
    },
    version: {
      version: 'VersionID',
      status: 'LifeCycleStatusCode',
      validFrom: 'ValidityStartDate',
      description: 'Description',
      changedBy: 'LastChangedBy',
      changedAt: 'LastChangeDateTime',
      itemsNav: 'Item',
    },
    item: {
      itemNo: 'ItemID',
      component: 'ComponentProductID',
      qty: 'Quantity',
      unit: 'QuantityUnitCode',
    },
    // ByD 상태 코드 → 포털 상태 (코드 값은 테넌트에서 확인 필요)
    statusMap: {
      '1': 'IN_PREPARATION',
      '2': 'RELEASED',
      '3': 'OBSOLETE',
    },

    // 자재 마스터 Custom OData 서비스
    materialEntitySet: 'MaterialCollection',
    material: {
      id: 'InternalID',
      description: 'Description',
      unit: 'BaseMeasureUnitCode',
      type: 'ProductCategoryID',
    },
  },

  soap: {
    namespace: 'http://sap.com/xi/SAPGlobal20/Global',
    // BOM 생성/변경 오퍼레이션 요청 루트 요소
    maintainRequest: 'BillOfMaterialBundleMaintainRequest_sync',
    // BOM 버전 해제 오퍼레이션 요청 루트 요소
    releaseRequest: 'BillOfMaterialReleaseRequest_sync',
  },
};
