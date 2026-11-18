<#
.SYNOPSIS
  Paso 1 de la migración de Trek: empaqueta todo lo de Docker Desktop (Windows)
  para llevarlo a un servidor Ubuntu en la nube.

.DESCRIPTION
  Con Trek parado (para que la base de datos esté coherente) genera en -Destino:
    trek_data.tar.gz     volumen Docker "trek_data" (travel.db, logs, ...; sin backups)
    uploads.tar.gz       .\uploads (fotos, ficheros, portadas, avatares)
    backups.tar.gz       C:\003Trek\trek-main\data\backups
    certs.tar.gz         .\certs (fullchain.pem / privkey.pem)
    env.txt              tu .env (¡contiene secretos!)
    trek.bundle          el repositorio git completo (incluye commits locales sin subir)
    valhalla.tar         (solo con -IncluirValhalla) teselas ya construidas: ahorra 2-3 h
    SHA256SUMS           sumas de comprobación (las verifica el paso 2)

  Después, si se indica -Servidor, lo sube con scp (OpenSSH viene con Windows 10/11).

.EXAMPLE
  # Ensayo: exporta, sube y vuelve a arrancar Trek en Windows
  .\migracion\1-exportar-windows.ps1 -Servidor ubuntu@203.0.113.10

.EXAMPLE
  # Migración definitiva: Trek se queda PARADO en Windows (nada nuevo se pierde)
  .\migracion\1-exportar-windows.ps1 -Servidor ubuntu@203.0.113.10 -IncluirValhalla -DejarParado
#>
[CmdletBinding()]
param(
  [string]$Proyecto = 'C:\003Trek\trek-main',
  [string]$Destino  = 'C:\003Trek\migracion',
  [string]$Backups  = 'C:\003Trek\trek-main\data\backups',
  [string]$Servidor = '',                 # usuario@ip del Ubuntu (opcional)
  [string]$ClaveSsh = '',                 # ruta a la clave privada .pem / id_ed25519 (opcional)
  [string]$CarpetaRemota = 'trek-migracion',
  [switch]$IncluirValhalla,
  [switch]$DejarParado
)

$ErrorActionPreference = 'Stop'
function Paso($m) { Write-Host "`n==> $m" -ForegroundColor Cyan }
function Aviso($m) { Write-Host "AVISO: $m" -ForegroundColor Yellow }

# --- Comprobaciones -----------------------------------------------------------
foreach ($c in 'docker','tar') {
  if (-not (Get-Command $c -ErrorAction SilentlyContinue)) { throw "No encuentro '$c' en el PATH." }
}
docker info *> $null
if ($LASTEXITCODE -ne 0) { throw 'Docker Desktop no está arrancado.' }
if (-not (Test-Path "$Proyecto\docker-compose.yml")) { throw "No está docker-compose.yml en $Proyecto" }
docker volume inspect trek_data *> $null
if ($LASTEXITCODE -ne 0) { throw "No existe el volumen Docker 'trek_data'." }

New-Item -ItemType Directory -Force -Path $Destino | Out-Null
if (Get-ChildItem $Destino -File -ErrorAction SilentlyContinue) {
  Aviso "$Destino no está vacía; se sobrescriben los ficheros."
}
# Docker Desktop quiere la ruta con barras normales
$DestinoDocker = (Resolve-Path $Destino).Path -replace '\\','/'

