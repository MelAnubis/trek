# Cambios

Formato: [versiones semánticas](https://semver.org/lang/es/). La versión visible en la app sale de `app/js/version.js`.


## [1.9.0] — 2026-11-25

### Estilos contemporáneos
- Cuatro estilos nuevos, agrupados en el selector como «Contemporáneos» (los de siempre quedan como «Clásicos»):
  - **Minimalista**: fondo limpio, dibujos de línea fina en grises, la ruta como único color y rótulos en mayúsculas espaciadas.
  - **Plano contemporáneo**: ilustración plana en colores sólidos (terracota, arena, salvia y azul profundo), sin texturas.
  - **Nocturno**: fondo azul noche, dibujos de línea clara y la ruta luminosa.
  - **Risografía**: tintas planas (rosa flúor, azul, amarillo y verde) con grano y un leve desajuste de registro.
- Sin papel envejecido, manchas ni filtros de pintura: el SVG sale más nítido y ligero. Marco de una línea, flecha de norte en lugar de rosa de los vientos y cimas como triángulos.
- Todos los dibujos de monumentos (propios y genéricos) se pasan solos a la paleta de cada estilo, sin rehacer ninguno. Las acuarelas PNG también: grafito en Minimalista, degradado de la paleta en Plano, grabado claro en Nocturno y duotono azul en Risografía.
- Cada estilo trae sus colores de etapa y propone su tipografía y su color de ruta al elegirlo; luego se pueden cambiar. Al volver a un estilo clásico vuelven las letras de siempre.
- Tipografías nuevas (licencia SIL OFL): Space Grotesk, Syne y DM Serif Display para títulos; Inter e IBM Plex Mono para rótulos y textos.
- Colores de ruta nuevos: coral, azul marino, azul eléctrico, rosa flúor y ámbar luminoso.

### Arreglos
- Guía ilustrada: un título largo ya no se monta sobre la descripción, y la línea de datos baja si la descripción ocupa más. Los textos del panel lateral, los perfiles de etapa y los números de los puntos de interés tienen en cuenta el ancho real de la letra elegida.
- Las acuarelas PNG dejaban un recuadro claro sobre el papel en los estilos clásicos: ahora el fondo de la ilustración se vuelve transparente.

## [1.8.1] — 2026-11-18

### Mis rutas de Trek
- El selector agrupa las rutas por viaje (o por mes), en grupos plegables con el número de rutas, los km y las fechas de cada uno; las del planificador, aparte. Dentro de un viaje, las etapas van en orden (001, 002… 010).
- Filtro por tipo (tracks, planificador, excursiones) y «Desplegar/Plegar todos». Al buscar, se abren los grupos que coinciden. Tipo y agrupación se recuerdan.
- Si todas las rutas de un grupo empiezan igual, se ve solo lo que las distingue («… 002Quintanar») y el principio común una vez arriba.
- Las distancias de tracks y excursiones salían 1000 veces más cortas («0,1 km»): ya iban en km y se dividían otra vez.

## [1.8.0] — 2026-11-16

### Dentro de Trek
- La app deja de ser un contenedor aparte: es el módulo «Mapas ilustrados» de Trek (`/arte`), con su sesión y su permiso (Admin → Permisos). Lo que hacía su nginx (caché de Overpass, teselas de elevación, peticiones de dibujo, sincronización de `app/data`) lo hace el servidor de Trek.
- Aspecto de Trek, claro y oscuro; en móvil, una vista cada vez (Ajustes / Mapa).
- «Elegir una de mis rutas de Trek»: rutas del planificador, tracks y excursiones de los viajes, con sus puntos literales.
- Las composiciones se guardan en el servidor, por usuario (antes en el navegador), junto con el mapa ya pintado para poder colocarlo en Studio.
- Las peticiones de dibujo ya no piden clave: basta la sesión.

## [1.7.5] — 2026-11-16

### Dibujos
- Real Monasterio de Santa Clara (Tordesillas) con dibujo propio (antes usaba el monasterio tipológico): la fachada de piedra del palacio mudéjar de Alfonso XI vista desde el compás, con la puerta de dintel adovelado, la banda de inscripción árabe, las dos lápidas cristianas a los lados (una de la batalla del Salado), la ventana con parteluz y arcos lobulados, las dos llaves del Paraíso de cerámica verde y el paño de sebka de rombos hasta el tejado; a la derecha, la iglesia gótica de ladrillo de una nave adosada. Las fuentes no precisan la posición exacta de las llaves, el número de lóbulos ni si la iglesia tiene torre o espadaña (no se dibuja).

## [1.7.4] — 2026-11-15

### Dibujos
- Castillo de Cuéllar con dibujo propio (antes usaba el castillo tipológico): visto desde el sur sobre su cerro, el torreón cuadrado con el elevado arco de ladrillo mudéjar y la balconada de madera encima, la fachada palaciega con esgrafiado de anillos, balcón y gran ventanal, rematada por la galería renacentista volada sobre grandes ménsulas, un torreón cilíndrico en la otra esquina y, detrás, la torre del homenaje cilíndrica de sillería con su terrado sobre ménsulas y almenas. Las fuentes no precisan el número de vanos de la galería exterior ni la cubierta del terrado, y difieren en la esquina de cada torreón.

## [1.7.3] — 2026-11-14

### Dibujos
- Castillo de Simancas (Archivo General) con dibujo propio (antes usaba el castillo tipológico): la barrera exterior almenada con cubos cilíndricos sobre la escarpa en alambor del foso ancho, la entrada de medio punto con escudo y el puente; detrás, el castillo-archivo de sillería con sus torres-cubo rematadas en punta (reforma de Felipe II), el cubo del Archivo más grueso y la Torre del Obispo con su linterna acampanada. Las fuentes no precisan el material de los chapiteles ni el número de cubos de la barrera.

## [1.7.2] — 2026-11-13

### Dibujos
- Castillo de Portillo con dibujo propio (antes usaba el castillo tipológico): en lo alto del cerro, el recinto interior almenado con su cubo y la torre del homenaje cuadrada y austera en la esquina suroeste, rematada por el matacán corrido sobre ménsulas con el almenado desmochado, ventana gótica conopial y troneras de cruz y orbe; delante, la barrera de 1470, más baja, con gruesos torreones cilíndricos en las esquinas y uno intermedio, y la puerta del oeste de medio punto entre dos cubos con la garita volada encima.

## [1.7.1] — 2026-11-12

### Dibujos
- Castillo de Íscar con dibujo propio (antes usaba el castillo tipológico): sobre su cerro testigo, torre del homenaje pentagonal de sillería con la arista al frente, corrido de matacanes y torrecillas en los ángulos; el espolón del s. XV entre dos torrecillas con la barrera artillera de cubos con troneras de buzón, y la barbacana torreada con el puente levadizo sobre el foso.

## [1.7.0] — 2026-11-10

### Composiciones guardadas
- El panel ya no acumula toda la lista: muestra solo las 3 últimas (y la abierta) y un botón «Ver todas (N)» que abre una galería.
- Galería de composiciones con miniatura de cada mapa, buscador (sin importar tildes; busca en el nombre y en el del GPX) y orden por más recientes, más antiguas o nombre. Desde cada tarjeta se abre, se descarga o se borra.
- Al guardar se crea una miniatura del mapa; las guardadas antes de esta versión la obtienen al volver a guardarlas.

## [1.6.2] — 2026-11-10

### Dibujos
- Castillo de Peñafiel con dibujo propio (antes usaba el castillo tipológico): el «barco de piedra» alargado sobre su loma, muralla almenada con cubos cilíndricos, torre del homenaje rectangular con torrecillas voladas en el remate y muralla exterior lisa con la puerta entre dos cubos.

## [1.6.1] — 2026-11-08

### Arreglos
- Selector de dibujo: todas las acuarelas del catálogo se pueden buscar y elegir desde cualquier población, no solo en la suya. Salen ordenadas por cercanía junto a los dibujos propios, y al buscar «acuarela» aparecen todas. Si se usa una acuarela de otro monumento, el crédito de su foto de referencia se cita igualmente.
- La búsqueda compara el comienzo de las palabras: «oña» ya no encuentra «m*ona*sterio».

## [1.6.0] — 2026-11-08

### Composiciones guardadas
- Nuevo apartado «Mis composiciones»: guarda el mapa completo para reabrirlo y seguir mejorándolo sin empezar de cero. Se guardan el GPX original tal cual, el estilo y todas las opciones de diseño, los textos, las etapas, las tipologías, los pueblos marcados, el monumento y el dibujo elegidos en cada uno, y los datos de OpenStreetMap ya descargados (al abrirla no se vuelve a consultar OSM; «Volver a consultar OSM» los actualiza conservando lo elegido).
- «Guardar cambios» sobre la composición abierta o «Guardar como nueva». Aviso de cambios sin guardar.
- Se guardan en el navegador. Cada una se puede descargar como archivo (`.estodobajada.json`) e importarla en otro equipo o navegador.
- Al abrir una composición se usan el catálogo y los dibujos actuales: si desde entonces ha llegado una acuarela o un dibujo nuevo, aparece.

## [1.5.0] — 2026-11-08

### Acuarelas en el selector
- Las ilustraciones en acuarela del catálogo aparecen como opción propia en el selector de dibujo («Acuarela: …», primera en «Para <pueblo>», con su miniatura), y la tarjeta del pueblo indica «acuarela» y la muestra en la miniatura. Se puede elegir entre la acuarela y el dibujo vectorial.

### Arreglos
- Sincronización: el clon parcial pedía después los ficheros a GitHub sin el token («could not read Username»), así que nunca llegaba a clonar. Ahora todas las descargas llevan la autenticación.

## [1.4.0] — 2026-11-07

### Dibujos sin reconstruir la app
- Los dibujos propios vectoriales salen del código: cada uno es un módulo en `app/data/dibujos/<id>.js` con su entrada en `app/data/dibujos/indice.json`. La app los carga al abrir, así que llegan al servidor con la sincronización, igual que las ilustraciones PNG. Ya no hace falta `docker compose up -d --build` por un dibujo nuevo.
- Los 13 dibujos existentes se han movido sin cambios: se ha comprobado que cada uno sale idéntico (83 casos, con varias semillas y materiales).

### Selector de dibujo
- El desplegable con todos los dibujos se sustituye por un botón con miniatura que abre una ventana con buscador y sugerencias ordenadas: primero los del pueblo o monumento, luego los del mismo tipo más cercanos (con su distancia), los genéricos y el resto por cercanía. Cada sección muestra unos pocos y la búsqueda encuentra el resto.

## [1.3.4] — 2026-11-07

### Dibujos
- Concatedral de Santa María de la Redonda (Logroño): las torres gemelas barrocas, con cuerpos cuadrados, octógono y chapitel de pináculos (la de San Pablo algo más alta), y la portada-retablo en su gran nicho con verja.
- Ermita de la Virgen de las Vegas (Requijada): galería porticada románica de siete arcos (tres y cuatro a los lados de la puerta), ábside central liso y torre de dos cuerpos con ventanas geminadas.
- Los Adioses (Somo): la joven de bronce que agita el pañuelo hacia el mar en el embarcadero.

## [1.3.3] — 2026-11-06

### Arreglos
- Pie del mapa: la línea de créditos se salía por los lados. Ahora es una línea breve, centrada y discreta, que se ajusta al ancho.
- Nueva opción «Créditos al pie»: breves (por defecto), completos (añade los autores y licencias de las fotos de referencia) o sin créditos. La lista completa de fuentes va siempre en el informe exportado.

## [1.3.2] — 2026-11-06

### Arreglos
- Perfil de altitud: los nombres de las poblaciones ya no se amontonan. Si caben, van en horizontal como antes. Si no, van en vertical sobre la curva, al estilo de los perfiles de etapa, con separación mínima y línea guía cuando hay que desplazarlos. La curva deja sitio encima; si aun así un nombre no cabe, va debajo de la línea. En perfiles muy estrechos se quedan los más importantes: fin de etapa, con monumento, villas antes que aldeas.

## [1.3.1] — 2026-11-06

### Arreglos
- Ilustrador: identificación estricta del monumento. Para «Castillo de Arévalo» había tomado el artículo del pueblo de Arévalo (salía primero en la búsqueda y estaba a menos de 5 km) y generó una vista de la villa.
  - Ahora usa primero el código de Wikidata del elemento de OpenStreetMap de la petición.
  - Busca por el nombre exacto del monumento.
  - Rechaza siempre municipios, villas, ciudades y asentamientos.
  - Exige que el nombre encontrado contenga la palabra clave del monumento.
- Las peticiones incluyen el código de Wikidata del monumento cuando se conoce.
- Se retira la ilustración equivocada del Castillo de Arévalo; vuelve su dibujo propio.

## [1.3.0] — 2026-11-06

### Mar
- Se dibuja el mar. OpenStreetMap no lo tiene como superficie, solo la línea de costa con el agua a su derecha, así que se recorta la costa al recuadro del mapa y se cierran los polígonos de mar siguiendo el borde (islas como tierra).
- Aguada azul con el pigmento acumulado junto a la costa, olas a plumilla, línea de costa a tinta y el nombre del mar (place=sea) en mar abierto, lejos de costa y ruta. Bahías con nombre en su sitio. Leyenda «Mar» en la guía.
- Si la costa llega incompleta, no se inventa el mar: queda la línea de costa, y con el relieve activado el fondo marino de las teselas (cota < 0) se pinta azul y sin sombras.

## [1.2.0] — 2026-11-06

### Ilustraciones gratis
- El ilustrador automático puede usar **Cloudflare Workers AI** (FLUX.2 [klein], cupo gratuito diario, sin tarjeta) con la foto de Commons como referencia. Orden: Gemini si hay clave; si falta o no tiene cupo (los modelos de imagen de Gemini no tienen nivel gratuito), Cloudflare. El catálogo guarda qué proveedor y modelo hizo cada ilustración.
- Secretos nuevos: `CLOUDFLARE_ACCOUNT_ID` y `CLOUDFLARE_API_TOKEN`; variable opcional `CF_IMAGE_MODEL`.

## [1.1.1] — 2026-11-06

### Arreglos
- Pedir dibujo: la app distingue «clave incorrecta» (la comprueba el servidor) de «GitHub rechaza el token» (caducado o sin permiso Issues) y del límite de envíos, con un mensaje claro para cada caso.

## [1.1.0] — 2026-11-06

### Peticiones de dibujo sin salir de la app
- El botón «✏️ Pedir dibujo propio» envía la petición directamente: una ventana con notas opcionales y, la primera vez, la clave de peticiones (se recuerda en el navegador). Aviso «✓ Petición nº N enviada».
- El servidor reenvía la petición a GitHub con un token propio (`PETICION_TOKEN`) solo si la clave coincide exactamente (`PETICION_CLAVE`), con un límite de 6 por minuto. La clave no sale del servidor.
- Si no está configurado, o se prefiere, se sigue pudiendo abrir en GitHub.
- La configuración de nginx pasa a ser una plantilla (`docker/estodobajada.conf.template`) que lee esas variables del `.env`.

### Arreglos
- Sincronización robusta en Windows (finales de línea CRLF).
- El ilustrador reconoce las peticiones aunque GitHub descarte la etiqueta al crearlas.

## [1.0.0] — 2026-11-06 · primera versión en producción

Servida en https://www.estodobajada.com:8088 (Docker Desktop en Windows, HTTPS con Let's Encrypt).

### Cartografía fiel
- El GPX es intocable: se dibuja vértice a vértice y se valida en cada render (número de puntos, SHA-256 de las coordenadas literales, orden, segmentos independientes, vértices del SVG y tramos de etapa). Si algo no cuadra, no se exporta.
- Datos reales de OpenStreetMap: poblaciones, patrimonio, museos, ríos y arroyos, lagunas y embalses (multipolígonos con islas), humedales, bosques, cascos urbanos, carreteras, ferrocarril, cimas y puertos.
- **Nuevo: relieve real** a partir de teselas de elevación (Terrain Tiles, AWS Open Data), pintado como aguada con contraste adaptativo para que se lean tanto una vega castellana como una sierra.
- Patrimonio en el campo junto a la ruta (villas, ermitas, yacimientos), sin duplicados de pueblos ni de monumentos.

### Arte
- Cuatro estilos: acuarela húmeda, tinta y aguada, grabado sepia y cuaderno de viaje.
- Maquetaciones póster y guía ilustrada (etapas por colores, panel de leyenda y puntos de interés, perfiles por día).
- Dibujos propios: castillos de Arévalo, Coca, la Mota y Velasco (Espinosa), murallas de Madrigal y Ávila, arco de Olmedo, acueducto de Segovia, catedral de Toledo y villa romana de Almenara-Puras.
- **Nuevo: variantes en los dibujos genéricos**: torre o espadaña, remate, ábside, pórtico, cigüeñal y material (ladrillo o piedra según OSM). Cada pueblo tiene siempre la misma.
- Tipografías a elegir; ilustraciones propias en PNG/SVG desde el catálogo.

### Ilustraciones automáticas
- Botón «✏️ Pedir dibujo propio» en cada población: crea la petición en GitHub ya rellenada.
- **Nuevo: ilustrador automático** (GitHub Actions). Identifica el monumento en Wikipedia/Wikidata, comprueba que está a menos de 5 km de la petición, toma su foto de Wikimedia Commons como referencia y genera una viñeta de tinta y acuarela con un modelo de imagen. Después la añade al catálogo con autor y licencia de la foto, y comenta y cierra la petición. Si no puede confirmar el monumento o no hay foto, no inventa: deja la petición para el dibujo vectorial.
- **Nuevo: sincronización del catálogo** en el servidor cada 10 minutos: lo que se genera aparece en la web sin `git pull`.
- Tarea nocturna de Claude: atiende las peticiones pendientes investigando en internet y mejora un dibujo por noche.

### Servidor
- nginx en Docker con HTTPS en el 8088, redirección de http a https, proxys con caché para Overpass y para las teselas de relieve, y comprobación de salud.
