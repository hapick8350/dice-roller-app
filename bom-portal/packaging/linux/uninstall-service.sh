#!/usr/bin/env bash
set -e
if [ "$(id -u)" -ne 0 ]; then echo "sudo ./uninstall-service.sh 로 실행하세요"; exit 1; fi
systemctl disable --now bom-portal 2>/dev/null || true
rm -f /etc/systemd/system/bom-portal.service
systemctl daemon-reload
echo "서비스를 해제했습니다."
