// Script para revisar y corregir el nombre de la empresa en la base de datos
// Ejecuta este archivo con: node fix-empresa-config.js

const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'database.sqlite');
const db = new Database(dbPath);

const NOMBRE_CORRECTO = 'PERROLOCO, C.A';

function fixEmpresaConfig() {
  const row = db.prepare("SELECT valor FROM config WHERE clave='empresa_config'").get();
  let empresa = {};
  if (row && row.valor) {
    try {
      empresa = JSON.parse(row.valor);
    } catch (e) {
      console.error('El JSON de empresa_config está corrupto. Se sobreescribirá.');
      empresa = {};
    }
  }
  if (empresa.nombre !== NOMBRE_CORRECTO) {
    empresa.nombre = NOMBRE_CORRECTO;
    const nuevoValor = JSON.stringify(empresa);
    db.prepare("INSERT OR REPLACE INTO config (clave, valor, actualizado_en) VALUES ('empresa_config', ?, datetime('now'))").run(nuevoValor);
    console.log('Nombre de empresa corregido a:', NOMBRE_CORRECTO);
  } else {
    console.log('El nombre de empresa ya es correcto:', empresa.nombre);
  }
}

fixEmpresaConfig();
