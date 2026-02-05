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
- [ ] Personalización avanzada de nota de entrega (campos fiscales adicionales y plantillas).
- [ ] Preparar puntos de integración para pasarelas de pago (estructura de datos y endpoints base).

## Fase 9: Reportes de Rentabilidad
- [ ] Reporte de pérdidas y ganancias por categoría de producto.
- [ ] Análisis de margen por categoría y por proveedor.
- [ ] Resumen financiero por período (ingresos, costo estimado, margen bruto).
- [ ] Exportación de estos reportes a CSV/Excel para contabilidad.

## Notas de Progreso
