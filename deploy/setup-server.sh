#!/usr/bin/env bash
# Prepara a VPS (Debian/Ubuntu) para rodar o site + API. Execute NA VPS, como root:
#   ADMIN_EMAIL=voce@email.com DOMAIN=seudominio.com.br bash setup-server.sh
# Convive com outros sites no mesmo servidor: usa porta própria (APP_PORT, padrão
# 3011), não mexe nos sites do nginx existentes e só cria o site do nginx quando
# DOMAIN é informado. Sem DOMAIN a API fica só em 127.0.0.1 (acesso por túnel SSH).
set -euo pipefail

APP_DIR=/opt/carneiro
APP_USER=carneiro
APP_PORT="${APP_PORT:-3011}"
DB_NAME=chiaradia_carneiro
DB_USER=carneiro
: "${ADMIN_EMAIL:?Defina ADMIN_EMAIL (e-mail de login do painel e contato dos portais)}"
DOMAIN="${DOMAIN:-}"
ADMIN_EMAIL_2="${ADMIN_EMAIL_2:-}"
CONTACT_EMAIL="${CONTACT_EMAIL:-$ADMIN_EMAIL}"

if ss -tln | grep -q ":$APP_PORT "; then
  if ! systemctl is-active --quiet carneiro; then
    echo "A porta $APP_PORT já está em uso por outro serviço. Rode com APP_PORT=<outra>." >&2
    exit 1
  fi
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl ca-certificates gnupg mariadb-server openssl rsync
command -v nginx >/dev/null || apt-get install -y nginx

if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

id "$APP_USER" >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
mkdir -p "$APP_DIR" /var/lib/carneiro/uploads
chown -R "$APP_USER":"$APP_USER" /var/lib/carneiro

systemctl enable --now mariadb

# .env é gerado uma única vez: rodar de novo não troca senhas existentes.
if [ ! -f "$APP_DIR/.env" ]; then
  DB_PASSWORD=$(openssl rand -hex 16)
  JWT_SECRET=$(openssl rand -hex 48)
  ADMIN_PASSWORD=$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-16)
  ADMIN_PASSWORD_2=$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-16)

  mysql -e "CREATE DATABASE IF NOT EXISTS \`$DB_NAME\` CHARACTER SET utf8mb4;"
  mysql -e "CREATE USER IF NOT EXISTS '$DB_USER'@'localhost' IDENTIFIED BY '$DB_PASSWORD';"
  mysql -e "ALTER USER '$DB_USER'@'localhost' IDENTIFIED BY '$DB_PASSWORD';"
  mysql -e "GRANT ALL PRIVILEGES ON \`$DB_NAME\`.* TO '$DB_USER'@'localhost'; FLUSH PRIVILEGES;"

  if [ -n "$DOMAIN" ]; then PUBLIC_URL="https://$DOMAIN"; else PUBLIC_URL="http://$(curl -s https://api.ipify.org || hostname -I | awk '{print $1}'):8081"; fi
  cat > "$APP_DIR/.env" <<ENV
PORT=$APP_PORT
HOST=127.0.0.1
PUBLIC_URL=$PUBLIC_URL
DB_HOST=localhost
DB_PORT=3306
DB_USER=$DB_USER
DB_PASSWORD=$DB_PASSWORD
DB_NAME=$DB_NAME
JWT_SECRET=$JWT_SECRET
ADMIN_EMAIL=$ADMIN_EMAIL
ADMIN_PASSWORD=$ADMIN_PASSWORD
ADMIN_EMAIL_2=$ADMIN_EMAIL_2
ADMIN_PASSWORD_2=$ADMIN_PASSWORD_2
COMPANY_NAME="Carneiro & Chiaradia"
CONTACT_NAME="Carneiro & Chiaradia"
CONTACT_EMAIL=$CONTACT_EMAIL
UPLOADS_DIR=/var/lib/carneiro/uploads
ENV
  chmod 600 "$APP_DIR/.env"
  chown "$APP_USER":"$APP_USER" "$APP_DIR/.env"
  echo
  echo "=============================================================="
  echo " Login do painel (anote agora, esta senha não aparece de novo):"
  echo "   login 1: $ADMIN_EMAIL  /  senha: $ADMIN_PASSWORD"
  [ -n "$ADMIN_EMAIL_2" ] && echo "   login 2: $ADMIN_EMAIL_2  /  senha: $ADMIN_PASSWORD_2"
  echo "=============================================================="
else
  echo ".env já existe, mantido."
fi

if [ -n "$DOMAIN" ]; then
  cat > /etc/nginx/sites-available/carneiro <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;
    client_max_body_size 25m;
    location / {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
NGINX
  ln -sf /etc/nginx/sites-available/carneiro /etc/nginx/sites-enabled/carneiro
  nginx -t && systemctl reload nginx
  apt-get install -y certbot python3-certbot-nginx
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$CONTACT_EMAIL" --redirect || \
    echo "certbot falhou: confirme que o DNS de $DOMAIN aponta para esta VPS e rode de novo."
else
  # Sem domínio: porta 8081 expõe só feed e fotos (site novo, não mexe nos existentes).
  cp "$(dirname "$0")/nginx-feed.conf" /etc/nginx/sites-available/carneiro-feed
  ln -sf /etc/nginx/sites-available/carneiro-feed /etc/nginx/sites-enabled/carneiro-feed
  nginx -t && systemctl reload nginx
  echo "Sem DOMAIN: feed e fotos em :8081; painel só por túnel. nginx dos outros sites não alterado. Acesse por túnel: ssh -L 3011:127.0.0.1:$APP_PORT root@IP"
fi

echo "Servidor preparado. Agora envie o código com deploy/deploy.sh (na sua máquina)."
