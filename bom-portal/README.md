# BOM 포털 (SAP Business ByDesign)

SAP Business ByDesign(ByD)의 BOM을 웹에서 **조회 · 분석 · 변경이력 확인**하고,
**엑셀 업로드로 등록/변경**하는 웹 애플리케이션입니다.

## 주요 기능

| 메뉴 | 내용 |
|---|---|
| BOM 조회 | 모품목/품명/플랜트/상태로 검색, 버전별 구성품 조회, 버전 비교, 작성중 버전 해제(유효화), 엑셀 다운로드 |
| 전개 분석 | 정전개(다단계, 생산수량 기준 소요량, 기준일 지정), 최하위 자재 소요량 합계, 역전개(사용처, 최상위 품목까지) |
| 변경이력 | 버전 간 차이를 구성품 단위로 표시 (추가/삭제/수량 변경/단위 변경), 기간·변경자·유형 필터, 엑셀 다운로드 |
| 엑셀 등록 | 양식 다운로드 → 업로드 → 검증 및 현재 SAP BOM과 비교 → SAP 반영 (작성중 또는 즉시 해제) |
| 업로드 내역 | 누가 언제 어떤 파일로 무엇을 반영했는지, 결과와 오류 메시지 |

### BOM 버전 규칙 (ByD 표준 방식)

- ByD처럼 BOM은 **버전 단위**로 관리합니다. 기존 버전을 직접 고치지 않고 새 버전을 만듭니다.
- 상태: **작성중**(IN_PREPARATION, 임시/변경 BOM) → **해제**(RELEASED, 현재 유효) → **폐기**(OBSOLETE, 이전 버전)
- 엑셀 업로드 시
  - SAP에 없는 BOM → 신규 등록
  - 있는 BOM → 새 버전(작성중)으로 등록. "등록 후 바로 해제"를 선택하면 즉시 유효화
  - 현재 유효 버전과 내용이 같으면 반영하지 않음
- 변경이력은 연속된 버전을 비교해서 만들기 때문에, ByD 화면에서 직접 바꾼 내용도 함께 보입니다.

### 엑셀 검증 항목

필수값, 숫자/날짜 형식, 수량 > 0, 모품목 = 구성품 금지, 같은 BOM 안의 헤더값 일치, 항목번호 중복,
SAP 자재 존재 여부, 자재 기본단위와 다른 단위(경고), 순환 참조, 과거 유효시작일(경고), 같은 구성품 중복(경고).
오류가 하나라도 있으면 반영할 수 없고, 검증결과를 엑셀로 내려받을 수 있습니다.
같은 업로드 작업은 두 번 반영되지 않습니다.

## 실행

Node.js 22.13 이상이 필요합니다.

```bash
cd bom-portal
npm install
cp .env.example .env     # 필요한 값 수정
npm start                # http://localhost:3000
npm test                 # 테스트
```

`BYD_MODE=mock`(기본값)이면 샘플 BOM 데이터(정수기 제품 구조)로 바로 써볼 수 있습니다.
화면 오른쪽 위에 **MOCK 데이터** 표시가 나옵니다.

## 실제 ByD 연동 (`BYD_MODE=byd`)

### 1. ByD 설정 (관리자)

1. **Custom OData 서비스 생성**: *Application and User Management → OData Services*
   - BOM 서비스: Bill of Material BO 기준, 헤더 → 버전 → 구성품을 포함
   - 자재 서비스: Material BO 기준, 자재코드 · 품명 · 기본단위
2. **Communication System** 생성 (포털 서버)
3. **Communication Arrangement** 생성
   - 위 OData 서비스와 BOM 관리 웹서비스(인바운드)를 포함
   - 통신 사용자와 비밀번호 발급 → `.env` 의 `BYD_USER`, `BYD_PASSWORD`
   - SOAP 엔드포인트 URL → `BYD_SOAP_BOM_URL`
4. 반드시 **테스트 테넌트**에서 먼저 검증합니다.

### 2. 필드 매핑 맞추기

