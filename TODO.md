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
- [x] Añadir pequeños detalles de UX avanzada (atajos de teclado, indicadores de carga globales) una vez estabilizado todo lo anterior.

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
- [x] Diseñar el formato base de la cola de operaciones offline (tabla `sync_outbox` con eventos por empresa, `evento_uid`, payload y estado).
- [x] Crear tablas de soporte para idempotencia en el backend nube (`sync_inbox` con `evento_uid` único por evento).
- [x] Crear endpoints iniciales en el backend nube para recibir lotes de operaciones por empresa (`POST /sync/push`) y preparar el endpoint de descarga (`GET /sync/pull`).
- [descartado] Cliente de sync completo + pull nube (no necesario por ahora).

## Fase 18: Panel Master y Licencias
- [x] Crear panel web para superadmin con listado de empresas, filtros y búsqueda (public/pages/admin-empresas.html + /admin/empresas).
- [x] Gestionar estados de licencia por empresa (activa, morosa, suspendida) con fechas de corte y días de gracia (acciones en admin-empresas.js + PATCH /admin/empresas/:id).
- [x] Mostrar alertas de empresas morosas o suspendidas tanto en el panel master como en el login de la empresa (resaltado visual en panel y aviso en login cuando empresa_estado = 'morosa'; bloqueo total si 'suspendida').
- [x] Integrar el chequeo de licencia en el flujo de login y en operaciones críticas (el login bloquea empresas con estado 'suspendida').

## Fase 19: Experiencia Web para Dueño (Empresa)
- [descartado] Crear portal separado y login distinto para admin_empresa (se reutilizan las vistas actuales con el mismo flujo de login).
- [x] Asegurar que las vistas clave actuales sean totalmente usables en móvil (POS, dashboard, reportes principales).
- [x] Revisar estilos responsive (Tailwind) de tablas y tarjetas para que se adapten bien en pantallas pequeñas.

## Fase 20: Refuerzo Multiempresa y Tests
- [x] Añadir pruebas automatizadas específicas para rutas multiempresa críticas (ventas, reportes, compras, cobranzas, devoluciones, usuarios) verificando que siempre filtren por empresa_id.
- [x] Agregar pruebas para el panel master de empresas (empresas_admin) con restricciones de acceso solo para superadmin.
- [x] Incluir pruebas que verifiquen que un usuario de empresa nunca ve datos de otra empresa (ventas, cobranzas, devoluciones, usuarios, reportes clave).
- [ ] Documentar en README los casos de prueba multiempresa principales y cómo ejecutarlos.

## Fase 21: UX Panel Master y Formularios Críticos
- [x] Reemplazar diálogos nativos (prompt/confirm) en el panel master de empresas por modales con Tailwind para editar plan/monto, registrar pagos y editar ciclo de facturación.
- [x] Normalizar mensajes de error y éxito en la UI usando showToast, diferenciando claramente errores de negocio (validación) de errores de red/servidor.
- [x] Revisar textos y ayudas contextuales en formularios sensibles (usuarios, empresas, ajustes generales) para que sean más claros para usuarios no técnicos.

## Fase 22: Rendimiento e Índices
- [x] Revisar y documentar índices existentes en SQLite para tablas grandes (ventas, productos, usuarios, cuentas_cobrar).
- [x] Crear índices adicionales donde sea necesario, por ejemplo: ventas(empresa_id, fecha, usuario_id), productos(empresa_id, codigo), usuarios(empresa_id, username) para mejorar búsquedas y reportes.
- [ ] Revisar consultas pesadas en reportesService, cobranzasService y comprasService usando EXPLAIN y optimizar filtros/joins cuando sea necesario.
- [ ] Documentar recomendaciones de mantenimiento de la base SQLite (backups, rotación de archivos, tamaño esperado por empresa/año).
 - [ ] Testear rendimiento con histórico grande de ventas/inventario (a validar a largo plazo cuando existan más datos reales).

## Fase 23: Eventos y Métricas (Nube)
- [x] Definir y documentar un esquema ligero de eventos de negocio (ej: venta_registrada, usuario_creado, empresa_actualizada) con sus campos mínimos.
- [x] Documentar en README el endpoint /sync/push y el formato esperado de eventos por empresa (incluyendo ejemplos de payload).
- [x] Añadir emisión opcional de eventos usuario_creado y empresa_actualizada en las rutas correspondientes, reutilizando la infraestructura de sync existente.
- [idea] Evaluar y documentar una posible colección en Firestore para almacenar ciertos eventos o métricas agregadas por empresa (solo si aporta valor futuro).

