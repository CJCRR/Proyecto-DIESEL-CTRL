import { apiFetchJson } from './app-api.js';

(function () {
    const defaults = {
        color_primario: '#2563eb',
        color_secundario: '#0f172a',
        color_acento: '#f97316'
    };

    function applyVars(empresa = {}) {
        const root = document.documentElement;
        const p = empresa.color_primario || defaults.color_primario;
        const s = empresa.color_secundario || defaults.color_secundario;
        const a = empresa.color_acento || defaults.color_acento;
        root.style.setProperty('--brand-primary', p);
        root.style.setProperty('--brand-secondary', s);
        root.style.setProperty('--brand-accent', a);
    }

    function applyBrandingDom(branding = {}) {
        const titulo = (branding.titulo || 'DIESEL CTRL').toString().trim() || 'DIESEL CTRL';
        const drawerNombre = (branding.drawer_nombre || branding.titulo || 'Diesel Ctrl').toString().trim() || titulo;

        const mainTitleEl = document.getElementById('brand-main-title');
        if (mainTitleEl) {
            mainTitleEl.textContent = titulo;
        }

        const drawerNameEl = document.getElementById('drawer-app-name');
        if (drawerNameEl) {
            drawerNameEl.textContent = drawerNombre;
        }

        const footerEl = document.getElementById('global-footer-branding');
        if (footerEl) {
            const year = new Date().getFullYear();
            footerEl.textContent = `© ${year} ${titulo}. Sistema de gestión de ventas.`;
        }

        if (typeof document !== 'undefined' && document.title) {
            let t = document.title;
            const patterns = [
                /Diesel[-\s]*CTRL/gi,
                /Diesel[-\s]*Ctrl/gi,
                /DIESEL[-\s]*CTRL/gi
            ];
            patterns.forEach((re) => {
                t = t.replace(re, titulo);
            });
            document.title = t;
        }
    }

    async function loadAndApplyEmpresaTheme() {
        if (window.location.pathname.includes('/pages/login.html')) return;
        // Usa cache local si existe
        try {
            const cached = localStorage.getItem('empresa_config');
            if (cached) {
                const empresa = JSON.parse(cached);
                applyVars(empresa);
            }
        } catch {}

        try {
            const data = await apiFetchJson('/admin/ajustes/config');
            if (data?.empresa) {
                applyVars(data.empresa);
                try { localStorage.setItem('empresa_config', JSON.stringify(data.empresa)); } catch {}
            }
        } catch (err) {
            console.warn('No se pudo aplicar tema de empresa', err?.message || err);
        }
    }

    async function loadAndApplyBranding() {
        try {
            const data = await apiFetchJson('/admin/ajustes/branding');
            if (data && (data.titulo || data.drawer_nombre)) {
                applyBrandingDom(data);
            }
        } catch (err) {
            console.warn('No se pudo aplicar branding global', err?.message || err);
        }
    }

    loadAndApplyEmpresaTheme();
    loadAndApplyBranding();
})();
