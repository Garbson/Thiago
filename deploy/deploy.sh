#!/usr/bin/env bash
# Envia o código para a VPS e reinicia o serviço. Execute na SUA máquina, na raiz do projeto:
#   VPS=root@187.77.241.135 bash deploy/deploy.sh
# Use chave SSH (ssh-copy-id) em vez de senha.
set -euo pipefail
: "${VPS:?Defina VPS=usuario@ip}"

rsync -az --delete \
  --exclude node_modules --exclude .git --exclude .env --exclude '.claude' \
  --exclude 'server/uploads' --exclude dist \
  ./ "$VPS":/opt/carneiro/

ssh "$VPS" 'cd /opt/carneiro && chown -R carneiro:carneiro . && \
  sudo -u carneiro npm ci --omit=dev --no-audit --no-fund && \
  cp deploy/carneiro.service /etc/systemd/system/carneiro.service && \
  systemctl daemon-reload && systemctl enable carneiro && systemctl restart carneiro && \
  sleep 2 && systemctl --no-pager --lines=8 status carneiro'
