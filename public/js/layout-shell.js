// layout-shell.js - genera header, drawer y footer comunes para todas las páginas

(function () {
    function getPageConfigFromLocation() {
        try {
            const path = window.location?.pathname || '';
            const map = {
                '/pos': {
                    pageId: 'pos',
                    subtitle: 'Sistema de control de ventas',
                    iconClass: 'fa-truck',
                },
                '/inventario': {
                    pageId: 'inventario',
                    subtitle: 'Inventario',
                    iconClass: 'fa-boxes-stacked',
                },
                '/dashboard': {
                    pageId: 'dashboard',
                    subtitle: 'Panel de control',
                    iconClass: 'fa-truck',
                },
                '/clientes': {
                    pageId: 'clientes',
                    subtitle: 'Gestión de clientes',
                    iconClass: 'fa-user-friends',
                },
                '/reportes': {
                    pageId: 'reportes',
                    subtitle: 'Reportes',
                    iconClass: 'fa-file-invoice',
                },
                '/cobranzas': {
                    pageId: 'cobranzas',
                    subtitle: 'Cobranzas',
                    iconClass: 'fa-file-invoice-dollar',
                },
                '/proveedores': {
                    pageId: 'proveedores',
                    subtitle: 'Proveedores',
                    iconClass: 'fa-people-carry-box',
                },
                '/compras': {
                    pageId: 'compras',
                    subtitle: 'Compras / ingresos',
                    iconClass: 'fa-truck-loading',
                },
                '/usuarios': {
                    pageId: 'usuarios',
                    subtitle: 'Usuarios',
                    iconClass: 'fa-user-cog',
                },
                '/ajustes': {
                    pageId: 'ajustes',
                    subtitle: 'Ajustes del sistema',
                    iconClass: 'fa-gear',
                },
                '/admin-empresas': {
                    pageId: 'admin-empresas',
                    subtitle: 'Empresas',
                    iconClass: 'fa-building',
                },
                '/terminos': {
                    pageId: 'terminos',
                    subtitle: 'Términos y Condiciones',
                    iconClass: 'fa-scale-balanced',
                },
            };
            return map[path] || { pageId: '', subtitle: 'Sistema de gestión de ventas', iconClass: 'fa-truck' };
        } catch {
            return { pageId: '', subtitle: 'Sistema de gestión de ventas', iconClass: 'fa-truck' };
        }
    }

    function buildHeaderHtml(config) {
        const subtitle = config.subtitle || 'Sistema de gestión de ventas';
        const iconClass = config.iconClass || 'fa-truck';
        return (
            '<nav class="bg-gradient-to-r from-slate-900 via-slate-900 to-slate-800 text-white shadow-lg shadow-slate-900/40 border-b border-slate-800/60">' +
            '<div class="container mx-auto px-4 py-3 flex items-center justify-between gap-4">' +
            '<div class="flex items-center gap-3">' +
            '<button id="btn-menu"' +
            ' class="h-11 w-11 rounded-2xl bg-white/5 hover:bg-white/10 transition flex items-center justify-center text-white shadow-lg shadow-black/40 ring-1 ring-white/10">' +
            '<label class="burger" for="nav-burger">' +
            '<input type="checkbox" id="nav-burger" />' +
            '<span></span>' +
            '<span></span>' +
            '<span></span>' +
            '</label>' +
            '</button>' +
            '<div class="flex items-center gap-3">' +
            '<div class="h-10 w-10 rounded-2xl bg-blue-500/15 flex items-center justify-center ring-1 ring-blue-400/40 shadow-md shadow-blue-900/40">' +
            '<i class="fas ' +
            iconClass +
            ' text-lg text-blue-400"></i>' +
            '</div>' +
            '<div>' +
            '<h1 id="brand-main-title" class="text-base sm:text-lg font-extrabold tracking-tight">NEXA <span class="text-blue-400">CTRL</span></h1>' +
            '<p class="hidden sm:block text-[11px] uppercase tracking-[0.2em] text-slate-300/80 font-semibold">' +
            subtitle +
            '</p>' +
            '</div>' +
            '</div>' +
            '</div>' +
            '<div class="flex items-center gap-3">' +
            '<div id="dash-period-container" class="hidden sm:flex items-center gap-1 text-[11px] text-slate-100"></div>' +
            '<div id="app-session-status" class="hidden sm:inline-flex items-center gap-2 px-3 py-1 rounded-full border border-slate-600/60 bg-slate-900/60 text-[11px] font-medium text-slate-100">' +
            '<span id="app-session-status-dot" class="h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-inner"></span>' +
            '<span id="app-session-status-text">Sesión activa</span>' +
            '</div>' +
            '<a href="/ajustes" title="Ajustes"' +
            ' class="admin-only-gear h-9 w-9 rounded-full bg-white/5 hover:bg-white/10 transition flex items-center justify-center text-white shadow-md shadow-black/40 border border-white/10">' +
            '<i class="fas fa-gear text-sm"></i>' +
            '</a>' +
            '</div>' +
            '</div>' +
            '</nav>'
        );
    }

    function buildDrawerHtml() {
        return (
            '<div id="drawer-backdrop" class="fixed inset-0 bg-black/40 backdrop-blur-sm hidden z-40"></div>' +
            '<aside id="drawer"' +
            ' class="fixed inset-y-0 left-0 w-72 max-w-[80vw] bg-white shadow-2xl shadow-black/30 -translate-x-full transition-transform duration-200 z-50 flex flex-col">' +
            '<div class="p-5 flex items-center justify-between border-b border-slate-100">' +
            '<div>' +
            '<p class="text-xs uppercase font-black text-slate-400 tracking-widest">Navegación</p>' +
            '<p id="drawer-app-name" class="text-lg font-black text-slate-800">Nexa CTRL</p>' +
            '</div>' +
            '<button id="drawer-close"' +
            ' class="h-9 w-9 flex items-center justify-center rounded-lg bg-slate-100 hover:bg-slate-200 transition">' +
            '<i class="fas fa-xmark text-slate-500"></i>' +
            '</button>' +
            '</div>' +
            '<nav class="flex-1 p-4 space-y-2 text-sm font-semibold text-slate-700"><!-- nav generado por layout-nav.js --></nav>' +
            '<div class="p-4 border-t border-slate-100 text-xs text-slate-500">' +
            '<p class="font-semibold">Atajos rápidos</p>' +
            '<p class="mt-1">Presione ESC para cerrar.</p>' +
            '</div>' +
            '</aside>'
        );
    }

    function buildFooterHtml() {
        return (
            '<footer class="border-t border-slate-200 mt-8 py-4 text-xs text-slate-400">' +
            '<div class="container mx-auto px-4 relative flex items-center justify-center">' +
            '<p id="global-footer-branding" class="text-center">© 2026 Nexa CTRL. Sistema de gestión de ventas.</p>' +
            '<p class="hidden sm:block absolute right-0 text-right">' +
            '<a href="/terminos" class="hover:underline">Términos y Condiciones</a>' +
            '<span class="mx-1">·</span>' +
            '<a href="/terminos" class="hover:underline">Política de Privacidad</a>' +
            '</p>' +
            '</div>' +
            '</footer>'
        );
    }

    function ensureBodyLayoutClasses() {
        try {
            const body = document.body;
            if (!body) return;
            const classes = ['bg-slate-50', 'text-slate-900', 'min-h-screen', 'flex', 'flex-col'];
            classes.forEach((cls) => {
                if (!body.classList.contains(cls)) body.classList.add(cls);
            });
        } catch (e) {
            console.error('Error asegurando clases de layout en body', e);
        }
    }

    function initAppShell(customConfig) {
        try {
            if (typeof document === 'undefined') return;
            const baseConfig = getPageConfigFromLocation();
            const config = Object.assign({}, baseConfig, customConfig || {});

            ensureBodyLayoutClasses();

            const headerHtml = buildHeaderHtml(config);
            const drawerHtml = buildDrawerHtml();
            const footerHtml = buildFooterHtml();

            const body = document.body;
            if (!body) return;

            // Insert header + drawer al inicio
            body.insertAdjacentHTML('afterbegin', headerHtml + drawerHtml);
            // Insert footer al final
            body.insertAdjacentHTML('beforeend', footerHtml);
        } catch (err) {
            console.error('Error inicializando app shell', err);
        }
    }

    if (typeof window !== 'undefined') {
        window.AppLayout = {
            init: initAppShell,
        };
        document.addEventListener('DOMContentLoaded', function () {
            // Inicialización automática con config por ruta
            initAppShell();
        });
    }
})();
