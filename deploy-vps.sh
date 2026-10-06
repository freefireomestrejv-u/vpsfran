#!/bin/bash
# =============================================================================
# RenewHub — deploy na VPS (Ubuntu). Rode como root, uma vez.
# Pré-requisitos: DNS apontando wa.reneewveins.com para esta VPS.
# =============================================================================
set -e

echo "[1/5] Sistema + Docker..."
apt-get update -y
apt-get install -y git ufw openssl
if ! command -v docker &> /dev/null; then
  curl -fsSL https://get.docker.com | sh
fi
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo "[2/5] Código..."
if [ ! -d /opt/renewhub ]; then
  git clone -b feat/tema-logo-menu https://github.com/freefireomestrejv-u/vpsfran.git /opt/renewhub
else
  echo "Pasta existe — atualizando código..."
  git -C /opt/renewhub pull --ff-only || echo "AVISO: git pull falhou, seguindo com o código atual."
fi
cd /opt/renewhub

echo "[3/5] Segredos do .env..."
if [ ! -f .env ]; then
  cp vps-env.example .env
  # Gera AUTH_SECRET e senhas fortes onde estiver placeholder
  SECRET=$(openssl rand -base64 32)
  DBPASS=$(openssl rand -hex 16)
  sed -i "s|GERAR_NO_SERVIDOR_COM_openssl_rand_-base64_32|$SECRET|" .env
  sed -i "s|TROCAR_POR_SENHA_FORTE|$DBPASS|g" .env
  echo "ATUALIZE no .env: ADMIN_EMAIL, ADMIN_PASSWORD e NEXT_PUBLIC_SWAGGER_PASSWORD"
  echo "Depois rode este script de novo (ele pula o que já existe)."
  nano .env
fi

echo "[4/5] Build + subida..."
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build

echo "[5/5] Status..."
sleep 5
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps
echo ""
echo "Aguarde o HTTPS (1-2 min) e abra https://wa.reneewveins.com"
echo "Logs do app: docker logs -f wa-akg-app"
