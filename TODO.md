# TODO: Mejoras de Seguridad y Arquitectura

## Fase 1: Dependencias y Logging ✅
- [x] Instalar dependencias nuevas: winston, winston-daily-rotate-file, csurf, express-validator, jsonwebtoken, express-sslify
- [x] Crear server/services/logger.js con Winston configurado
- [x] Integrar logger en server.js y rutas principales
- [x] Crear directorio server/logs/

## Fase 2: Seguridad Básica ✅
- [x] Configurar HTTPS enforcement en producción
- [x] Actualizar Helmet con headers completos (remover CSP false)
- [x] Crear server/middleware/security.js
- [x] Integrar middleware en server.js

## Fase 3: Autenticación Avanzada
- [x] Implementar JWT tokens opcionales
- [x] Refinar bloqueo de cuentas por intentos fallidos
- [descartado] Crear sistema de permisos granulares (leer/escribir/admin por módulo)
- [x] Integrar CSRF protection
- [x] Separar middleware de auth en server/middleware/auth.js

## Fase 4: Manejo de Errores Robusto
- [x] Crear server/middleware/errorHandler.js centralizado
- [x] Implementar respuestas estructuradas (dev vs prod)
- [x] Agregar graceful shutdown (SIGTERM/SIGINT)
- [x] Logging de todos los errores con contexto

## Fase 5: Arquitectura Modular ✅
- [x] Refactorizar backend: separar servicios y middleware (ventas, reportes, cobranzas, devoluciones, ajustes)
- [x] Dividir app.js en módulos: cart.js, search.js, sales.js, ui.js
- [x] Convertir a ES6 modules consistentes en frontend principal
- [x] Mejorar separación de responsabilidades entre rutas HTTP y servicios

## Fase 6: Testing y Validación ✅
- [x] Verificar flujos críticos end-to-end:
	-  POS ventas online (con factura, nota y cuentas por cobrar)
	- POS ventas offline + reconexión (sin duplicados ni stock erróneo)
	- Devoluciones sobre ventas recientes y antiguas (respeta política de días)
	- Cobranzas (creación de cuenta, registro de pagos, estados correcto)
	- Ajustes de stock (no permite stock negativo, registra en historial)
	- Reportes (ventas rango, KPIs, top productos/clientes, inventario)
- [x] Ajustes finales y optimizaciones menores (queries, UI, tiempos de carga)
- [x] Documentar cambios de arquitectura (servicios backend y módulos frontend)

## Fase 7: Inventario y Proveedores ✅
- [x] Soporte básico de lotes/batches en productos (campos de lote y observaciones por movimiento de inventario).
- [x] Trazabilidad simple de inventario por lote en ventas, devoluciones y ajustes.
- [x] Catálogo de proveedores y vinculación opcional con productos.
- [x] Caargar productos, provenientes de un proveedor (como orden de compra).
- [x] Pantalla sencilla de proveedores (alta/baja/edición, contacto básico).

## Fase 8: Finanzas y Facturación
- [x] Mejoras en cobranzas: filtros por estado y por días de mora, alertas para cuentas vencidas.
- [x] Cálculo opcional de impuestos (IVA) en ventas/notas según configuración.
- [x] Personalización avanzada de nota de entrega (campos fiscales adicionales y plantillas).
- [descartado] Preparar puntos de integración para pasarelas de pago (no es prioridad para este software de ventas e inventario).

## Fase 9: Reportes de Rentabilidad
- [x] Reporte de pérdidas y ganancias por categoría de producto.
- [x] Análisis de margen por categoría y por proveedor.
- [x] Resumen financiero por período (ingresos, costo estimado, margen bruto).
- [x] Exportación de estos reportes a CSV/Excel para contabilidad.

## Fase 10: Pruebas Automáticas y Regresión ✅
- [x] Definir stack de testing para backend (Jest + supertest).
- [x] Crear pruebas automatizadas para servicios críticos backend: ventas, devoluciones, cobranzas, reportes, ajustes, compras y proveedores.
- [x] Agregar script `npm test` y preparación para correr tests antes de publicar cambios.
- [x] Añadir pruebas HTTP para rutas protegidas clave: /ventas, /reportes, /cobranzas y /devoluciones.

## Fase 11: Manejo de Errores y Feedback al Usuario
- [x] Normalizar el formato de errores en el backend (JSON estructurado con `error`, `detail`, `code`).
- [x] Reemplazar `alert()` en el frontend por `showToast` u otra UI consistente para errores importantes (manteniendo `alert` solo como fallback de emergencia).
- [x] Revisar y reforzar logs en rutas sensibles (ventas, cobranzas, reportes) para facilitar diagnóstico.

