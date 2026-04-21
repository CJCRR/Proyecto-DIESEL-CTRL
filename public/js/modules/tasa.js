/**
 * Módulo de tasa BCV para el POS.
 * Extraído de app.js para mantener la responsabilidad única.
 * Gestiona: estado local, carga desde API, cache en localStorage y actualización manual.
 */
import { apiFetchJson } from '../app-api.js';
import { showToast } from '../app-utils.js';
import { formatNumber } from '../format-utils.js';
import { actualizarTabla } from './cart.js';

let TASA_BCV_POS = 1;
let TASA_BCV_UPDATED_POS = null;

export function getTasaBcv() { return TASA_BCV_POS; }

export function setTasaUI(tasa, actualizadoEn) {
    TASA_BCV_POS = Number(tasa || 1) || 1;
    if (actualizadoEn) TASA_BCV_UPDATED_POS = actualizadoEn;
    try {
        localStorage.setItem('tasa_bcv', String(TASA_BCV_POS));
        if (TASA_BCV_UPDATED_POS) localStorage.setItem('tasa_bcv_updated', TASA_BCV_UPDATED_POS);
    } catch {}
    const input = document.getElementById('v_tasa');
    if (input) {
        input.value = TASA_BCV_POS.toFixed(2);
        actualizarTabla();
    }
    const kpi = document.getElementById('pv-kpi-tasa');
    if (kpi) kpi.textContent = formatNumber(TASA_BCV_POS, 2);
    const alertEl = document.getElementById('pv-tasa-alert');
    if (alertEl) {
        const diffHrs = TASA_BCV_UPDATED_POS ? (Date.now() - new Date(TASA_BCV_UPDATED_POS).getTime()) / 36e5 : null;
        const show = diffHrs !== null && diffHrs > 8;
        alertEl.classList.toggle('hidden', !show);
        if (show) alertEl.textContent = `Tasa sin actualizar hace ${diffHrs.toFixed(1)}h`;
    }
}

export async function cargarTasaPV() {
    try {
        const j = await apiFetchJson('/admin/ajustes/tasa-bcv');
        setTasaUI(j.tasa_bcv, j.actualizado_en);
    } catch (err) {
        console.warn('No se pudo cargar tasa BCV', err);
    }
}

export function precargarTasaCache() {
    try {
        const cached = localStorage.getItem('tasa_bcv');
        const cachedUpdated = localStorage.getItem('tasa_bcv_updated');
        if (cached) setTasaUI(Number(cached), cachedUpdated || null);
    } catch {}
}

export async function actualizarTasaPV() {
    const val = parseFloat(document.getElementById('v_tasa')?.value || '');

    // Si hay un valor válido en el input, guardar manualmente; si no, actualizar automático
    if (!Number.isNaN(val) && val > 0) {
        try {
            const j = await apiFetchJson('/admin/ajustes/tasa-bcv', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tasa_bcv: val }),
            });
            setTasaUI(j.tasa_bcv ?? val, j.actualizado_en || new Date().toISOString());
            showToast('Tasa guardada', 'success');
        } catch (err) {
            showToast('Error guardando tasa', 'error');
        }
        return;
    }

    // Modo auto-actualizar desde BCV
    try {
        const j = await apiFetchJson('/admin/ajustes/tasa-bcv/actualizar', { method: 'POST' });
        const tasa = Number(j.tasa_bcv || 0);
        if (tasa > 0) {
            setTasaUI(tasa, j.actualizado_en || new Date().toISOString());
            showToast('Tasa actualizada', 'success');
        }
    } catch (err) {
        showToast('Error actualizando tasa', 'error');
    }
}