Push-Location $Proyecto
try {
  # --- Parar Trek ---------------------------------------------------------------
  Paso 'Parando Trek (la base de datos SQLite tiene que estar cerrada para copiarla)'
  docker compose stop trek
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo parar trek.' }

  # --- Volumen trek_data ----------------------------------------------------------
  Paso 'Exportando el volumen trek_data'
  docker run --rm -v trek_data:/from:ro -v "${DestinoDocker}:/to" alpine `
    sh -c "cd /from && tar czf /to/trek_data.tar.gz --exclude=./backups ."
  if ($LASTEXITCODE -ne 0) { throw 'Falló la exportación del volumen.' }

  # --- uploads / certs / backups -----------------------------------------------
  # Se hacen también con un contenedor alpine: tar de Linux, sin problemas de rutas ni permisos.
  function Empaqueta($origen, $nombre) {
    if (-not (Test-Path $origen)) { Aviso "No existe $origen, se omite."; return }
    $o = (Resolve-Path $origen).Path -replace '\\','/'
    Paso "Empaquetando $origen -> $nombre"
    docker run --rm -v "${o}:/from:ro" -v "${DestinoDocker}:/to" alpine sh -c "cd /from && tar czf /to/$nombre ."
    if ($LASTEXITCODE -ne 0) { throw "Falló $nombre" }
  }
  Empaqueta "$Proyecto\uploads" 'uploads.tar.gz'
  Empaqueta "$Proyecto\certs"   'certs.tar.gz'
  Empaqueta $Backups            'backups.tar.gz'

  if ($IncluirValhalla) {
    if (Test-Path "$Proyecto\valhalla") {
      Paso 'Empaquetando Valhalla (sin el .pbf; puede tardar unos minutos y ocupar varios GB)'
      docker compose stop valhalla
      $v = "$Proyecto\valhalla" -replace '\\','/'
      docker run --rm -v "${v}:/from:ro" -v "${DestinoDocker}:/to" alpine `
        sh -c "cd /from && tar cf /to/valhalla.tar --exclude='*.pbf' ."
      if ($LASTEXITCODE -ne 0) { throw 'Falló valhalla.tar' }
    } else { Aviso 'No hay carpeta valhalla; se omite.' }
  }

  # --- .env -----------------------------------------------------------------------
  if (Test-Path "$Proyecto\.env") {
    Paso 'Copiando .env (contiene secretos: no lo dejes por ahí)'
    Copy-Item "$Proyecto\.env" "$Destino\env.txt" -Force
  } else { Aviso 'No hay .env en el proyecto.' }

  # --- Código (git bundle) -------------------------------------------------------
  if (Get-Command git -ErrorAction SilentlyContinue) {
    Paso 'Creando trek.bundle (repositorio git completo)'
    $pendientes = git status --porcelain
    if ($pendientes) { Aviso "Hay cambios sin commit en $Proyecto; NO van en el bundle:`n$pendientes" }
    git bundle create "$Destino\trek.bundle" --all
    if ($LASTEXITCODE -ne 0) { throw 'Falló git bundle' }
    git rev-parse --abbrev-ref HEAD | Out-File -Encoding ascii "$Destino\RAMA.txt"
  } else { Aviso 'git no está instalado: el servidor clonará desde GitHub.' }
}
finally {
  if (-not $DejarParado) {
    Paso 'Volviendo a arrancar Trek en Windows'
    docker compose up -d trek
    if ($IncluirValhalla) { docker compose up -d valhalla }
  } else {
    Aviso 'Trek se queda PARADO en Windows (migración definitiva). Para volver atrás: docker compose up -d'
  }
  Pop-Location
}

# --- Sumas de comprobación ------------------------------------------------------
Paso 'Calculando SHA256SUMS'
$lineas = Get-ChildItem $Destino -File | Where-Object Name -ne 'SHA256SUMS' | ForEach-Object {
  '{0}  {1}' -f (Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLower(), $_.Name
}
# Fin de línea LF y sin BOM, para sha256sum de Linux
[IO.File]::WriteAllText("$Destino\SHA256SUMS", (($lineas -join "`n") + "`n"))
Get-ChildItem $Destino -File | Format-Table Name, @{n='MB';e={[math]::Round($_.Length/1MB,1)}} -AutoSize

# --- Subida ---------------------------------------------------------------------
$opts = @()
if ($ClaveSsh) { $opts += @('-i', $ClaveSsh) }
if ($Servidor) {
  Paso "Subiendo a ${Servidor}:~/$CarpetaRemota (también copio los scripts de migración)"
  ssh @opts $Servidor "mkdir -p ~/$CarpetaRemota"
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo conectar por ssh.' }
  scp @opts "$Destino\*" "$PSScriptRoot\2-instalar-ubuntu.sh" "$PSScriptRoot\3-certificados-ubuntu.sh" "${Servidor}:~/$CarpetaRemota/"
  if ($LASTEXITCODE -ne 0) { throw 'Falló scp.' }
  Write-Host "`nListo. Ahora en el servidor:" -ForegroundColor Green
  Write-Host "  ssh $Servidor"
  Write-Host "  sudo bash ~/$CarpetaRemota/2-instalar-ubuntu.sh --paquete ~/$CarpetaRemota"
} else {
  Write-Host "`nListo. Sube la carpeta al servidor, por ejemplo:" -ForegroundColor Green
  Write-Host "  scp $Destino\* $PSScriptRoot\2-instalar-ubuntu.sh $PSScriptRoot\3-certificados-ubuntu.sh usuario@servidor:~/$CarpetaRemota/"
}
