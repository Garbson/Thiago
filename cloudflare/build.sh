#!/usr/bin/env bash
# Copia o site estático para cloudflare/public (as funções em functions/ fazem o proxy da API).
set -euo pipefail
cd "$(dirname "$0")"
rm -rf public && mkdir -p public
cp ../index.html ../admin.html public/
cp -R ../assets public/assets
echo "ok: $(find public -type f | wc -l) arquivos em cloudflare/public"