ByD Custom OData의 엔티티/필드 이름은 테넌트에서 만드는 방식에 따라 달라지고,
SOAP 요청 구조도 릴리스에 따라 다를 수 있습니다. 실제 연동 전에 아래 두 파일을 맞춰야 합니다.

- `src/byd/mapping.js` — OData 엔티티셋/필드 이름, 상태 코드, SOAP 요청 루트 요소
  - `<BYD_BASE_URL><BYD_ODATA_BOM_PATH>/$metadata` 로 실제 이름을 확인
- `src/byd/soap.js` — BOM 등록/해제 SOAP 요청 XML
  - Communication Arrangement 에서 내려받은 WSDL 기준으로 요소 이름 확인

> 현재 `mapping.js` / `soap.js` 의 값은 **추정치이며 실제 테넌트에서 검증되지 않았습니다.**
> Mock 모드의 기능과 화면은 모두 동작하지만, 실제 ByD 반영은 위 매핑 확인 후 테스트 테넌트에서 검증해야 합니다.

연결 확인: `GET /api/health`

### 3. 참고 사항

- **Production Model**: ByD에서 생산/MRP에 새 BOM 버전을 쓰려면 Production Model도 새로 해제해야 할 수 있습니다.
  이 포털은 BOM까지만 처리합니다.
- 조회 성능을 위해 BOM 전체를 60초 동안 캐시합니다. 업로드 반영과 해제 후에는 바로 갱신됩니다.

## 구조

```
bom-portal/
├─ src/
│  ├─ server.js              서버 시작
│  ├─ app.js                 API 라우트, 인증
│  ├─ config.js              환경설정 (.env)
│  ├─ db.js                  포털 DB (SQLite: 업로드 이력, Mock 데이터)
│  ├─ byd/
│  │  ├─ mockClient.js       Mock ByD (샘플 데이터)
│  │  ├─ bydClient.js        실제 ByD 연동 (OData 읽기, SOAP 쓰기)
│  │  ├─ mapping.js          ByD 필드 매핑  ← 연동 시 수정
│  │  ├─ soap.js             SOAP 요청/응답  ← 연동 시 확인
│  │  └─ model.js            공통 모델, 상태값
│  └─ services/
│     ├─ bomService.js       조회, 정전개/역전개, 버전 비교, 변경이력
│     ├─ uploadService.js    엑셀 검증, SAP 반영, 업로드 작업
│     └─ excel.js            양식 생성, 업로드 파싱, 엑셀 내보내기
├─ public/                   웹 화면 (HTML/CSS/JS)
└─ test/                     테스트
```

## API

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/boms?q=&plant=&status=` | BOM 목록 (`format=xlsx` 로 엑셀) |
| GET | `/api/boms/:plant/:material` | BOM 상세 (모든 버전) |
| GET | `/api/boms/:plant/:material/compare?from=&to=` | 버전 비교 |
| POST | `/api/boms/:plant/:material/versions/:version/release` | 작성중 버전 해제 |
| GET | `/api/explode?material=&plant=&qty=&date=` | 정전개 |
| GET | `/api/where-used?component=&plant=&date=` | 역전개 |
| GET | `/api/history?material=&plant=&from=&to=&user=&type=` | 변경이력 |
| GET | `/api/upload/template` | 업로드 양식 |
| POST | `/api/upload/preview` | 엑셀 업로드·검증 (multipart `file`) |
| POST | `/api/upload/jobs/:id/commit` | SAP 반영 (`{ "release": true }` 이면 즉시 해제) |
| GET | `/api/upload/jobs`, `/api/upload/jobs/:id` | 업로드 내역 |
| GET | `/api/health` | ByD 연결 확인 |

## 보안

- `APP_USERS` 를 설정하면 HTTP Basic 로그인이 적용되고, 변경자 이름이 기록됩니다.
  운영 환경에서는 HTTPS 리버스 프록시(Nginx 등) 뒤에서 실행하고, 필요하면 사내 SSO로 교체합니다.
- ByD 통신 사용자 비밀번호는 서버의 `.env` 에만 두고 저장소에 올리지 않습니다.
