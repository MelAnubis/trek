#!/usr/bin/env bash
# =============================================================================
#  Paso 2 de la migración de Trek: instala y restaura Trek en Ubuntu (nube)
#  a partir del paquete que generó 1-exportar-windows.ps1.
#
#  Uso:  sudo bash 2-instalar-ubuntu.sh --paquete ~/trek-migracion [opciones]
#
#  Opciones:
#    --paquete DIR        carpeta con trek_data.tar.gz, uploads.tar.gz, ... (por defecto: la del script)
#    --dir DIR            dónde instalar Trek (por defecto /opt/trek)
#    --repo URL           repo git si no hay trek.bundle (por defecto https://github.com/MelAnubis/trek.git)
#    --rama NOMBRE        rama a usar (por defecto la de RAMA.txt, o main)
#    --puertos-446        mantener los puertos de Windows 840/446 (por defecto 80/443 estándar)
#    --sin-valhalla       no arrancar el Valhalla propio (Trek usa el público). Útil con < 8 GB de RAM
#    --sin-firewall       no tocar ufw
#    --forzar             sobrescribir el volumen trek_data si ya tiene datos
#    -h | --help
#
#  Es seguro relanzarlo: lo que ya está hecho se salta.
# =============================================================================
set -euo pipefail

PAQUETE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIR=/opt/trek
REPO=https://github.com/MelAnubis/trek.git
RAMA=""
PUERTOS_ESTANDAR=1
VALHALLA=1
FIREWALL=1
FORZAR=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --paquete)      PAQUETE="$(realpath "$2")"; shift 2 ;;
    --dir)          DIR="$2"; shift 2 ;;
    --repo)         REPO="$2"; shift 2 ;;
    --rama)         RAMA="$2"; shift 2 ;;
    --puertos-446)  PUERTOS_ESTANDAR=0; shift ;;
    --sin-valhalla) VALHALLA=0; shift ;;
    --sin-firewall) FIREWALL=0; shift ;;
    --forzar)       FORZAR=1; shift ;;
    -h|--help)      sed -n '2,21p' "$0"; exit 0 ;;
    *) echo "Opción desconocida: $1" >&2; exit 1 ;;
  esac
done

