// Contenedor de toasts y utilidades pequeñas usadas por la UI
const toastContainer = document.createElement('div');
toastContainer.id = 'toast-container';
toastContainer.style.position = 'fixed';
toastContainer.style.top = '0.75rem';
toastContainer.style.right = '1rem';
toastContainer.style.display = 'flex';
toastContainer.style.flexDirection = 'column';
toastContainer.style.alignItems = 'stretch';
toastContainer.style.gap = '0.75rem';
toastContainer.style.zIndex = '60';
toastContainer.style.maxWidth = '480px';
toastContainer.style.pointerEvents = 'none';
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
    const safeText = String(text ?? '');

    let bg = '#e0f2fe';
    let border = '#0ea5e9';
    let fg = '#075985';
    let iconBg = '#0ea5e9';
    let title = 'Información';
    let iconChar = 'i';

    if (type === 'success') {
        bg = '#dcfce7';
        border = '#16a34a';
        fg = '#166534';
        iconBg = '#16a34a';
        title = 'Operación exitosa';
        iconChar = '✓';
    } else if (type === 'error') {
        bg = '#fee2e2';
        border = '#dc2626';
        fg = '#b91c1c';
        iconBg = '#dc2626';
        title = 'Error';
        iconChar = '!';
    } else if (type === 'warning') {
        bg = '#fef3c7';
        border = '#f59e0b';
        fg = '#92400e';
        iconBg = '#f59e0b';
        title = 'Atención';
        iconChar = '!';
    }

    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.style.width = '100%';
    t.style.maxWidth = '640px';
    t.style.margin = '0 auto';
    t.style.backgroundColor = bg;
    t.style.border = `1px solid ${border}`;
    t.style.borderRadius = '0.75rem';
    t.style.boxShadow = '0 18px 40px rgba(15,23,42,0.18)';
    t.style.padding = '0.75rem 1rem';
    t.style.color = fg;
    t.style.display = 'flex';
    t.style.alignItems = 'flex-start';
    t.style.gap = '0.75rem';
    t.style.cursor = 'pointer';
    t.style.transform = 'translateY(-8px)';
    t.style.opacity = '0';
    t.style.transition = 'transform .22s ease, opacity .22s ease';
    t.style.pointerEvents = 'auto';

    const icon = document.createElement('div');
    icon.textContent = iconChar;
    icon.style.flex = '0 0 auto';
    icon.style.width = '32px';
    icon.style.height = '32px';
    icon.style.borderRadius = '999px';
    icon.style.display = 'flex';
    icon.style.alignItems = 'center';
    icon.style.justifyContent = 'center';
    icon.style.backgroundColor = iconBg;
    icon.style.color = '#ffffff';
    icon.style.fontWeight = '700';
    icon.style.fontSize = '18px';

    const content = document.createElement('div');
    content.style.flex = '1 1 auto';

    const titleEl = document.createElement('div');
    titleEl.textContent = title;
    titleEl.style.fontWeight = '700';
    titleEl.style.fontSize = '0.95rem';
    titleEl.style.marginBottom = '2px';

    const bodyEl = document.createElement('div');
    bodyEl.textContent = safeText;
    bodyEl.style.fontSize = '0.85rem';
    bodyEl.style.opacity = '0.95';

    content.appendChild(titleEl);
    content.appendChild(bodyEl);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent = '×';
    closeBtn.style.border = 'none';
    closeBtn.style.background = 'transparent';
    closeBtn.style.color = fg;
    closeBtn.style.fontSize = '1.1rem';
    closeBtn.style.lineHeight = '1';
    closeBtn.style.cursor = 'pointer';
    closeBtn.style.marginLeft = '0.5rem';

    t.appendChild(icon);
    t.appendChild(content);
    t.appendChild(closeBtn);

    toastContainer.appendChild(t);

    const remover = () => {
        t.style.transform = 'translateY(-8px)';
        t.style.opacity = '0';
        setTimeout(() => t.remove(), 200);
    };

    requestAnimationFrame(() => {
        t.style.transform = 'translateY(0)';
        t.style.opacity = '1';
    });

    setTimeout(remover, ms);
    t.addEventListener('click', remover);
    closeBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        remover();
    });
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
