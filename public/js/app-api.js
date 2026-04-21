import { showGlobalLoader, hideGlobalLoader } from './app-utils.js';

export const authFetch = (url, options = {}) => fetch(url, { ...options, credentials: 'same-origin' });

export async function apiFetchJson(url, options = {}) {
    if (!navigator.onLine) throw new Error('Sin conexión a internet');
    showGlobalLoader();
    try {
        const res = await authFetch(url, options);
        const contentType = res.headers.get('content-type') || '';
        let data = null;
        if (contentType.includes('application/json')) {
            data = await res.json().catch(() => null);
        } else {
            data = await res.text().catch(() => null);
        }
        if (!res.ok) {
            const baseMsg = (data && data.error) ? data.error : (typeof data === 'string' && data) ? data : `HTTP ${res.status}`;
            const err = new Error(baseMsg);
            // Exponer siempre el código de error del backend para que el frontend
            // pueda mostrar mensajes específicos según el tipo de error
            err.code = (data && typeof data === 'object' && data.code) ? data.code : `HTTP_${res.status}`;
            err.status = res.status;
            throw err;
        }
        return data;
    } finally {
        hideGlobalLoader();
    }
}
