#!/usr/bin/env bash
# 설치 패키지 생성 (Node.js 실행 환경 포함 포터블 패키지)
#
#   ./packaging/build.sh            → Windows x64 zip + Linux x64 tar.gz
#   ./packaging/build.sh win        → Windows 만
#   ./packaging/build.sh linux      → Linux 만
#
# 결과물: bom-portal/dist/
set -euo pipefail

NODE_VERSION="${NODE_VERSION:-22.22.0}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PKG_DIR="$ROOT/packaging"
DIST="$ROOT/dist"
CACHE="$ROOT/.build-cache"
APP_VERSION="$(node -p "require('$ROOT/package.json').version")"
TARGETS=("${@:-win linux}")
TARGETS=(${TARGETS[*]})

mkdir -p "$DIST" "$CACHE"

download() {
  local url="$1" out="$2"
  if [ ! -s "$out" ]; then
    echo "  다운로드: $url"
    curl -fsSL --retry 3 -o "$out.part" "$url"
    mv "$out.part" "$out"
  fi
}

verify() {
  local file="$1" name="$2"
  download "https://nodejs.org/dist/v$NODE_VERSION/SHASUMS256.txt" "$CACHE/SHASUMS256-$NODE_VERSION.txt"
  local expected
  expected="$(grep " $name\$" "$CACHE/SHASUMS256-$NODE_VERSION.txt" | cut -d' ' -f1)"
  local actual
  actual="$(sha256sum "$file" | cut -d' ' -f1)"
  if [ -z "$expected" ] || [ "$expected" != "$actual" ]; then
    echo "체크섬 불일치: $name" >&2
    rm -f "$file"
    exit 1
  fi
}

# 앱 파일 + 운영용 의존성
stage_app() {
  local dest="$1"
  rm -rf "$dest"
  mkdir -p "$dest"
  cp -r "$ROOT/src" "$ROOT/public" "$dest/"
  cp "$ROOT/package.json" "$ROOT/package-lock.json" "$ROOT/README.md" "$ROOT/.env.example" "$dest/"
  (cd "$dest" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund --loglevel=error)
  # 실행에 필요 없는 파일 정리 (브라우저용 번들, 소스맵, 문서, 타입 정의)
  rm -rf "$dest/node_modules/exceljs/dist" "$dest/node_modules/@types"
  find "$dest/node_modules" -type f \( -name '*.map' -o -name '*.md' -o -name '*.d.ts' -o -name '*.markdown' \) -delete
  find "$dest/node_modules" -type d \( -name test -o -name tests -o -name __tests__ -o -name example -o -name examples -o -name docs \) -prune -exec rm -rf {} +
  # 의존성에 네이티브 모듈이 없어야 다른 OS에서 그대로 쓸 수 있다
  if find "$dest/node_modules" -name '*.node' | grep -q .; then
    echo "네이티브 모듈이 있어 크로스 패키징할 수 없습니다" >&2
    exit 1
  fi
}

build_win() {
  local name="node-v$NODE_VERSION-win-x64"
  local zip="$CACHE/$name.zip"
  download "https://nodejs.org/dist/v$NODE_VERSION/$name.zip" "$zip"
  verify "$zip" "$name.zip"

  local out="$CACHE/stage-win/bom-portal"
  echo "Windows 패키지 구성..."
  stage_app "$out"
  mkdir -p "$out/runtime"
  unzip -q -o -j "$zip" "$name/node.exe" "$name/LICENSE" -d "$out/runtime"
  # 배치 파일은 CRLF 줄바꿈이어야 한다
  for f in "$PKG_DIR"/win/*.bat; do
    sed 's/\r$//; s/$/\r/' "$f" > "$out/$(basename "$f")"
  done
  sed 's/\r$//; s/$/\r/' "$PKG_DIR/win/INSTALL.txt" > "$out/INSTALL.txt"
  sed -i 's/$/\r/' "$out/.env.example"

  local file="$DIST/bom-portal-$APP_VERSION-win-x64.zip"
  rm -f "$file"
  (cd "$CACHE/stage-win" && zip -q -r -9 "$file" bom-portal)
  echo "  → $file ($(du -h "$file" | cut -f1))"
}

build_linux() {
  local name="node-v$NODE_VERSION-linux-x64"
  local tarball="$CACHE/$name.tar.xz"
  download "https://nodejs.org/dist/v$NODE_VERSION/$name.tar.xz" "$tarball"
  verify "$tarball" "$name.tar.xz"

  local out="$CACHE/stage-linux/bom-portal"
  echo "Linux 패키지 구성..."
  stage_app "$out"
  mkdir -p "$out/runtime/bin"
  tar -xJf "$tarball" -C "$out/runtime/bin" --strip-components=2 "$name/bin/node"
  tar -xJf "$tarball" -C "$out/runtime" --strip-components=1 "$name/LICENSE"
  cp "$PKG_DIR"/linux/*.sh "$PKG_DIR/linux/INSTALL.txt" "$out/"
  chmod +x "$out"/*.sh "$out/runtime/bin/node"

  local file="$DIST/bom-portal-$APP_VERSION-linux-x64.tar.gz"
  rm -f "$file"
  tar -C "$CACHE/stage-linux" -czf "$file" bom-portal
  echo "  → $file ($(du -h "$file" | cut -f1))"
}

for t in "${TARGETS[@]}"; do
  case "$t" in
    win) build_win ;;
    linux) build_linux ;;
    *) echo "알 수 없는 대상: $t (win | linux)" >&2; exit 1 ;;
  esac
done
