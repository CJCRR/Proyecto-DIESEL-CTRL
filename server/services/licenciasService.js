// Servicio centralizado para lógica de licencias y suspensión de empresas

/**
 * Determina si una empresa debe estar suspendida según su estado,
 * fecha de próximo cobro y días de gracia.
 * 
 * @param {string|null} estadoActual - Estado actual de la empresa ('activa', 'suspendida', etc.)
 * @param {string|null} proximoCobroStr - Fecha ISO del próximo cobro
 * @param {number|null|undefined} diasGracia - Días de gracia después del vencimiento
 * @returns {boolean} - true si la empresa debe estar suspendida
 */
function debeSuspenderEmpresa(estadoActual, proximoCobroStr, diasGracia) {
    // Si ya está suspendida manualmente, se respeta
    if (estadoActual === 'suspendida') return true;

    if (!proximoCobroStr) return false;

    const proximoCobro = new Date(proximoCobroStr);
    if (Number.isNaN(proximoCobro.getTime())) return false;

    const dias = Number.isFinite(Number(diasGracia)) ? Number(diasGracia) : 0;
    const hoy = new Date();
    const limiteGracia = new Date(proximoCobro.getTime());
    limiteGracia.setDate(limiteGracia.getDate() + dias);

    // Suspender si hoy está después del límite de gracia
    return hoy > limiteGracia;
}

/**
 * Obtiene el estado real de una empresa, aplicando lógica de suspensión automática.
 * Útil para verificar antes de operaciones críticas.
 * 
 * @param {number} empresaId - ID de la empresa
 * @param {object} db - Instancia de better-sqlite3
 * @returns {{suspendida: boolean, estado: string, mensaje: string|null}}
 */
function obtenerEstadoLicencia(empresaId, db) {
    if (!empresaId || !db) {
        return { suspendida: false, estado: 'desconocido', mensaje: null };
    }

    const empresa = db.prepare(
        'SELECT id, estado, proximo_cobro, dias_gracia FROM empresas WHERE id = ?'
    ).get(empresaId);

    if (!empresa) {
        return { suspendida: false, estado: 'no_encontrada', mensaje: 'Empresa no encontrada' };
    }

    const estadoActual = (empresa.estado || '').toString().toLowerCase() || 'activa';
    const suspendida = debeSuspenderEmpresa(estadoActual, empresa.proximo_cobro, empresa.dias_gracia);

    // Si debe suspenderse pero no está marcada, actualizar en BD
    if (suspendida && estadoActual !== 'suspendida') {
        try {
            db.prepare(
                "UPDATE empresas SET estado = 'suspendida', actualizado_en = datetime('now') WHERE id = ?"
            ).run(empresa.id);
        } catch (e) {
            // No crítico, solo loguear
            console.warn('No se pudo persistir suspensión automática:', e.message);
        }
    }

    return {
        suspendida,
        estado: suspendida ? 'suspendida' : estadoActual,
        mensaje: suspendida
            ? 'Empresa suspendida por vencimiento de licencia'
            : null
    };
}

module.exports = {
    debeSuspenderEmpresa,
    obtenerEstadoLicencia
};