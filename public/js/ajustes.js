import { borrarClientesFirebaseTodos, borrarVentasFirebaseTodas } from './firebase-sync.js';

let configCache = { empresa: {}, descuentos_volumen: [], devolucion: {}, nota: {} };

const toastContainer = document.getElementById('toast-container');
function showToast(msg, type = 'info') {
    if (!toastContainer) return alert(msg);
    const el = document.createElement('div');
    el.className = `px-3 py-2 rounded-lg text-white shadow ${type === 'error' ? 'bg-rose-500' : type === 'success' ? 'bg-emerald-600' : 'bg-slate-800'}`;
    el.textContent = msg;
    toastContainer.appendChild(el);
    setTimeout(() => el.remove(), 3000);
}

function bindDrawer() {
    const drawer = document.getElementById('drawer');
    const backdrop = document.getElementById('drawer-backdrop');
    const btnMenu = document.getElementById('btn-menu');
    const btnClose = document.getElementById('drawer-close');
    const open = () => { drawer?.classList.remove('-translate-x-full'); backdrop?.classList.remove('hidden'); };
    const close = () => { drawer?.classList.add('-translate-x-full'); backdrop?.classList.add('hidden'); };
    btnMenu?.addEventListener('click', open);
    btnClose?.addEventListener('click', close);
    backdrop?.addEventListener('click', close);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
}

function renderTiers(list = []) {
    const cont = document.getElementById('tiers');
    if (!cont) return;
    cont.innerHTML = '';
    const tiers = list.length ? list : [{ min_qty: 10, descuento_pct: 5 }];
    tiers.forEach((t, idx) => {
        const row = document.createElement('div');
        row.className = 'grid grid-cols-5 gap-2 items-center text-sm border p-2 rounded-xl';
        row.innerHTML = `
            <div class="col-span-2 flex items-center gap-2">
                <span class="text-[11px] text-slate-500">Cantidad mínima</span>
                <input type="number" min="1" class="p-2 border rounded w-full" data-tier="min" value="${t.min_qty || ''}">
            </div>
            <div class="col-span-2 flex items-center gap-2">
                <span class="text-[11px] text-slate-500">Descuento %</span>
                <input type="number" min="0" max="100" step="0.5" class="p-2 border rounded w-full" data-tier="pct" value="${t.descuento_pct || ''}">
            </div>
            <div class="flex justify-end">
                <button class="px-2 py-1 text-xs border rounded" data-tier="remove" data-idx="${idx}">Eliminar</button>
            </div>
        `;
        cont.appendChild(row);
    });
    cont.querySelectorAll('button[data-tier="remove"]').forEach(btn => {
        btn.addEventListener('click', () => {
            const idx = parseInt(btn.dataset.idx, 10);
            const current = getTiersFromDOM();
            current.splice(idx, 1);
            renderTiers(current);
        });
    });
}

function getTiersFromDOM() {
    const cont = document.getElementById('tiers');
    if (!cont) return [];
    const rows = Array.from(cont.querySelectorAll('[data-tier="min"]'));
    return rows.map((inp, idx) => {
        const min = parseInt(inp.value, 10) || 0;
        const pctInp = cont.querySelectorAll('[data-tier="pct"]')[idx];
        const pct = parseFloat(pctInp?.value || '0') || 0;
        return { min_qty: min, descuento_pct: pct };
    }).filter(t => t.min_qty > 0 && t.descuento_pct > 0);
}

