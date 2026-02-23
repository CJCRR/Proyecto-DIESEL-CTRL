// Script de mantenimiento para corregir usuario_id de ventas
// basado en el campo de texto "vendedor".
//
// Uso:
//   node server/fix-ventas-vendedor.js

const Database = require('better-sqlite3');
const path = require('path');

// Reutilizamos la misma ruta de database.sqlite que el resto de scripts de mantenimiento
const dbPath = path.join(__dirname, '..', 'database.sqlite');
const db = new Database(dbPath);

function normalizarTexto(s) {
    return (s || '')
        .toString()
        .trim()
        .toLowerCase();
}

function main() {
    // Construir un mapa de posibles nombres/identificadores de usuario -> id
    const usuarios = db.prepare(`
    SELECT id, username, nombre_completo
    FROM usuarios
  `).all();

    if (!usuarios.length) {
        console.log('No hay usuarios en la tabla usuarios. Nada que hacer.');
        return;
    }

    const map = new Map();
    for (const u of usuarios) {
        const claves = new Set();
        if (u.username) claves.add(normalizarTexto(u.username));
        if (u.nombre_completo) claves.add(normalizarTexto(u.nombre_completo));
        // También separar por espacios y registrar la primera palabra, por si el vendedor se guardó abreviado
        if (u.nombre_completo) {
            const partes = normalizarTexto(u.nombre_completo).split(/\s+/).filter(Boolean);
            if (partes.length) claves.add(partes[0]);
        }
        for (const k of claves) {
            if (!k) continue;
            if (!map.has(k)) {
                map.set(k, u.id);
            }
        }
    }

    console.log('Claves de mapeo de usuarios construidas:', map.size);

    const ventas = db.prepare(`
    SELECT id, vendedor, usuario_id
    FROM ventas
    WHERE vendedor IS NOT NULL AND TRIM(vendedor) != ''
  `).all();

    if (!ventas.length) {
        console.log('No hay ventas con campo vendedor relleno. Nada que corregir.');
        return;
    }

    const updateStmt = db.prepare('UPDATE ventas SET usuario_id = ? WHERE id = ?');
    let corregidas = 0;
    let yaCorrectas = 0;
    let sinMatch = 0;

    const tx = db.transaction(() => {
        for (const v of ventas) {
            const vendedorNorm = normalizarTexto(v.vendedor);
            if (!vendedorNorm) {
                continue;
            }

            const nuevoUsuarioId = map.get(vendedorNorm);
            if (!nuevoUsuarioId) {
                sinMatch += 1;
                continue;
            }

            if (v.usuario_id === nuevoUsuarioId) {
                yaCorrectas += 1;
                continue;
            }

            updateStmt.run(nuevoUsuarioId, v.id);
            corregidas += 1;
        }
    });

    tx();

    console.log('Ventas procesadas:', ventas.length);
    console.log('Ventas ya correctas (usuario_id coincide con vendedor):', yaCorrectas);
    console.log('Ventas corregidas (usuario_id actualizado según vendedor):', corregidas);
    console.log('Ventas sin coincidencia clara de vendedor en usuarios:', sinMatch);
}

main();
