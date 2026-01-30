export const authFetch = (url, options = {}) => fetch(url, { ...options, credentials: 'same-origin' });

export async function apiFetchJson(url, options = {}) {
    if (!navigator.onLine) throw new Error('Sin conexión a internet');
    const res = await authFetch(url, options);
    const contentType = res.headers.get('content-type') || '';
    let data = null;
    if (contentType.includes('application/json')) {
        data = await res.json().catch(() => null);
    } else {
        data = await res.text().catch(() => null);
    }
    if (!res.ok) {
        const msg = (data && data.error) ? data.error : (typeof data === 'string' && data) ? data : `HTTP ${res.status}`;
        throw new Error(msg);
    }
    return data;
}
