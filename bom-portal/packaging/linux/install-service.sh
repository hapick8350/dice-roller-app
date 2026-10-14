#!/usr/bin/env bash
# systemd 서비스로 등록 (부팅 시 자동 실행). sudo 로 실행하세요.
set -e
if [ "$(id -u)" -ne 0 ]; then echo "sudo ./install-service.sh 로 실행하세요"; exit 1; fi
DIR="$(cd "$(dirname "$0")" && pwd)"
RUN_USER="${SUDO_USER:-root}"
[ -f "$DIR/.env" ] || sed 's/^AUTH_MODE=.*/AUTH_MODE=local/' "$DIR/.env.example" > "$DIR/.env"
chown -R "$RUN_USER" "$DIR"
cat > /etc/systemd/system/bom-portal.service <<UNIT
[Unit]
Description=BOM Portal (SAP Business ByDesign)
After=network-online.target
Wants=network-online.target

[Service]
User=$RUN_USER
WorkingDirectory=$DIR
ExecStart=$DIR/runtime/bin/node --disable-warning=ExperimentalWarning $DIR/src/server.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now bom-portal
echo "등록되었습니다. 상태: systemctl status bom-portal / 로그: journalctl -u bom-portal -f"
