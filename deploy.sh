#!/usr/bin/env bash
# Aggiorna il server con l'ultima versione pubblicata su GitHub, con un solo comando:
#   ./deploy.sh
# Il server deve essere una copia git del repository (vedi README, "Aggiornare il server").
# Si può cambiare destinazione: DEPLOY_HOST=mioserver DEPLOY_DIR=~/dashboard-giornata ./deploy.sh
set -euo pipefail

HOST="${DEPLOY_HOST:-homelab}"
DIR="${DEPLOY_DIR:-~/dashboard-giornata}"
SERVICE="dashboard-giornata"
PORT="${DEPLOY_PORT:-8080}"

cd "$(dirname "$0")"

# 1. Sul server arriva solo ciò che è su GitHub: niente modifiche dimenticate o non inviate.
if [ -n "$(git status --porcelain)" ]; then
  echo "Hai modifiche non salvate in un commit. Fai prima git commit." >&2; exit 1
fi
git fetch -q origin
if [ -n "$(git log --oneline origin/main..HEAD)" ]; then
  echo "Ci sono commit non ancora su GitHub: li invio (git push)."
  git push -q origin HEAD:main
fi

# 2. Sul server: scarica, aggiorna le librerie se requirements.txt è cambiato, riavvia.
echo "Aggiorno $HOST..."
ssh "$HOST" bash -s <<EOF
set -euo pipefail
cd $DIR
before=\$(git rev-parse HEAD)
git pull -q --ff-only
after=\$(git rev-parse HEAD)
if [ "\$before" = "\$after" ]; then echo "Il server era già aggiornato."; fi
if ! git diff --quiet "\$before" "\$after" -- requirements.txt; then
  echo "requirements.txt è cambiato: aggiorno le librerie."
  .venv/bin/pip install -q -r requirements.txt
fi
systemctl --user restart $SERVICE
git log --oneline -1
EOF

# 3. Controllo: la dashboard risponde?
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if ssh "$HOST" "curl -fsS -o /dev/null http://localhost:$PORT/"; then
    echo "Fatto: la dashboard su $HOST risponde."; exit 0
  fi
  sleep 1
done
echo "Attenzione: la dashboard non risponde. Guarda i log con:" >&2
echo "  ssh $HOST journalctl --user -u $SERVICE -n 30" >&2
exit 1