function readForms() {
    const empresa = {
        nombre: document.getElementById('e_nombre')?.value.trim() || '',
        logo_url: document.getElementById('e_logo')?.value.trim() || '',
        color_primario: document.getElementById('e_color_primario')?.value || '#2563eb',
        color_secundario: document.getElementById('e_color_secundario')?.value || '#0f172a',
        color_acento: document.getElementById('e_color_acento')?.value || '#f97316',
    };
    const descuentos_volumen = getTiersFromDOM();
    const devolucion = {
        habilitado: !!document.getElementById('d_habilitado')?.checked,
        dias_max: parseInt(document.getElementById('d_dias')?.value, 10) || 0,
        recargo_restock_pct: parseFloat(document.getElementById('d_restock')?.value || '0') || 0,
        requiere_referencia: true
    };
    const marcasRaw = (document.getElementById('n_marcas')?.value || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    const nota = {
        header_logo_url: document.getElementById('n_logo')?.value.trim() || '',
        layout: document.getElementById('n_layout')?.value || 'compact',
        rif: document.getElementById('n_rif')?.value.trim() || '',
        telefonos: document.getElementById('n_telefonos')?.value.trim() || '',
        ubicacion: document.getElementById('n_ubicacion')?.value.trim() || '',
        encabezado_texto: document.getElementById('n_encabezado')?.value.trim() || '¡Tu Proveedor de Confianza!',
        resaltar_color: document.getElementById('n_resaltar')?.value || '#fff59d',
        brand_logos: marcasRaw,
        terminos: document.getElementById('n_terminos')?.value.trim() || '',
        pie: document.getElementById('n_pie')?.value.trim() || 'Total a Pagar:',
        pie_usd: document.getElementById('n_pie_usd')?.value.trim() || 'Total USD',
        pie_bs: document.getElementById('n_pie_bs')?.value.trim() || 'Total Bs',
        iva_pct: parseFloat(document.getElementById('n_iva')?.value || '0') || 0
    };
    return { empresa, descuentos_volumen, devolucion, nota };
}

function setForms(cfg) {
    const { empresa = {}, descuentos_volumen = [], devolucion = {}, nota = {} } = cfg || {};
    if (document.getElementById('e_nombre')) document.getElementById('e_nombre').value = empresa.nombre || '';
    if (document.getElementById('e_logo')) document.getElementById('e_logo').value = empresa.logo_url || '';
    if (document.getElementById('e_color_primario')) document.getElementById('e_color_primario').value = empresa.color_primario || '#2563eb';
    if (document.getElementById('e_color_secundario')) document.getElementById('e_color_secundario').value = empresa.color_secundario || '#0f172a';
    if (document.getElementById('e_color_acento')) document.getElementById('e_color_acento').value = empresa.color_acento || '#f97316';
    renderTiers(descuentos_volumen);
    if (document.getElementById('d_habilitado')) document.getElementById('d_habilitado').checked = devolucion.habilitado !== false;
    if (document.getElementById('d_dias')) document.getElementById('d_dias').value = devolucion.dias_max ?? 30;
    if (document.getElementById('d_restock')) document.getElementById('d_restock').value = devolucion.recargo_restock_pct ?? 0;

    // Nota
    if (document.getElementById('n_logo')) document.getElementById('n_logo').value = nota.header_logo_url || '';
    if (document.getElementById('n_layout')) document.getElementById('n_layout').value = nota.layout || 'compact';
    if (document.getElementById('n_rif')) document.getElementById('n_rif').value = nota.rif || '';
    if (document.getElementById('n_telefonos')) document.getElementById('n_telefonos').value = nota.telefonos || '';
    if (document.getElementById('n_ubicacion')) document.getElementById('n_ubicacion').value = nota.ubicacion || '';
    if (document.getElementById('n_encabezado')) document.getElementById('n_encabezado').value = nota.encabezado_texto || '';
    if (document.getElementById('n_resaltar')) document.getElementById('n_resaltar').value = nota.resaltar_color || '#fff59d';
    if (document.getElementById('n_marcas')) document.getElementById('n_marcas').value = Array.isArray(nota.brand_logos) ? nota.brand_logos.join('\n') : '';
    if (document.getElementById('n_terminos')) document.getElementById('n_terminos').value = nota.terminos || '';
    if (document.getElementById('n_pie')) document.getElementById('n_pie').value = nota.pie || 'Total a Pagar:';
    if (document.getElementById('n_pie_usd')) document.getElementById('n_pie_usd').value = nota.pie_usd || 'Total USD';
    if (document.getElementById('n_pie_bs')) document.getElementById('n_pie_bs').value = nota.pie_bs || 'Total Bs';
    if (document.getElementById('n_iva')) document.getElementById('n_iva').value = (nota.iva_pct ?? 0);
}

async function loadConfig() {
    try {
        const res = await fetch('/admin/ajustes/config', { credentials: 'same-origin' });
        if (!res.ok) throw new Error('No se pudo cargar configuración');
        const data = await res.json();
        configCache = data;
        setForms(data);
    } catch (err) {
        showToast(err.message || 'Error cargando ajustes', 'error');
    }
}

async function saveConfig(section) {
    try {
        const payload = readForms();
        // Mantener datos previos por si alguna sección no se usa
        payload.empresa = { ...configCache.empresa, ...payload.empresa };
        payload.descuentos_volumen = payload.descuentos_volumen.length ? payload.descuentos_volumen : configCache.descuentos_volumen || [];
        payload.devolucion = { ...configCache.devolucion, ...payload.devolucion };
        payload.nota = { ...configCache.nota, ...payload.nota };

        const res = await fetch('/admin/ajustes/config', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error('No se pudo guardar ajustes');
        const data = await res.json();
        configCache = data;
        try { localStorage.setItem('nota_config', JSON.stringify(data.nota || {})); } catch {}
        showToast('Ajustes guardados', 'success');
    } catch (err) {
        showToast(err.message || 'Error guardando', 'error');
    }
}

function setupUI() {
    bindDrawer();
    document.getElementById('btnAddTier')?.addEventListener('click', () => {
        const current = getTiersFromDOM();
        current.push({ min_qty: 10, descuento_pct: 5 });
        renderTiers(current);
    });
    document.getElementById('btnSaveEmpresa')?.addEventListener('click', () => saveConfig('empresa'));
    document.getElementById('btnSaveDescuentos')?.addEventListener('click', () => saveConfig('descuentos'));
    document.getElementById('btnSaveDevolucion')?.addEventListener('click', () => saveConfig('devolucion'));
        document.getElementById('btnSaveNota')?.addEventListener('click', () => saveConfig('nota'));
        document.getElementById('btnPreviewNota')?.addEventListener('click', renderPreview);
        document.getElementById('btnDemoNota')?.addEventListener('click', printDemoNota);
    document.getElementById('btnUploadLogo')?.addEventListener('click', () => uploadHelper('n_logo'));
    document.getElementById('btnUploadMarca')?.addEventListener('click', () => uploadMarcaHelper());
    document.getElementById('btnPurgeAll')?.addEventListener('click', purgeAllData);
}

window.addEventListener('DOMContentLoaded', () => {
    setupUI();
    loadConfig();
});

function renderPreview() {
        const prev = document.getElementById('nota-preview');
        if (!prev) return;
        const { empresa = {}, nota = {} } = { empresa: configCache.empresa || {}, nota: readForms().nota };
        const brandImgs = (nota.brand_logos || []).map(u => `<img src="${u}" style="height:28px;margin:0 6px;object-fit:contain;"/>`).join('');
        prev.innerHTML = `
            <div style="padding:16px;border-bottom:1px solid #eee;display:flex;align-items:center;justify-content:space-between;gap:12px;">
                <div style="display:flex;align-items:center;gap:12px;">
                    ${nota.header_logo_url ? `<img src="${nota.header_logo_url}" style="height:42px;object-fit:contain;">` : ''}
                    <div style="font-weight:800;letter-spacing:.5px;">${empresa.nombre || 'Empresa'}</div>
                </div>
                <div style="display:flex;align-items:center;gap:8px;">${brandImgs}</div>
            </div>
            <div style="padding:12px;font-size:12px;color:#475569;display:flex;justify-content:space-between;gap:12px;">
                <div>
                    <div><strong>RIF:</strong> ${nota.rif || '—'}</div>
                    <div><strong>Teléfonos:</strong> ${nota.telefonos || '—'}</div>
                    <div><strong>Dirección:</strong> ${nota.ubicacion || '—'}</div>
                </div>
                <div style="text-align:right;max-width:50%">${nota.encabezado_texto || ''}</div>
            </div>
            <div style="padding:12px;border-top:1px dashed #e5e7eb;background:${nota.resaltar_color || '#fff59d'}20">Ejemplo de tabla y totales se verán al imprimir la nota real.</div>
            <div style="padding:12px;border-top:1px solid #eee;font-size:11px;color:#64748b;white-space:pre-line">${nota.terminos || ''}</div>
        `;
}

        async function uploadHelper(targetInputId){
            const file = await pickFile();
            if (!file) return;
            const dataUrl = await fileToDataURL(file);
            const url = await uploadDataUrl(dataUrl, file.name);
            if (!url) return;
            const el = document.getElementById(targetInputId);
            if (el) el.value = url;
            renderPreview();
        }

        async function uploadMarcaHelper(){
            const file = await pickFile();
            if (!file) return;
            const dataUrl = await fileToDataURL(file);
            const url = await uploadDataUrl(dataUrl, file.name);
            if (!url) return;
            const ta = document.getElementById('n_marcas');
            if (ta){ ta.value = (ta.value ? ta.value + '\n' : '') + url; }
            renderPreview();
        }

        function pickFile(){
            return new Promise(resolve => {
                const inp = document.createElement('input');
                inp.type = 'file';
                inp.accept = 'image/png,image/jpeg,image/jpg,image/webp';
                inp.onchange = () => resolve(inp.files && inp.files[0] ? inp.files[0] : null);
                inp.click();
            });
        }

        function fileToDataURL(file){
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(file);
            });
        }

        async function uploadDataUrl(dataUrl, name){
            try {
                const res = await fetch('/admin/ajustes/upload-image', {
                    method: 'POST',
                    credentials: 'same-origin',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ dataUrl, filename: name })
                });
                if (!res.ok) throw new Error('Error subiendo imagen');
                const j = await res.json();
                showToast('Imagen subida', 'success');
                return j.url;
            } catch (err) {
                showToast(err.message || 'Upload falló', 'error');
                return null;
            }
        }

