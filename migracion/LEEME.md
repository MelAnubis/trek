# Migrar Trek de Docker Desktop (Windows) a Docker en Ubuntu (nube)

Tres scripts:

| Paso | Dónde | Script | Qué hace |
|---|---|---|---|
| 1 | Windows (PowerShell) | `1-exportar-windows.ps1` | Para Trek, empaqueta BD (volumen `trek_data`), `uploads`, `certs`, backups, `.env`, el repo git (bundle) y opcionalmente Valhalla; calcula SHA256 y lo sube por `scp`. |
| 2 | Ubuntu (sudo) | `2-instalar-ubuntu.sh` | Instala Docker, restaura todo en `/opt/trek`, adapta `.env` a Linux (puertos 80/443, rutas), abre el firewall, construye y arranca. |
| 3 | Ubuntu (sudo) | `3-certificados-ubuntu.sh` | Cuando el DNS ya apunta al servidor: certificados Let's Encrypt propios con renovación automática. |

## Requisitos del servidor

- Ubuntu 22.04 / 24.04, acceso SSH con usuario con `sudo`.
- **Con Valhalla propio:** ≥ 8 GB RAM y ~25 GB de disco. **Sin Valhalla** (`--sin-valhalla`, Trek usa el público): 2–4 GB RAM bastan.
- Puertos 22, 80 y 443 abiertos en el firewall del proveedor (grupo de seguridad).

## 1. Ensayo (Trek sigue funcionando en Windows)

En PowerShell, en `C:\003Trek\trek-main` (con el código ya actualizado: `git pull`):

```powershell
powershell -ExecutionPolicy Bypass -File .\migracion\1-exportar-windows.ps1 -Servidor ubuntu@IP_DEL_SERVIDOR -IncluirValhalla
```

(`-ClaveSsh C:\ruta\clave.pem` si el proveedor te dio una clave.) Trek se para un momento y vuelve a arrancar.

En el servidor:

```bash
sudo bash ~/trek-migracion/2-instalar-ubuntu.sh --paquete ~/trek-migracion
```

Pruébalo sin tocar el DNS añadiendo en `C:\Windows\System32\drivers\etc\hosts` la línea `IP_DEL_SERVIDOR www.trekwanderer.info` (el certificado de Windows sigue valiendo). Quítala al acabar.

## 2. Migración definitiva

Para no perder nada de lo que se haga entre el ensayo y el cambio de DNS:

```powershell
.\migracion\1-exportar-windows.ps1 -Servidor ubuntu@IP_DEL_SERVIDOR -DejarParado
```

`-DejarParado` deja Trek parado en Windows. En el servidor, `--forzar` reemplaza los datos del ensayo:

```bash
sudo bash ~/trek-migracion/2-instalar-ubuntu.sh --paquete ~/trek-migracion --forzar
```

Después cambia los registros DNS **A** (trekwanderer.info, www, go, rodadas.info, www, estodobajada.com, www) a la IP del servidor y, cuando resuelvan:

```bash
sudo bash ~/trek-migracion/3-certificados-ubuntu.sh --email tu@correo
```

Por último borra `~/trek-migracion` y `C:\003Trek\migracion` (contienen el `.env` con secretos).

## Qué cambia respecto a Windows

- **Puertos:** 80/443 en lugar de 840/446 → las URL ya no llevan `:446`. Se controla con `TREK_HTTP_PORT`, `TREK_HTTPS_PORT`, `TREK_APP_URL` y `TREK_ALLOWED_ORIGINS` en `.env` (el script las pone). Para mantener 840/446 usa `--puertos-446`.
- **Backups:** en `/opt/trek/data/backups` (`TREK_BACKUPS_DIR`). Cópialos fuera del servidor de vez en cuando.
- **A revisar a mano:** URI de redirección de OneDrive en el portal de Azure, `BIKEPACK_URL` si apuntaba a esta máquina, y la app Android si tenía la URL con `:446`.
- Sin esas variables, `docker-compose.yml` funciona exactamente igual que antes en Windows.

## Actualizar en la nube

```bash
cd /opt/trek && git pull && docker compose up -d --build trek
```

## Volver atrás

En Windows: `docker compose up -d` y devolver el DNS a la IP de casa.
