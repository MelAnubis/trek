#!/usr/bin/env bash
# =============================================================================
#  Paso 3 (opcional) de la migración de Trek: certificados Let's Encrypt propios
#  del servidor Ubuntu, con renovación automática.
#
#  Lánzalo SOLO cuando el DNS de todos los dominios apunte ya a este servidor.
#  Hasta entonces nginx sigue con los certificados copiados desde Windows.
#
#  Uso: sudo bash 3-certificados-ubuntu.sh --email tu@correo [--dir /opt/trek]
#            [--dominios "trekwanderer.info www.trekwanderer.info ..."] [--prueba]
#
#  Usa certbot en modo "standalone": para unos segundos el contenedor nginx
#  (libera el puerto 80), obtiene/renueva el certificado, lo copia a $DIR/certs
#  y vuelve a arrancar nginx. La renovación la hace el timer de certbot.
# =============================================================================
set -euo pipefail

DIR=/opt/trek
EMAIL=""
DOMINIOS="trekwanderer.info www.trekwanderer.info go.trekwanderer.info rodadas.info www.rodadas.info estodobajada.com www.estodobajada.com"
PRUEBA=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --email)    EMAIL="$2"; shift 2 ;;
    --dir)      DIR="$2"; shift 2 ;;
    --dominios) DOMINIOS="$2"; shift 2 ;;
    --prueba)   PRUEBA="--staging"; shift ;;
    -h|--help)  sed -n '2,15p' "$0"; exit 0 ;;
    *) echo "Opción desconocida: $1" >&2; exit 1 ;;
  esac
done

[[ $EUID -eq 0 ]] || { echo "Ejecútalo con sudo." >&2; exit 1; }
[[ -n "$EMAIL" ]] || { echo "Falta --email" >&2; exit 1; }
[[ -f "$DIR/docker-compose.yml" ]] || { echo "No está Trek en $DIR" >&2; exit 1; }

echo "==> Comprobando que el DNS apunta a este servidor"
MI_IP=$(curl -fsS4 --max-time 5 https://api.ipify.org)
FALLAN=0
for d in $DOMINIOS; do
  ip=$(getent ahostsv4 "$d" | awk 'NR==1{print $1}')
  if [[ "$ip" == "$MI_IP" ]]; then echo "  ok  $d -> $ip"
  else echo "  MAL $d -> ${ip:-sin resolver} (debería ser $MI_IP)"; FALLAN=1; fi
done
[[ $FALLAN -eq 0 ]] || { echo "Arregla el DNS (o quita esos dominios con --dominios) y vuelve a lanzarlo." >&2; exit 1; }

command -v certbot >/dev/null || { apt-get update -y && apt-get install -y certbot; }

# Hooks permanentes: también se usan en cada renovación automática
install -d /etc/letsencrypt/renewal-hooks/{pre,post,deploy}
cat > /etc/letsencrypt/renewal-hooks/pre/trek-nginx-stop.sh <<EOF
#!/bin/sh
docker stop trek_nginx >/dev/null 2>&1 || true
EOF
cat > /etc/letsencrypt/renewal-hooks/deploy/trek-copiar-certs.sh <<EOF
#!/bin/sh
# Copia el certificado nuevo a donde lo lee el contenedor nginx de Trek
set -e
cp -L "\$RENEWED_LINEAGE/fullchain.pem" "$DIR/certs/fullchain.pem"
cp -L "\$RENEWED_LINEAGE/privkey.pem"   "$DIR/certs/privkey.pem"
chmod 600 "$DIR/certs/privkey.pem"
EOF
cat > /etc/letsencrypt/renewal-hooks/post/trek-nginx-start.sh <<EOF
#!/bin/sh
cd "$DIR" && docker compose up -d nginx >/dev/null 2>&1 || docker start trek_nginx
EOF
chmod +x /etc/letsencrypt/renewal-hooks/*/trek-*.sh

ARGS=()
for d in $DOMINIOS; do ARGS+=(-d "$d"); done

echo "==> Pidiendo el certificado (nginx se para unos segundos)"
mkdir -p "$DIR/certs"
cp -a "$DIR/certs" "$DIR/certs.windows.$(date +%Y%m%d)" 2>/dev/null || true
certbot certonly --standalone --non-interactive --agree-tos -m "$EMAIL" \
  --cert-name trek --expand $PRUEBA "${ARGS[@]}"
# certonly solo lanza el deploy-hook si emite uno nuevo: copia siempre por si acaso
RENEWED_LINEAGE=/etc/letsencrypt/live/trek sh /etc/letsencrypt/renewal-hooks/deploy/trek-copiar-certs.sh
cd "$DIR" && docker compose up -d nginx

echo "==> Probando la renovación automática (simulada)"
certbot renew --dry-run --cert-name trek
systemctl list-timers 'certbot*' --no-pager || true
echo "Listo: certificados en $DIR/certs, renovación automática activa."