async function ensureNotaTemplateLoaded(layout = 'compact'){
    const targetId = layout === 'standard' ? 'nota-template-lib-std' : 'nota-template-lib-compact';
    const targetSrc = layout === 'standard' ? '/shared/nota-template.js' : '/shared/nota-template-compact.js';
    if (window.NotaTemplate && window.NotaTemplate.layout === layout && typeof window.NotaTemplate.buildNotaHTML === 'function') return true;
    return new Promise(resolve => {
        const existing = document.getElementById(targetId);
        if (existing) { existing.onload = () => resolve(true); existing.onerror = () => resolve(false); return; }
        const s = document.createElement('script');
        s.id = targetId;
        s.src = targetSrc;
        s.onload = () => resolve(true);
        s.onerror = () => { showToast('No se pudo cargar el template', 'error'); resolve(false); };
        document.head.appendChild(s);
    });
}

async function printDemoNota(){
    const { empresa, nota } = readForms();
    const layout = nota.layout || 'compact';
    const ok = await ensureNotaTemplateLoaded(layout);
    if (!ok) return;
    try { localStorage.setItem('nota_config', JSON.stringify(nota)); } catch {}
    const ventaDemo = {
        id_global: 'DEMO-0001',
        tasa_bcv: 40,
        cliente: 'Cliente Demo',
        cedula: 'V-00000000',
        telefono: '0414-1234567',
        vendedor: 'Admin',
        fecha: new Date().toISOString(),
        descuento: 0,
        empresa_nombre: empresa.nombre || 'Demo',
        empresa_logo_url: empresa.logo_url || '',
        items: [
            { codigo: 'P-001', descripcion: 'Filtro de aceite', marca: 'BOSCH', cantidad: 2, precio_usd: 15 },
            { codigo: 'P-002', descripcion: 'Lubricante 15W40', marca: 'SHELL', cantidad: 1, precio_usd: 25 }
        ]
    };
    const html = await window.NotaTemplate.buildNotaHTML({ venta: ventaDemo, detalles: [] });
    const win = window.open('', '_blank');
    if (!win) { showToast('Permita ventanas emergentes para imprimir demo', 'error'); return; }
    win.document.write(html);
    win.document.close();
    setTimeout(() => { win.focus(); win.print(); }, 300);
}

async function purgeAllData() {
    const confirmText = prompt('Esta acción borrará TODOS los datos. Escribe BORRAR para continuar:');
    if (confirmText !== 'BORRAR') {
        showToast('Operación cancelada', 'info');
        return;
    }

    try {
        const res = await fetch('/admin/ajustes/purge-data', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ confirm: 'BORRAR' })
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || 'No se pudo borrar la base de datos');
        }

        let firebaseClientes = 0;
        let firebaseVentas = 0;
        try { firebaseClientes = await borrarClientesFirebaseTodos(); } catch (err) { console.warn(err); }
        try { firebaseVentas = await borrarVentasFirebaseTodas(); } catch (err) { console.warn(err); }

        try { localStorage.removeItem('clientes_frecuentes_v2'); } catch (err) { console.warn(err); }
        try { await window.borrarDatosLocales?.(); } catch (err) { console.warn(err); }

        showToast(`Datos borrados. Firebase clientes: ${firebaseClientes}, ventas: ${firebaseVentas}`, 'success');
        setTimeout(() => window.location.reload(), 1200);
    } catch (err) {
        showToast(err.message || 'Error borrando datos', 'error');
    }
}
