#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="/etc/linkmemo/api.env"
DB_NAME="linkmemo"
DB_USER="linkmemo"

log() {
  printf "\n==> %s\n" "$1"
}

log "install postgresql"
sudo apt-get update -y
sudo apt-get install -y postgresql postgresql-contrib

log "prepare environment file"
sudo mkdir -p /etc/linkmemo
if [ ! -s "$ENV_FILE" ]; then
  DB_PASS="$(openssl rand -hex 24)"
  JWT_SECRET="$(openssl rand -hex 32)"
  sudo tee "$ENV_FILE" >/dev/null <<EOF
DATABASE_URL=postgresql://${DB_USER}:${DB_PASS}@127.0.0.1:5432/${DB_NAME}
JWT_SECRET=${JWT_SECRET}
PORT=3000
WECHAT_APPID=
WECHAT_SECRET=
EOF
  sudo chmod 600 "$ENV_FILE"
else
  set -a
  . "$ENV_FILE"
  set +a
  if [ -z "${DATABASE_URL:-}" ]; then
    echo "DATABASE_URL missing in $ENV_FILE" >&2
    exit 1
  fi
  DB_PASS="$(printf '%s' "$DATABASE_URL" | sed -E 's#^postgres(ql)?://[^:]+:([^@]+)@.*#\2#')"
  if [ -z "$DB_PASS" ] || [ "$DB_PASS" = "$DATABASE_URL" ]; then
    echo "cannot parse database password from DATABASE_URL" >&2
    exit 1
  fi
fi

if ! sudo grep -q '^JWT_SECRET=' "$ENV_FILE"; then
  echo "JWT_SECRET=$(openssl rand -hex 32)" | sudo tee -a "$ENV_FILE" >/dev/null
fi
if ! sudo grep -q '^PORT=' "$ENV_FILE"; then
  echo "PORT=3000" | sudo tee -a "$ENV_FILE" >/dev/null
fi
if ! sudo grep -q '^WECHAT_APPID=' "$ENV_FILE"; then
  echo "WECHAT_APPID=" | sudo tee -a "$ENV_FILE" >/dev/null
fi
if ! sudo grep -q '^WECHAT_SECRET=' "$ENV_FILE"; then
  echo "WECHAT_SECRET=" | sudo tee -a "$ENV_FILE" >/dev/null
fi

log "create role and database"
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" | grep -q 1; then
  sudo -u postgres psql -v ON_ERROR_STOP=1 -c "CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASS}';"
else
  sudo -u postgres psql -v ON_ERROR_STOP=1 -c "ALTER ROLE ${DB_USER} WITH PASSWORD '${DB_PASS}';"
fi
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1; then
  sudo -u postgres createdb -O "$DB_USER" "$DB_NAME"
fi
sudo -u postgres psql -d "$DB_NAME" -v ON_ERROR_STOP=1 -c 'CREATE EXTENSION IF NOT EXISTS pg_trgm;'

log "tune postgresql for 1.6GB server"
PG_VER="$(ls /etc/postgresql | sort -V | tail -1)"
CONF_DIR="/etc/postgresql/${PG_VER}/main/conf.d"
sudo mkdir -p "$CONF_DIR"
sudo tee "${CONF_DIR}/linkmemo.conf" >/dev/null <<'CONF'
shared_buffers = 128MB
effective_cache_size = 512MB
work_mem = 4MB
maintenance_work_mem = 64MB
max_connections = 50
CONF
sudo systemctl restart postgresql

log "verify connection"
PGPASSWORD="$DB_PASS" psql -h 127.0.0.1 -U "$DB_USER" -d "$DB_NAME" -c 'SELECT 1' >/dev/null
printf "\npostgresql ready\n"
