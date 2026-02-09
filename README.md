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

### Sincronización local ↔ nube (base)

- Se preparó un modelo inicial de sincronización orientado a un esquema híbrido local + nube.
- Tablas principales en SQLite:
	- `sync_outbox`: cola de eventos generados en el POS local que deben enviarse a la nube (`empresa_id`, `tipo`, `entidad`, `entidad_id_local`, `evento_uid`, `payload`, `estado`, `intentos`, timestamps).
	- `sync_inbox`: registro de eventos ya procesados en la nube para garantizar idempotencia (`empresa_id`, `origen`, `evento_uid` único, `tipo`, `entidad`, `payload_original`).

#### Esquema de eventos de negocio

Todos los eventos que viajan por la infraestructura de sync comparten una forma ligera común:

- `evento_uid` (string): identificador único idempotente del evento.
- `tipo` (string): tipo lógico del evento de negocio. Ejemplos: `venta_registrada`, `usuario_creado`, `empresa_creada`, `empresa_actualizada`.
- `entidad` (string): nombre lógico de la entidad asociada (`venta`, `usuario`, `empresa`, etc.).
- `entidad_id_local` (string|number|null): identificador local de la entidad cuando aplica.
- `payload` (object): datos mínimos necesarios para métricas o integraciones futuras.

Ejemplos de payloads actuales:

- `venta_registrada` / `entidad: 'venta'`:
	- Campos principales: `id_global`, `fecha`, `cliente`, `cedula`, `telefono`, `tasa_bcv`, `descuento`, `metodo_pago`, `referencia`, `credito`, `dias_vencimiento`, `fecha_vencimiento`, `iva_pct`, `total_bs`, `total_usd`, `items[]`.
	- Los totales se calculan en `public/js/sync-client.js` vía `calcularTotalesVenta` para garantizar consistencia.
- `usuario_creado` / `entidad: 'usuario'`:
	- Campos mínimos: `id`, `username`, `nombre_completo`, `rol`, `activo`, `creado_en`.
- `empresa_creada` y `empresa_actualizada` / `entidad: 'empresa'`:
	- Payload con la fila básica de `empresas` (id, nombre, codigo, estado, plan, monto_mensual, fechas, notas y contacto).

#### Endpoint `POST /sync/push`

- Autenticación: requiere usuario de empresa autenticado (middleware `requireAuth`).
- Request body:
	- `origen` (string, opcional): etiqueta de origen lógico (`pos-local`, `panel-master`, etc.).
	- `eventos` (array requerido): lista de eventos con el esquema descrito arriba.

Ejemplo de llamada desde el POS local (venta registrada):

```json
{
  "origen": "pos-local",
  "eventos": [
    {
      "evento_uid": "1699999999999-abc123",
      "tipo": "venta_registrada",
      "entidad": "venta",
      "entidad_id_local": "VENTA_LOCAL_001",
      "payload": { "id_global": "VENTA_LOCAL_001", "fecha": "2024-05-01", "total_usd": 120.5, "items": [] }
    }
  ]
}
```

- Comportamiento en backend (`server/routes/sync.js`):
	- Valida que cada evento tenga `evento_uid`, `tipo` y `entidad`.
	- Inserta de forma idempotente en `sync_inbox` (usando `evento_uid` único).
	- Para eventos `tipo = 'venta_registrada'` y `entidad = 'venta'`, actualiza métricas diarias en `empresa_metricas_diarias` mediante `agregarMetricaVenta`.
	- Devuelve un resumen por evento:
		- `status: 'ok'` si fue insertado y procesado.
		- `status: 'duplicado'` si ya existía en `sync_inbox`.
		- `status: 'error'` si hubo algún problema con ese evento.

#### Eventos emitidos desde el backend (panel)

- Además de los eventos enviados por el POS local, el backend puede registrar directamente eventos de negocio en `sync_inbox` usando `server/services/eventosService.js`:
	- `usuario_creado`: emitido al crear un usuario de empresa en `/admin/usuarios`.
	- `empresa_creada` y `empresa_actualizada`: emitidos desde `/admin/empresas` (panel master superadmin).
- Estos eventos reutilizan la misma estructura de `sync_inbox` y permiten, en el futuro, alimentar métricas agregadas o integraciones externas (incluida una posible colección de eventos en Firestore por empresa).
## Pruebas automáticas

- Backend probado con Jest (entorno Node) y supertest para rutas HTTP.
- Las pruebas viven en `server/tests` y se ejecutan con:

	- `npm test`

- En modo test se usa una base de datos SQLite en memoria (configurada en `server/db.js` cuando `NODE_ENV=test`), aplicando las mismas migraciones que producción pero sin tocar el archivo real.
- Cobertura actual de servicios backend: ventas, reportes, cobranzas, devoluciones, ajustes, compras y proveedores.
- Cobertura actual de rutas HTTP protegidas: `/ventas`, `/reportes`, `/cobranzas` y `/devoluciones`, incluyendo casos de éxito y errores de validación básicos.

### Pruebas multiempresa

- Existen pruebas específicas que validan el aislamiento por empresa y los roles:
	- Ventas: `ventasRoutes.test.js` verifica que un `superadmin` no puede registrar ventas y que las rutas usan `empresa_id` del usuario.
	- Reportes: `reportesRoutes.test.js` comprueba que `/reportes/ventas-rango` solo devuelve ventas de la empresa del usuario autenticado.
	- Cobranzas: `cobranzasRoutes.test.js` valida que `/cobranzas` rechaza `superadmin` y que las cuentas por cobrar listadas están ligadas a la empresa del usuario.
	- Devoluciones: `devolucionesRoutes.test.js` exige que `superadmin` no acceda a devoluciones y que el historial muestre solo devoluciones de la empresa correspondiente.
	- Usuarios: `usuariosRoutes.test.js` garantiza que `/admin/usuarios` solo lista usuarios de la misma empresa del admin.
	- Panel master: `empresasAdminRoutes.test.js` confirma que `/admin/empresas` es accesible únicamente para usuarios con rol `superadmin`.

- Para ejecutar solo estas pruebas multiempresa se puede usar, por ejemplo:

	- `npm test -- ventasRoutes.test.js reportesRoutes.test.js cobranzasRoutes.test.js devolucionesRoutes.test.js usuariosRoutes.test.js empresasAdminRoutes.test.js`

### Índices en SQLite y rendimiento

- Tablas grandes como `productos`, `ventas`, `presupuestos`, `compras` y `proveedores` tienen índices básicos creados por migraciones en `server/db.js` (por ejemplo: `idx_productos_codigo`, `idx_productos_empresa_codigo`, `idx_ventas_fecha`, índices sobre `venta_detalle`, `devolucion_detalle`, `compras` y `presupuestos`).
- Para el modelo multiempresa se añaden, entre otros, los índices `idx_usuarios_empresa` y `idx_presupuestos_empresa`, que aseguran que los filtros por `empresa_id` sean eficientes.
- Fase 22 añade índices compuestos pensados para los patrones de acceso más frecuentes:
	- `idx_usuarios_empresa_username` en `usuarios (empresa_id, username)` para acelerar login y administración de usuarios por empresa.
	- `idx_ventas_usuario_fecha` en `ventas (usuario_id, fecha)` para mejorar reportes/kpis que filtran por usuario y rango de fechas.
- Al cambiar patrones de consulta o añadir nuevos reportes pesados, se recomienda revisar `server/db.js` y, si es necesario, crear índices adicionales siguiendo el mismo esquema (`indexExists` + `CREATE INDEX IF NOT EXISTS`).

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
