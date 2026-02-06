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

### Modelo multiempresa (base)

- Tabla `empresas` (id, nombre, codigo, estado, fechas de alta/corte, días de gracia, notas) para representar cada negocio/cliente.
- Tabla `usuarios` incluye ahora `empresa_id` para asociar cada usuario a una empresa concreta.
- Rol reservado `superadmin`: pensado solo para el backend en la nube y panel maestro; estos usuarios pueden existir sin `empresa_id` (globales) y no forman parte de una empresa concreta.
- Todas las instalaciones actuales usan por defecto la empresa con id=1 y código `LOCAL`; esto prepara el terreno para separar datos por empresa sin romper el comportamiento actual.

### Licencias por empresa (base)

- La tabla `empresas` incluye campos de licenciamiento: `plan`, `monto_mensual`, `ultimo_pago_en`, `proximo_cobro` y `estado` (`activa`, `morosa`, `suspendida`).
- El flujo de login lee `estado` de la empresa y, si está marcada como `suspendida`, bloquea el acceso para usuarios de esa empresa (excepto `superadmin`), permitiendo implementar suspensión por falta de pago.

## Pruebas automáticas

- Backend probado con Jest (entorno Node) y supertest para rutas HTTP.
- Las pruebas viven en `server/tests` y se ejecutan con:

	- `npm test`

- En modo test se usa una base de datos SQLite en memoria (configurada en `server/db.js` cuando `NODE_ENV=test`), aplicando las mismas migraciones que producción pero sin tocar el archivo real.
- Cobertura actual de servicios backend: ventas, reportes, cobranzas, devoluciones, ajustes, compras y proveedores.
- Cobertura actual de rutas HTTP protegidas: `/ventas`, `/reportes`, `/cobranzas` y `/devoluciones`, incluyendo casos de éxito y errores de validación básicos.

## Configuración por entorno

La aplicación se configura principalmente mediante variables de entorno. Valores por defecto pensados para desarrollo local:

- `PORT`: puerto HTTP del servidor Express. Por defecto `3000`.
- `NODE_ENV`: entorno de ejecución (`development`, `production`, `test`). En `test` la base de datos usa `:memory:`.
- `DB_PATH` / `DATABASE_FILE`: nombre o ruta del archivo SQLite. Por defecto `database.sqlite` en la raíz del proyecto.
- `SQL_VERBOSE` / `SQL_DEBUG`: si se establece a `true`/`1`/`yes`, activa el modo verbose de `better-sqlite3` (log de todas las consultas SQL).
- `ADMIN_USERNAME`, `ADMIN_PASSWORD`: si no existen usuarios, se creará automáticamente un usuario admin con estas credenciales (debe cambiar la contraseña en el primer login).
- `SUPERADMIN_USERNAME`, `SUPERADMIN_PASSWORD`: si no existe ningún usuario con rol `superadmin`, se creará uno global (sin empresa_id) con estas credenciales, pensado solo para el panel master de empresas/licencias.
- `ENABLE_AUTOBACKUP`: controla el backup automático de la base de datos. Valores falsy: `0`, `false`, `no`. Por defecto está habilitado excepto en `NODE_ENV=test`.
- `BACKUP_INTERVAL_HOURS`: intervalo en horas entre backups automáticos. Por defecto `6`.

### Ejemplo rápido (Windows PowerShell)

- `setx PORT 4000`
- `setx DB_PATH diesel-pos.sqlite`

Tras definir las variables, reinicia la terminal y ejecuta `npm start`.

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
