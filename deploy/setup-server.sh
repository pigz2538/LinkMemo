#!/usr/bin/env bash
set -euo pipefail

NODE_MAJOR_REQUIRED=20

log() {
  printf "\n==> %s\n" "$1"
}

log "1/7 swap"
if ! swapon --show | grep -q .; then
  if [ ! -f /swapfile ]; then
    sudo fallocate -l 2G /swapfile || sudo dd if=/dev/zero of=/swapfile bs=1M count=2048
    sudo chmod 600 /swapfile
    sudo mkswap /swapfile
  fi
  sudo swapon /swapfile
  log "2GB swap enabled"
else
  log "swap already enabled"
fi
if ! grep -q '^/swapfile ' /etc/fstab; then
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi
if [ ! -f /etc/sysctl.d/99-linkmemo-swappiness.conf ]; then
  echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-linkmemo-swappiness.conf >/dev/null
  sudo sysctl --system >/dev/null
fi

log "2/7 apt packages"
sudo apt-get update -y
sudo apt-get install -y curl ca-certificates gnupg nginx ufw

log "3/7 node.js"
need_node=1
if command -v node >/dev/null 2>&1; then
  major="$(node -p "process.versions.node.split('.')[0]")"
  if [ "$major" -ge "$NODE_MAJOR_REQUIRED" ]; then
    need_node=0
  fi
fi
if [ "$need_node" -eq 1 ]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR_REQUIRED}.x" | sudo -E bash -
  sudo apt-get install -y nodejs
else
  log "node $(node -v) already installed"
fi

log "4/5 nginx reverse proxy"
sudo tee /etc/nginx/sites-available/linkmemo >/dev/null <<'NGINX'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    client_max_body_size 2m;

    location /health {
        proxy_pass http://127.0.0.1:3000/health;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
        proxy_connect_timeout 10s;
    }
}
NGINX

sudo ln -sf /etc/nginx/sites-available/linkmemo /etc/nginx/sites-enabled/linkmemo
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx

log "5/5 ufw"
sudo ufw allow OpenSSH >/dev/null || true
sudo ufw allow 80/tcp >/dev/null || true
sudo ufw allow 443/tcp >/dev/null || true
sudo ufw --force enable >/dev/null || true

log "service status"
sudo systemctl --no-pager --full status "$SERVICE_NAME" | head -20 || true
log "local health check"
curl -fsS http://127.0.0.1/health
printf "\n\nsetup complete\n"
