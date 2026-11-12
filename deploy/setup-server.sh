#!/usr/bin/env bash
# Prepara a VPS (Debian/Ubuntu) para rodar o site + API. Execute NA VPS, como root:
#   ADMIN_EMAIL=voce@email.com DOMAIN=seudominio.com.br bash setup-server.sh
# DOMAIN é opcional; sem ele o site responde pelo IP, sem HTTPS.
set -euo pipefail

APP_DIR=/opt/carneiro
APP_USER=carneiro
DB_NAME=chiaradia_carneiro
DB_USER=carneiro
: "${ADMIN_EMAIL:?Defina ADMIN_EMAIL (e-mail de login do painel e contato dos portais)}"
DOMAIN="${DOMAIN:-}"

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl ca-certificates gnupg nginx mariadb-server openssl rsync

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

  mysql -e "CREATE DATABASE IF NOT EXISTS \`$DB_NAME\` CHARACTER SET utf8mb4;"
  mysql -e "CREATE USER IF NOT EXISTS '$DB_USER'@'localhost' IDENTIFIED BY '$DB_PASSWORD';"
  mysql -e "ALTER USER '$DB_USER'@'localhost' IDENTIFIED BY '$DB_PASSWORD';"
  mysql -e "GRANT ALL PRIVILEGES ON \`$DB_NAME\`.* TO '$DB_USER'@'localhost'; FLUSH PRIVILEGES;"

  if [ -n "$DOMAIN" ]; then PUBLIC_URL="https://$DOMAIN"; else PUBLIC_URL="http://$(curl -s https://api.ipify.org || hostname -I | awk '{print $1}')"; fi
  cat > "$APP_DIR/.env" <<ENV
PORT=3001
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
COMPANY_NAME=Carneiro & Chiaradia
CONTACT_NAME=Carneiro & Chiaradia
CONTACT_EMAIL=$ADMIN_EMAIL
UPLOADS_DIR=/var/lib/carneiro/uploads
ENV
  chmod 600 "$APP_DIR/.env"
  chown "$APP_USER":"$APP_USER" "$APP_DIR/.env"
  echo
  echo "=============================================================="
  echo " Login do painel (anote agora, esta senha não aparece de novo):"
  echo "   e-mail: $ADMIN_EMAIL"
  echo "   senha : $ADMIN_PASSWORD"
  echo "=============================================================="
else
  echo ".env já existe, mantido."
fi

cat > /etc/nginx/sites-available/carneiro <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN:-_};
    client_max_body_size 25m;
    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
NGINX
ln -sf /etc/nginx/sites-available/carneiro /etc/nginx/sites-enabled/carneiro
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

if [ -n "$DOMAIN" ]; then
  apt-get install -y certbot python3-certbot-nginx
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$ADMIN_EMAIL" --redirect || \
    echo "certbot falhou: confirme que o DNS de $DOMAIN aponta para esta VPS e rode de novo."
fi

echo "Servidor preparado. Agora envie o código com deploy/deploy.sh (na sua máquina)."
