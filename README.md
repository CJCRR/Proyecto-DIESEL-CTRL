# NEXA CTRL

Sistema POS para venta de repuestos.

Permite vender, hacer presupuestos, controlar inventario, manejar clientes, ver reportes y seguir trabajando con funciones offline.

## Qué incluye

- POS de ventas
- Inventario
- Clientes y proveedores
- Compras
- Cobranzas
- Devoluciones
- Reportes
- Ajustes del negocio
- Panel de empresas y licencias

## Tecnologías usadas

- Node.js
- Express
- SQLite
- JavaScript en frontend
- Firebase para sincronización y respaldo en ciertas funciones

## Cómo iniciar el proyecto

1. Instala dependencias:

```bash
npm install
```

2. Inicia el servidor:

```bash
npm start
```

3. Abre en el navegador:

```text
http://localhost:3000
```

## Variables básicas

Estas son las más importantes:

- `PORT`: puerto del servidor
- `DB_PATH`: ruta o nombre de la base de datos SQLite
- `JWT_SECRET`: secreto para firmar/verificar tokens JWT (obligatorio fuera de tests)
- `ADMIN_USERNAME`: usuario admin inicial
- `ADMIN_PASSWORD`: clave admin inicial
- `SUPERADMIN_USERNAME`: usuario superadmin inicial
- `SUPERADMIN_PASSWORD`: clave superadmin inicial

Ejemplo en PowerShell:

```powershell
setx PORT 3000
setx DB_PATH database.sqlite
```

Después de cambiar variables, reinicia la terminal.

## Firebase

El proyecto usa un archivo de configuración en frontend.

- `public/config/firebase-config.js`

Ese archivo no debe subirse al repositorio si contiene datos reales.

En despliegues donde ese archivo no exista, el servidor puede generarlo en runtime con estas variables:

- `FIREBASE_API_KEY`
- `FIREBASE_AUTH_DOMAIN`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_STORAGE_BUCKET`
- `FIREBASE_MESSAGING_SENDER_ID`
- `FIREBASE_APP_ID`

Si no se define el archivo privado ni esas variables, la app sigue cargando pero Firebase queda deshabilitado en esa instancia.

## Pruebas

Para correr las pruebas:

```bash
npm test
```

## Estructura general

- `public/`: interfaz, páginas y scripts del frontend
- `server/`: servidor, rutas y lógica principal
- `server/tests/`: pruebas automáticas
- `uploads/`: archivos subidos

## Funciones principales del sistema

### POS

- Buscar productos
- Agregar al carrito
- Registrar ventas
- Guardar presupuestos
- Soporte con teclado y atajos

### Administración

- Configurar empresa
- Ajustar tasas
- Manejar políticas de descuento
- Configurar nota o comprobantes

### Licencias

- Control por empresa
- Estados como activa, morosa o suspendida
- Alertas de cobro y días de gracia

## Notas útiles

- El sistema puede trabajar con datos locales.
- Algunas funciones siguen operando aun si la conexión falla.
- Hay un panel superadmin para administrar empresas y licencias.

## Recomendación

Si vas a usar este proyecto en producción, revisa antes:

- credenciales iniciales
- configuración de Firebase
- ruta de la base de datos
- backups
