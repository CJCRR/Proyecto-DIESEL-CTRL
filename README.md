# Diesel CTRL

Aplicación POS para repuestos diésel con soporte online/offline, sincronización con Firebase y backend en Node.js/SQLite.

## Configuración de Firebase (no subir claves)

- Este proyecto carga `public/firebase-config.js` en el navegador. Ese archivo contiene el config de Firebase y no debe subirse al repositorio.

## Arquitectura Backend

- Servidor Express en `server/server.js` usando SQLite a través de `server/db.js`.
- Rutas HTTP en `server/routes/*` actúan como capa fina (validan `req`, auth y códigos HTTP).
- Lógica de negocio principal extraída a servicios en `server/services/*`:
	- Ventas: `ventasService` (registro de ventas, stock, cuentas por cobrar).
	- Reportes: `reportesService` (consultas complejas, KPIs, inventario, series).
	- Cobranzas: `cobranzasService` (cuentas por cobrar, pagos, estados).
	- Devoluciones: `devolucionesService` (política de devoluciones, control de cantidades y stock).
	- Ajustes: `ajustesService` (ajustes de stock, tasa BCV, config empresa/nota, purge-data).
- Middleware de seguridad y errores en `server/middleware/*` (seguridad, auth, manejo de errores).
- Logging centralizado con Winston en `server/services/logger.js`.

## Arquitectura Frontend

- Código público en `public/` servido por Express.
- Punto de entrada POS y páginas en `public/pages/*.html`.
- JavaScript principal organizado en módulos ES6 dentro de `public/js/`:
	- `app.js`: orquestador principal del POS (inicializa módulos y eventos).
	- `modules/cart.js`: manejo del carrito y selecciones de productos.
	- `modules/sales.js`: registro de ventas y devoluciones, integración offline.
	- `modules/search.js`: búsqueda de productos online/offline.
	- `modules/ui.js`: UI de estado online/offline, sync/backup, clientes frecuentes.
- Soporte offline:
	- Service Worker en `public/service-worker.js` (cache estático y sync).
	- IndexedDB y helpers en `public/js/db-local.js` para ventas, productos y clientes.
	- Sincronización con Firebase en `public/js/firebase-sync.js`.

## Flujo típico

- El usuario inicia sesión y accede al POS.
- El frontend consume APIs REST (`/ventas`, `/reportes`, `/cobranzas`, `/devoluciones`, `/admin/ajustes`, etc.) que delegan su lógica a los servicios backend.
- En modo offline, las ventas se guardan en IndexedDB y se sincronizan al reconectar sin generar duplicados ni inconsistencias de stock.