## Fase 24: Seguridad Avanzada (Futuro)
// Primera iteración implementada: auditoría básica + campos de 2FA en backend.
- [x] Completar endpoints y flujo backend para 2FA opcional (por ejemplo TOTP) para cuentas superadmin y, si se requiere, para admin_empresa.
- [x] Agregar una tabla o mecanismo de logs de auditoría para registrar acciones críticas (cambios de plan, eliminación de empresa, creación y eliminación de usuarios, ajustes masivos de inventario).

## Fase 25: Branding por Empresa
- [x] Adaptar theme.js para leer los valores de branding (empresa_config por empresa) y aplicar un esquema de colores personalizado por empresa en el frontend (navbar, botones principales, acentos).
- [x] Permitir que el admin de empresa configure aspectos visuales simples (nombre comercial, logo y colores) desde Ajustes, respetando límites razonables para no romper la UI.

## Fase 26: Escalabilidad de Base de Datos (Idea)
- [idea] Evaluar, a medio/largo plazo, una posible migración de SQLite a un motor como PostgreSQL/MySQL si el volumen de datos o el número de empresas/usuarios concurrentes crece significativamente.
- [idea] Abstraer aún más el acceso a datos en los servicios (ventasService, reportesService, etc.) para facilitar un cambio de motor de base de datos en el futuro.
- [idea] Documentar una estrategia de migración (export/import) y compatibilidad con instalaciones existentes, en caso de decidir un cambio de motor.

## Fase 27: Despliegue en Nube y Actualizaciones (Idea)
- [idea] Documentar un flujo estándar de despliegue en VPS (Node.js + PM2 + Nginx + HTTPS) para Diesel-CTRL en modo multiempresa.
- [idea] Definir estrategia de entornos `staging` y `producción` (bases separadas) para probar cambios antes de publicarlos a todas las empresas.
- [idea] Especificar procedimiento de actualización sin pérdida de datos (backup previo del .sqlite, `git pull`, `npm install`, `pm2 restart`, verificación rápida).
- [idea] Evaluar automatizar backups remotos del archivo SQLite (S3 u otro servidor) y plan básico de recuperación ante fallos.

## Fase 28: Estrategia de Precios
- [idea] Implementar en ajustes hasta 3 precios adicionales configurables por empresa, calculados en % en base al precio USD base (ejemplo: 50 + 45%).
- [idea] Permitir que en el POS se pueda seleccionar fácilmente el precio base o cualquiera de los otros precios configurados por producto/nivel.

## Fase 29: Comisiones por Vendedor
- [idea] Definir en ajustes un porcentaje de comisión por venta (global o por rol/usuario) para cada empresa.
- [idea] Hacer que el campo vendedor en ventas sea un selector de usuarios de la empresa y calcular automáticamente la comisión de cada venta.
- [idea] Añadir reportes para ver el total de comisiones generadas por vendedor en un rango de fechas.

## Fase 30: Flujo de Compras e Inventario ✅
- [x] Implementar un botón de "crear producto" en la página de compras para no tener que ir al inventario al registrar una compra, usando un formulario flotante/modal.
- [x] Ajustar la página de inventario para que el orden por defecto de los productos sea alfabético y agregar más filtros (por categoría, proveedor, stock, etc.) para facilitar la búsqueda.

## Fase 31: Múltiples Depósitos de Inventario
- [x] Implementar soporte básico de depósitos por empresa en base de datos (tabla depositos y campo deposito_id en productos, con depósito principal por defecto).
- [x] Añadir servicio y API REST para listar/crear/editar depósitos por empresa.
- [x] Permitir seleccionar/editar el depósito asociado al producto al crearlo o modificarlo en Inventario y en el flujo de Compras.
- [x] Conectar filtros/vistas por depósito en Inventario para poder listar productos por depósito.
- [idea] Añadir movimientos entre depósitos y ajustar reportes para ver existencias por depósito y métricas avanzadas.

## Notas de Progreso

- [idea] Espacio para anotar ideas rápidas antes de asignarlas a una fase.