## Fase 12: Documentación y Tipado
- [x] Añadir JSDoc a servicios clave (ventasService, reportesService, cobranzasService, ajustesService).
- [x] Documentar la forma de los objetos principales: `venta`, `detalle`, `configGeneral` y configuraciones de nota (via server/types.js y JSDoc en servicios).
- [x] Preparar base para posible migración parcial a TypeScript en backend/frontend (tipos compartidos en server/types.js y @ts-check en servicios críticos).

## Fase 13: Refactors y Utilidades Compartidas
- [x] Extraer helpers reutilizables para construcción de filtros por fecha y otros patrones repetidos en reportesService (helper appendFechaFilters).
- [x] Centralizar utilidades de formato de moneda e IVA en un módulo de frontend compartido (public/js/format-utils.js) y usarlas en módulos clave (reportes, dashboard, ventas).
- [x] Revisar y reducir duplicaciones entre plantillas de nota y componentes de reportes donde tenga sentido (plantillas de nota ahora usan totales con IVA del backend cuando están disponibles, alineando sus cálculos con los de reportes).

## Fase 14: Infraestructura y Despliegue
- [x] Centralizar configuración sensible en variables de entorno (puerto, ruta de base de datos, credenciales admin, flags de debug).
- [x] Crear un `docker-compose` opcional para levantar la app y la base de datos con volúmenes persistentes.
- [ ] Añadir pequeños detalles de UX avanzada (atajos de teclado, indicadores de carga globales) una vez estabilizado todo lo anterior.

## Fase 15: Modelo Multiempresa (Backend)
- [x] Definir tabla de empresas (empresas) con campos básicos: id, nombre, codigo, estado, fecha_alta, fecha_corte, dias_gracia, nota_interna.
- [x] Asociar usuarios a empresas añadiendo empresa_id a la tabla usuarios y ajustando consultas para filtrar por empresa (por ahora todos apuntan a la empresa 1 por defecto).
- [x] Definir rol superadmin separado de los usuarios normales de empresa (sin empresa_id o con marca especial) y documentar que es global para el panel en la nube.
- [x] Documentar el modelo multiempresa y los nuevos campos en README.

## Fase 16: Login Multiempresa y Roles
- [x] Diseñar el flujo de login empresa + usuario + contraseña para la parte nube (incluyendo codigo_empresa) y soportarlo opcionalmente en /auth/login.
- [x] Actualizar el modelo de auth para incluir empresa_id y rol (superadmin, admin_empresa, vendedor, lectura) en el token/sesión (JWT y token clásico ahora llevan empresa_id/empresa_codigo).
- [x] Ajustar middlewares de autorización para que propaguen empresa_id y empresa_codigo en req.usuario, de forma que las rutas puedan validar empresa además de rol.

## Fase 17: Sincronización Local ↔ Nube
- [ ] Diseñar el formato de la cola de operaciones offline (ventas, presupuestos y mínimos necesarios) en el POS local.
- [ ] Crear endpoints en el backend nube para recibir lotes de operaciones por empresa y evitar duplicados.
- [ ] Implementar un cliente de sincronización en la instalación local que envíe la cola cuando haya internet, con reintentos.
- [ ] Añadir indicadores de estado de sincronización en la UI (último sync correcto, pendientes, errores).

## Fase 18: Panel Master y Licencias
- [x] Crear panel web para superadmin con listado de empresas, filtros y búsqueda (public/pages/admin-empresas.html + /admin/empresas).
- [x] Gestionar estados de licencia por empresa (activa, morosa, suspendida) con fechas de corte y días de gracia (acciones en admin-empresas.js + PATCH /admin/empresas/:id).
- [x] Mostrar alertas de empresas morosas o suspendidas tanto en el panel master como en el login de la empresa (resaltado visual en panel y aviso en login cuando empresa_estado = 'morosa'; bloqueo total si 'suspendida').
- [x] Integrar el chequeo de licencia en el flujo de login y en operaciones críticas (el login bloquea empresas con estado 'suspendida').

## Fase 19: Portal Web del Dueño (Empresa)
- [ ] Crear vistas ligeras en la nube para admin_empresa: resumen de ventas, reportes clave y gestión básica (por ejemplo, presupuestos).
- [ ] Hacer estas vistas responsive para uso cómodo desde móvil.
- [ ] Respetar roles dentro de la empresa (admin_empresa vs lectura) en el portal nube.

## Notas de Progreso
