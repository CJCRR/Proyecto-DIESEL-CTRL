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

    async function loadAndApply() {
        // Usa cache local si existe
        try {
            const cached = localStorage.getItem('empresa_config');
            if (cached) {
                const empresa = JSON.parse(cached);
                applyVars(empresa);
            }
        } catch {}

        try {
            const token = localStorage.getItem('auth_token');
            const res = await fetch('/admin/ajustes/config', {
                headers: token ? { 'Authorization': `Bearer ${token}` } : {}
            });
            if (!res.ok) return;
            const data = await res.json();
            if (data?.empresa) {
                applyVars(data.empresa);
                try { localStorage.setItem('empresa_config', JSON.stringify(data.empresa)); } catch {}
            }
        } catch (err) {
            console.warn('No se pudo aplicar tema de empresa', err.message);
        }
    }

    loadAndApply();
})();
