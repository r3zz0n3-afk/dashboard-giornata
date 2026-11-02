#!/usr/bin/env bash
# Installa la dashboard e la avvia come servizio sempre attivo (systemd utente).
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

echo "==> Ambiente Python"
python3 -m venv .venv
.venv/bin/pip install --upgrade pip -q
.venv/bin/pip install -r requirements.txt -q

if [ ! -f .env ]; then
  cp .env.example .env
  TOKEN=$(python3 -c 'import secrets; print(secrets.token_urlsafe(24))')
  sed -i "s|^REMINDERS_TOKEN=.*|REMINDERS_TOKEN=${TOKEN}|" .env
  echo "==> Creato .env (token promemoria generato). Ricordati di inserire APPLE_ID e APPLE_APP_PASSWORD."
fi
chmod 600 .env

echo "==> Servizio systemd"
mkdir -p "$HOME/.config/systemd/user"
cat > "$HOME/.config/systemd/user/dashboard-giornata.service" <<EOF
[Unit]
Description=Dashboard giornata (calendario + promemoria)
After=network-online.target
Wants=network-online.target

[Service]
WorkingDirectory=${DIR}
ExecStart=${DIR}/.venv/bin/python ${DIR}/server.py
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now dashboard-giornata.service
# fa partire il servizio all'accensione anche senza fare login
sudo loginctl enable-linger "$USER" || echo "(enable-linger non riuscito: il servizio partirà al login)"

IP=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src") print $(i+1)}')
PORT=$(grep -E '^PORT=' .env | cut -d= -f2)
echo
echo "Fatto! Apri:  http://localhost:${PORT:-8080}"
echo "Dal telefono (stessa rete):  http://${IP:-IP-DEL-PC}:${PORT:-8080}"
if command -v ufw >/dev/null && sudo ufw status 2>/dev/null | grep -q "Status: active"; then
  echo "Firewall ufw attivo: per aprire la porta esegui  sudo ufw allow ${PORT:-8080}/tcp"
fi
