# TODO: Mejoras de Seguridad y Arquitectura

## Fase 1: Dependencias y Logging ✅
- [] Instalar dependencias nuevas: winston, winston-daily-rotate-file, csurf, express-validator, jsonwebtoken, express-sslify
- [] Crear server/services/logger.js con Winston configurado
- [] Integrar logger en server.js y rutas principales
- [] Crear directorio server/logs/

## Fase 2: Seguridad Básica ✅
- [] Configurar HTTPS enforcement en producción
- [] Actualizar Helmet con headers completos (remover CSP false)
- [] Crear server/middleware/security.js
- [] Integrar middleware en server.js

## Fase 3: Autenticación Avanzada
- [ ] Implementar JWT tokens opcionales
- [ ] Refinar bloqueo de cuentas por intentos fallidos
- [ ] Crear sistema de permisos granulares (leer/escribir/admin por módulo)
- [ ] Integrar CSRF protection
- [ ] Separar middleware de auth en server/middleware/auth.js

## Fase 4: Manejo de Errores Robusto
- [ ] Crear server/middleware/errorHandler.js centralizado
- [ ] Implementar respuestas estructuradas (dev vs prod)
- [ ] Agregar graceful shutdown (SIGTERM/SIGINT)
- [ ] Logging de todos los errores con contexto

## Fase 5: Arquitectura Modular ✅
- [ ] Refactorizar backend: separar servicios y middleware
- [ ] Dividir app.js en módulos: cart.js, search.js, sales.js, ui.js
- [ ] Convertir a ES6 modules consistentes
- [ ] Mejorar separación de responsabilidades

## Fase 6: Testing y Validación ✅
- [ ] Verificar todas las funcionalidades
- [ ] Ajustes finales y optimizaciones
- [ ] Documentar cambios

## Notas de Progreso
