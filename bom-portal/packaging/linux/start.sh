#!/usr/bin/env bash
# BOM 포털 실행 (터미널에서 실행, Ctrl+C 로 종료)
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"
if [ ! -f .env ]; then
  sed 's/^AUTH_MODE=.*/AUTH_MODE=local/' .env.example > .env
  echo "[안내] 설정 파일 .env 를 만들었습니다. 로그인: admin / change-me"
  echo "       SAP 로그인 연동: .env 에 BYD_BASE_URL 입력 후 AUTH_MODE=byd 로 바꾸고 다시 실행"
fi
exec "$DIR/runtime/bin/node" --disable-warning=ExperimentalWarning "$DIR/src/server.js"
