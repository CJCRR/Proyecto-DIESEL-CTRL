// Contenedor de toasts y utilidades pequeñas usadas por la UI
const toastContainer = document.createElement('div');
toastContainer.id = 'toast-container';
toastContainer.style.position = 'fixed';
toastContainer.style.right = '1rem';
toastContainer.style.bottom = '1rem';
toastContainer.style.display = 'flex';
toastContainer.style.flexDirection = 'column';
toastContainer.style.gap = '0.5rem';
toastContainer.style.zIndex = '60';
document.body.appendChild(toastContainer);

// Indicador de carga global (barra superior discreta)
const loaderBar = document.createElement('div');
loaderBar.id = 'global-loader-bar';
loaderBar.style.position = 'fixed';
loaderBar.style.top = '0';
loaderBar.style.left = '0';
loaderBar.style.right = '0';
loaderBar.style.height = '3px';
loaderBar.style.background = 'linear-gradient(90deg,#0ea5e9,#6366f1,#22c55e)';
loaderBar.style.backgroundSize = '200% 100%';
loaderBar.style.transform = 'translateY(-4px)';
loaderBar.style.opacity = '0';
loaderBar.style.transition = 'opacity .2s ease, transform .2s ease';
loaderBar.style.zIndex = '70';
loaderBar.style.pointerEvents = 'none';
document.body.appendChild(loaderBar);

let loaderRefCount = 0;
let loaderShowTimer = null;

export function showGlobalLoader() {
    loaderRefCount += 1;
    if (loaderRefCount === 1) {
        // Mostrar sólo si la operación tarda un poco (evita parpadeos en requests muy rápidos)
        if (loaderShowTimer) clearTimeout(loaderShowTimer);
        loaderShowTimer = setTimeout(() => {
            loaderBar.style.opacity = '1';
            loaderBar.style.transform = 'translateY(0)';
        }, 150);
    }
}

export function hideGlobalLoader() {
    if (loaderRefCount > 0) loaderRefCount -= 1;
    if (loaderRefCount === 0) {
        if (loaderShowTimer) {
            clearTimeout(loaderShowTimer);
            loaderShowTimer = null;
        }
        loaderBar.style.opacity = '0';
        loaderBar.style.transform = 'translateY(-4px)';
    }
}

export const escapeHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export function showToast(text, type = 'info', ms = 3500) {
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.style.minWidth = '200px';
    t.style.padding = '0.6rem 1rem';
    t.style.borderRadius = '0.5rem';
    t.style.color = 'white';
    t.style.boxShadow = '0 6px 18px rgba(0,0,0,0.12)';
    t.style.transform = 'translateY(10px)';
    t.style.opacity = '0';
    t.style.transition = 'transform .18s ease, opacity .18s ease';
    t.style.background = type === 'success' ? '#16a34a' : type === 'error' ? '#dc2626' : '#0369a1';
    t.innerText = text;
    toastContainer.appendChild(t);
    requestAnimationFrame(() => { t.style.transform = 'translateY(0)'; t.style.opacity = '1'; });
    const remover = () => { t.style.transform = 'translateY(10px)'; t.style.opacity = '0'; setTimeout(() => t.remove(), 200); };
    setTimeout(remover, ms);
    t.addEventListener('click', remover);
}

// Exponer en el scope global para compatibilidad con scripts no módulos
try {
    if (typeof window !== 'undefined') {
        window.showToast = window.showToast || showToast;
        window.escapeHtml = window.escapeHtml || escapeHtml;
        window.showGlobalLoader = window.showGlobalLoader || showGlobalLoader;
        window.hideGlobalLoader = window.hideGlobalLoader || hideGlobalLoader;
    }
} catch (e) {}
