#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/linkmemo/app"
REPO_URL="https://github.com/pigz2538/LinkMemo.git"

log() {
  printf "\n==> %s\n" "$1"
}

log "prepare app directory"
sudo mkdir -p /opt/linkmemo
sudo chown admin:admin /opt/linkmemo
if [ ! -d "$APP_DIR/.git" ]; then
  git clone --depth 1 "$REPO_URL" "$APP_DIR"
else
  git -C "$APP_DIR" pull --ff-only
fi

log "install server dependencies"
npm ci --prefix "$APP_DIR/server"

log "run database migration"
sudo bash -c "set -a; . /etc/linkmemo/api.env; set +a; cd ${APP_DIR}/server; /usr/bin/node migrate.js"

log "install systemd unit"
sudo tee /etc/systemd/system/linkmemo-api.service >/dev/null <<UNIT
[Unit]
Description=LinkMemo API
After=network.target postgresql.service

[Service]
Type=simple
User=admin
Group=admin
WorkingDirectory=${APP_DIR}/server
Environment=NODE_ENV=production
EnvironmentFile=/etc/linkmemo/api.env
ExecStart=/usr/bin/node ${APP_DIR}/server/index.js
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT

sudo systemctl daemon-reload
sudo systemctl enable linkmemo-api
sudo systemctl restart linkmemo-api

log "health check"
sleep 2
curl -fsS http://127.0.0.1/health
printf "\n\ndeploy complete\n"
