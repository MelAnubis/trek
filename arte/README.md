# Mapas ilustrados (Arte)

Convierte una ruta GPX real en un mapa ilustrado de tinta y acuarela, con el monumento
característico de cada población. Era una app independiente (`estodobajada-arte`, contenedor
nginx en el puerto 8088); ahora es un módulo de Trek.

## Cómo encaja en Trek

- `arte/app/` es la app tal cual: HTML + módulos JS, sin compilación ni dependencias. El
  Dockerfile la copia a `/app/arte` y el servidor la sirve bajo `/api/arte/`
  (`server/src/routes/arte.ts`), siempre con sesión y con el permiso `arte_use`.
- La página `/arte` de Trek (`client/src/pages/ArtePage.tsx`) la muestra en un iframe del mismo
  origen y le pasa los colores del tema activo. El render y la validación de integridad del GPX
  no se han tocado.
- Lo que hacía su nginx lo hace el servidor (`server/src/services/arteService.ts`): caché de
  Overpass (30 días) y de teselas de elevación (90 días) en `data/arte/`, peticiones de dibujo y
  sincronización del catálogo y las ilustraciones.
- `server/src/services/arteTrekService.ts`: rutas del usuario como GPX y composiciones guardadas
  (tabla `arte_compositions`).

## Quién lo ve

Admin → Permisos → **Mapas ilustrados → Usar los mapas ilustrados**: «Solo administrador» (por
defecto) o «Todos».

## Ilustraciones y catálogo

Siguen viviendo en el repositorio de ilustraciones (`app/data`: catálogo, dibujos vectoriales y
PNG), donde trabajan el flujo de GitHub Actions y la tarea nocturna. Trek trae los cambios cada
10 minutos si tiene `ARTE_SYNC_TOKEN`; sin él usa la copia incluida en `arte/app/data`.

| Variable | Para qué |
|---|---|
| `ARTE_SYNC_TOKEN` | Token de GitHub con «Contents: Read-only» del repositorio de ilustraciones. Activa la sincronización. |
| `ARTE_PETICION_TOKEN` | Token con «Issues: Read and write». Permite pedir dibujos sin salir de la app; sin él, el botón abre GitHub. |
| `ARTE_REPO` | Repositorio de ilustraciones (por defecto `MelAnubis/estodobajada-arte`). |
| `ARTE_SYNC_MINUTES` | Cada cuántos minutos sincroniza (por defecto 10). |

Los dibujos vectoriales (`app/data/dibujos/*.js`) son código que se ejecuta en el navegador
dentro de Trek: el repositorio de ilustraciones debe seguir siendo de confianza.

## Reglas que no cambian

- El GPX no se modifica nunca (ni simplificar, ni suavizar, ni unir segmentos).
- No se inventa patrimonio: si OSM no lo registra, no se dibuja.
- `npm test` (en esta carpeta) debe pasar entero. Versión: `app/js/version.js`, `package.json`
  y `CHANGELOG.md` siempre iguales.