paso()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
aviso() { printf '\033[1;33mAVISO: %s\033[0m\n' "$*"; }
error() { printf '\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || error "Ejecútalo con sudo."
grep -qi ubuntu /etc/os-release || aviso "Esto no parece Ubuntu; sigo, pero no está probado."
[[ -f "$PAQUETE/trek_data.tar.gz" ]] || error "No encuentro $PAQUETE/trek_data.tar.gz"

# --- 0. Integridad del paquete ---------------------------------------------------
paso "Verificando sumas SHA256 del paquete"
if [[ -f "$PAQUETE/SHA256SUMS" ]]; then
  (cd "$PAQUETE" && sha256sum -c SHA256SUMS) || error "El paquete está dañado: vuelve a copiarlo."
else
  aviso "No hay SHA256SUMS; no puedo verificar el paquete."
fi

# --- 1. Recursos ----------------------------------------------------------------
RAM_MB=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
SWAP_MB=$(awk '/SwapTotal/ {print int($2/1024)}' /proc/meminfo)
DISCO_GB=$(df -BG --output=avail / | tail -1 | tr -dc 0-9)
echo "RAM: ${RAM_MB} MB · swap: ${SWAP_MB} MB · disco libre: ${DISCO_GB} GB"
if [[ $VALHALLA -eq 1 && $RAM_MB -lt 7500 ]]; then
  aviso "Valhalla tiene un tope de 6 GB de RAM y el servidor tiene ${RAM_MB} MB."
  aviso "Si va justo, relanza con --sin-valhalla (Trek usará el Valhalla público)."
fi
if [[ $RAM_MB -lt 4000 && $SWAP_MB -lt 1000 && ! -f /swapfile ]]; then
  paso "Poca RAM: creando 2 GB de swap (/swapfile) para poder compilar la imagen"
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
[[ ${DISCO_GB:-0} -ge 15 ]] || aviso "Menos de 15 GB libres; con Valhalla harán falta ~10 GB más."

# --- 2. Docker Engine + compose (repositorio oficial) ---------------------------
if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
  paso "Instalando Docker Engine y el plugin compose"
  apt-get update -y
  apt-get install -y ca-certificates curl gnupg git
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${UBUNTU_CODENAME:-$VERSION_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
else
  paso "Docker ya está instalado: $(docker --version)"
fi
command -v git >/dev/null || apt-get install -y git
# Que el usuario que lanzó sudo pueda usar docker sin sudo (tras volver a entrar)
if [[ -n "${SUDO_USER:-}" && "$SUDO_USER" != root ]]; then usermod -aG docker "$SUDO_USER" || true; fi

# --- 3. Código ------------------------------------------------------------------
[[ -n "$RAMA" ]] || RAMA="$(tr -d '\r\n ' < "$PAQUETE/RAMA.txt" 2>/dev/null || true)"
[[ -n "$RAMA" && "$RAMA" != HEAD ]] || RAMA=main
if [[ -d "$DIR/.git" ]]; then
  paso "El código ya está en $DIR (no lo toco)"
else
  [[ ! -e "$DIR" || -z "$(ls -A "$DIR" 2>/dev/null)" ]] || error "$DIR existe y no es un repo git."
  if [[ -f "$PAQUETE/trek.bundle" ]]; then
    paso "Clonando el código desde trek.bundle (rama $RAMA)"
    git clone --branch "$RAMA" "$PAQUETE/trek.bundle" "$DIR"
    git -C "$DIR" remote set-url origin "$REPO"
  else
    paso "Clonando $REPO (rama $RAMA)"
    git clone --branch "$RAMA" "$REPO" "$DIR"
  fi
fi
cd "$DIR"

# --- 4. .env --------------------------------------------------------------------
# set_env CLAVE VALOR: añade o reemplaza la línea en .env
set_env() {
  local k="$1" v="$2"
  if grep -qE "^${k}=" .env; then
    local esc; esc=$(printf '%s' "$v" | sed 's/[&|\\]/\\&/g')
    sed -i "s|^${k}=.*|${k}=${esc}|" .env
  else
    printf '%s=%s\n' "$k" "$v" >> .env
  fi
}
if [[ -f .env ]]; then
  paso ".env ya existe en $DIR: lo conservo (copia del paquete en .env.windows)"
  [[ -f "$PAQUETE/env.txt" ]] && cp "$PAQUETE/env.txt" .env.windows
else
  [[ -f "$PAQUETE/env.txt" ]] || error "No hay env.txt en el paquete (tu .env con ENCRYPTION_KEY, claves, ...)."
  paso "Instalando .env (convertido a finales de línea Linux)"
  sed 's/\r$//' "$PAQUETE/env.txt" > .env
fi
chmod 600 .env
grep -qE '^ENCRYPTION_KEY=.+' .env || aviso "ENCRYPTION_KEY vacía en .env: si en Windows la tenías, ¡cópiala o no podrás descifrar los datos!"

paso "Ajustando .env para Linux"
set_env TREK_BACKUPS_DIR ./data/backups
if [[ $PUERTOS_ESTANDAR -eq 1 ]]; then
  set_env TREK_HTTP_PORT 80
  set_env TREK_HTTPS_PORT 443
  set_env TREK_APP_URL https://www.trekwanderer.info
  set_env TREK_ALLOWED_ORIGINS "https://trekwanderer.info,https://go.trekwanderer.info,https://www.trekwanderer.info,https://rodadas.info,https://www.rodadas.info,https://estodobajada.com,https://www.estodobajada.com,https://localhost"
  # La redirección OAuth de OneDrive también llevaba :446
  if grep -qE '^ONEDRIVE_REDIRECT_URI=.*:446' .env; then
    sed -i -E '/^ONEDRIVE_REDIRECT_URI=/ s/:446//' .env
    aviso "Quité :446 de ONEDRIVE_REDIRECT_URI: actualiza también la URI de redirección en el portal de Azure."
  fi
  if grep -qE '^[^#].*:446' .env; then
    aviso "Quedan variables con :446 en .env (revísalas):"; grep -E '^[^#].*:446' .env | cut -d= -f1
  fi
else
  set_env TREK_HTTP_PORT 840
  set_env TREK_HTTPS_PORT 446
fi

# --- 5. Datos ---------------------------------------------------------------------
desempaqueta() {  # fichero.tar.gz carpeta-destino
  local f="$PAQUETE/$1" d="$2"
  if [[ ! -f "$f" ]]; then aviso "No hay $1 en el paquete; se omite."; return; fi
  mkdir -p "$d"
  if [[ -n "$(ls -A "$d" 2>/dev/null)" && $FORZAR -eq 0 ]]; then
    aviso "$d ya tiene contenido: no lo sobrescribo (usa --forzar)."; return
  fi
  paso "Restaurando $1 -> $d"
  tar xzf "$f" -C "$d"
}
desempaqueta uploads.tar.gz ./uploads
desempaqueta backups.tar.gz ./data/backups
desempaqueta certs.tar.gz   ./certs
[[ -f certs/fullchain.pem && -f certs/privkey.pem ]] || \
  aviso "Faltan certs/fullchain.pem o certs/privkey.pem: nginx no arrancará. Usa 3-certificados-ubuntu.sh."
chmod 700 certs 2>/dev/null || true

paso "Restaurando el volumen Docker trek_data (base de datos)"
docker compose stop trek >/dev/null 2>&1 || true
docker volume inspect trek_data >/dev/null 2>&1 || docker volume create trek_data >/dev/null
OCUPADO=$(docker run --rm -v trek_data:/v alpine sh -c 'ls -A /v | grep -v "^backups$" | head -1')
if [[ -n "$OCUPADO" && $FORZAR -eq 0 ]]; then
  aviso "trek_data ya tiene datos: no lo toco (usa --forzar para reemplazarlo con el del paquete)."
else
  docker run --rm -v trek_data:/to -v "$PAQUETE:/from:ro" alpine \
    sh -c 'find /to -mindepth 1 -delete && tar xzf /from/trek_data.tar.gz -C /to && ls -la /to'
  docker run --rm -v trek_data:/v alpine test -f /v/travel.db || error "En el volumen no hay travel.db: algo falló en la exportación."
fi

if [[ $VALHALLA -eq 1 && -f "$PAQUETE/valhalla.tar" ]]; then
  if [[ -n "$(ls -A valhalla 2>/dev/null)" && $FORZAR -eq 0 ]]; then
    aviso "./valhalla ya tiene contenido: no lo sobrescribo."
  else
    paso "Restaurando teselas de Valhalla (evita reconstruir 2-3 h)"
    mkdir -p valhalla && tar xf "$PAQUETE/valhalla.tar" -C valhalla
  fi
fi

# --- 6. Cortafuegos -------------------------------------------------------------
if [[ $FIREWALL -eq 1 ]] && command -v ufw >/dev/null; then
  paso "Configurando ufw"
  ufw allow OpenSSH >/dev/null
  if [[ $PUERTOS_ESTANDAR -eq 1 ]]; then ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null
  else ufw allow 840/tcp >/dev/null; ufw allow 446/tcp >/dev/null; fi
  ufw --force enable >/dev/null
  ufw status
  aviso "Abre también esos puertos en el firewall/grupo de seguridad del proveedor de nube."
fi

# --- 7. Construir y arrancar ----------------------------------------------------
paso "Construyendo la imagen de Trek (unos minutos la primera vez)"
docker compose build trek

SERVICIOS=(trek nginx)
[[ $VALHALLA -eq 1 ]] && SERVICIOS+=(valhalla)
paso "Arrancando: ${SERVICIOS[*]}"
docker compose up -d "${SERVICIOS[@]}"

paso "Esperando a que Trek esté sano"
for _ in $(seq 1 40); do
  estado=$(docker inspect -f '{{.State.Health.Status}}' trek_app 2>/dev/null || echo "?")
  [[ "$estado" == healthy ]] && break
  sleep 5
done
if [[ "$estado" != healthy ]]; then
  docker compose logs --tail 80 trek
  error "Trek no está sano (estado: $estado). Revisa los logs de arriba."
fi
docker compose ps

# --- 8. Mantenimiento ------------------------------------------------------------
cat > /etc/cron.d/trek-limpieza-docker <<EOF
# Limpia imágenes viejas de Trek tras las actualizaciones (domingos 04:30)
30 4 * * 0 root docker image prune -f >/dev/null 2>&1
EOF

IP=$(curl -fsS4 --max-time 5 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')
cat <<EOF

$(printf '\033[1;32m')Trek está funcionando en el servidor.$(printf '\033[0m')

  Código y datos:   $DIR   (BD en el volumen docker trek_data, backups en $DIR/data/backups)
  IP pública:       $IP

Siguientes pasos:
  1. Prueba sin tocar DNS (en tu PC añade al fichero hosts: "$IP www.trekwanderer.info")
     y entra en https://www.trekwanderer.info$([[ $PUERTOS_ESTANDAR -eq 1 ]] || echo ':446')
  2. Cambia los registros DNS (A) de trekwanderer.info, www, go, rodadas.info, www,
     estodobajada.com, www  ->  $IP
  3. Cuando el DNS apunte aquí: sudo bash $PAQUETE/3-certificados-ubuntu.sh --email tu@correo
     (certificados Let's Encrypt propios del servidor, con renovación automática)
  4. Revisa: URI de OneDrive en Azure, BIKEPACK_URL, la app Android (si apunta a :446).
  5. Borra el paquete cuando todo funcione (contiene secretos): rm -rf $PAQUETE

Actualizar en el futuro:
  cd $DIR && git pull && docker compose up -d --build trek
EOF
