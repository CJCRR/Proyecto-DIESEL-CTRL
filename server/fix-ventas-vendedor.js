// Script de mantenimiento para sincronizar el campo de texto
// ventas.vendedor con el usuario real (ventas.usuario_id).
//
// Útil para corregir casos donde se quedó grabado, por ejemplo,
// "adminalpha" aunque la venta pertenece a otro usuario.
//
// Uso desde la raíz del proyecto:
//   node server/fix-ventas-vendedor.js

const db = require('./db');

function main() {
    const totales = db.prepare(`
        SELECT
            COUNT(*)                         AS total,
            SUM(CASE WHEN usuario_id IS NOT NULL THEN 1 ELSE 0 END) AS con_usuario
        FROM ventas
    `).get();

    console.log('Ventas totales en la base:', totales.total);
    console.log('Ventas con usuario_id asignado:', totales.con_usuario);

    if (!totales.con_usuario) {
        console.log('No hay ventas con usuario_id. Nada que hacer.');
        return;
    }

    // Sincroniza ventas.vendedor con el nombre del usuario asociado.
    // Prioriza nombre_completo y, si no existe, usa username.
    const stmt = db.prepare(`
        UPDATE ventas
        SET vendedor = (
            SELECT COALESCE(u.nombre_completo, u.username, ventas.vendedor)
            FROM usuarios u
            WHERE u.id = ventas.usuario_id
        )
        WHERE usuario_id IS NOT NULL
    `);

    const info = stmt.run();

    console.log('Ventas actualizadas (vendedor sincronizado con usuario):', info.changes);
    console.log('Listo. Revisa ahora tus reportes de ventas.');
}

main();
