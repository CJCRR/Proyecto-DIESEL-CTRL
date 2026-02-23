import { borrarClientesFirebaseTodos, borrarVentasFirebaseTodas } from './firebase-sync.js';
import { showToast } from './app-utils.js';
import { apiFetchJson } from './app-api.js';

let configCache = { empresa: {}, descuentos_volumen: [], devolucion: {}, nota: {} };

// Estado para depósitos
let depositosCache = [];
let depositoEditId = null;

// Referencias para el modal de borrado total (zona de riesgo)
let modalPurge = null;
let purgeInput = null;
let purgeCancelar = null;
let purgeConfirmar = null;


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
        precio1_nombre: document.getElementById('e_precio1_nombre')?.value.trim() || '',
        precio1_pct: parseFloat(document.getElementById('e_precio1_pct')?.value || '0') || 0,
        precio2_nombre: document.getElementById('e_precio2_nombre')?.value.trim() || '',
        precio2_pct: parseFloat(document.getElementById('e_precio2_pct')?.value || '0') || 0,
        precio3_nombre: document.getElementById('e_precio3_nombre')?.value.trim() || '',
        precio3_pct: parseFloat(document.getElementById('e_precio3_pct')?.value || '0') || 0,
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
        direccion_general: document.getElementById('n_dir_general')?.value.trim() || '',
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
    if (document.getElementById('e_precio1_nombre')) document.getElementById('e_precio1_nombre').value = empresa.precio1_nombre || '';
    if (document.getElementById('e_precio1_pct')) document.getElementById('e_precio1_pct').value = empresa.precio1_pct ?? 0;
    if (document.getElementById('e_precio2_nombre')) document.getElementById('e_precio2_nombre').value = empresa.precio2_nombre || '';
    if (document.getElementById('e_precio2_pct')) document.getElementById('e_precio2_pct').value = empresa.precio2_pct ?? 0;
    if (document.getElementById('e_precio3_nombre')) document.getElementById('e_precio3_nombre').value = empresa.precio3_nombre || '';
    if (document.getElementById('e_precio3_pct')) document.getElementById('e_precio3_pct').value = empresa.precio3_pct ?? 0;
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
    if (document.getElementById('n_dir_general')) document.getElementById('n_dir_general').value = nota.direccion_general || '';
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
        const data = await apiFetchJson('/admin/ajustes/config');
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

        const data = await apiFetchJson('/admin/ajustes/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        configCache = data;
        try { localStorage.setItem('nota_config', JSON.stringify(data.nota || {})); } catch {}
        showToast('Ajustes guardados', 'success');
    } catch (err) {
        showToast(err.message || 'Error guardando', 'error');
    }
}

function setupUI() {
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

    // Inicializar modal de borrado total
    modalPurge = document.getElementById('modal-purge-all');
    purgeInput = document.getElementById('purge-confirm-text');
    purgeCancelar = document.getElementById('purge-cancelar');
    purgeConfirmar = document.getElementById('purge-confirmar');

    const btnPurge = document.getElementById('btnPurgeAll');
    if (btnPurge) {
        btnPurge.addEventListener('click', () => {
            if (modalPurge) {
                if (purgeInput) purgeInput.value = '';
                modalPurge.classList.remove('hidden');
                modalPurge.classList.add('flex');
                setTimeout(() => { if (purgeInput) purgeInput.focus(); }, 50);
            } else {
                // Fallback a confirmación por prompt si el modal no existe
                purgeAllData();
            }
        });
    }

    if (modalPurge && purgeCancelar) {
        purgeCancelar.addEventListener('click', () => {
            modalPurge.classList.add('hidden');
            modalPurge.classList.remove('flex');
        });
    }

    if (modalPurge && purgeConfirmar) {
        purgeConfirmar.addEventListener('click', async () => {
            if (!purgeInput || purgeInput.value !== 'BORRAR') {
                showToast('Debes escribir BORRAR para continuar', 'error');
                if (purgeInput) purgeInput.focus();
                return;
            }
            modalPurge.classList.add('hidden');
            modalPurge.classList.remove('flex');
            await purgeAllData(true);
        });

        // Permitir Enter dentro del input para confirmar
        if (purgeInput) {
            purgeInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    purgeConfirmar.click();
                }
            });
        }
    }

    setup2FASection();

    // Gestión de depósitos de inventario
    setupDepositosUI();
}

window.addEventListener('DOMContentLoaded', () => {
    setupUI();
    loadConfig();
});

function renderDepositosList() {
    const cont = document.getElementById('depositos-lista');
    if (!cont) return;
    if (!depositosCache.length) {
        cont.innerHTML = '<div class="text-[12px] text-slate-400">No hay depósitos configurados. Crea al menos uno.</div>';
        return;
    }
    cont.innerHTML = '';
    depositosCache.forEach((dep, idx) => {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'w-full text-left p-3 border rounded-xl flex justify-between items-center gap-3 hover:bg-slate-50 transition';
        const badges = [];
        if (dep.es_principal) badges.push('<span class="px-2 py-0.5 text-[10px] rounded-full bg-emerald-100 text-emerald-700 font-semibold">Principal</span>');
        if (!dep.activo) badges.push('<span class="px-2 py-0.5 text-[10px] rounded-full bg-slate-200 text-slate-600 font-semibold">Inactivo</span>');
        el.innerHTML = `
            <div>
                <div class="text-sm font-semibold text-slate-800">${dep.nombre}</div>
                <div class="text-[11px] text-slate-500 flex items-center gap-2">
                    <span>Código: ${dep.codigo || '—'}</span>
                    ${badges.join('')}
                </div>
            </div>
            <div class="text-[11px] text-slate-400">
                ID ${idx + 1}
            </div>
        `;
        el.addEventListener('click', () => {
            fillDepositoForm(dep);
        });
        cont.appendChild(el);
    });
}

function fillDepositoForm(dep) {
    depositoEditId = dep && dep.id ? dep.id : null;
    const title = document.getElementById('deposito-form-title');
    const idEl = document.getElementById('deposito_id');
    const nombreEl = document.getElementById('deposito_nombre');
    const codigoEl = document.getElementById('deposito_codigo');
    const principalEl = document.getElementById('deposito_principal');
    const activoEl = document.getElementById('deposito_activo');
    const btnEliminar = document.getElementById('deposito_eliminar');
    const msgEl = document.getElementById('deposito_msg');
    if (msgEl) msgEl.textContent = '';
    if (!nombreEl || !codigoEl || !principalEl || !activoEl || !idEl || !title) return;
    if (!dep) {
        title.textContent = 'Nuevo depósito';
        idEl.value = '';
        nombreEl.value = '';
        codigoEl.value = '';
        principalEl.checked = false;
        activoEl.checked = true;
        if (btnEliminar) {
            btnEliminar.classList.add('hidden');
            btnEliminar.disabled = true;
        }
    } else {
        title.textContent = 'Editar depósito';
        idEl.value = dep.id;
        nombreEl.value = dep.nombre || '';
        codigoEl.value = dep.codigo || '';
        principalEl.checked = !!dep.es_principal;
        activoEl.checked = dep.activo !== false;
        if (btnEliminar) {
            btnEliminar.classList.remove('hidden');
            btnEliminar.disabled = false;
        }
    }
}

async function loadDepositos() {
    try {
        const items = await apiFetchJson('/depositos');
        depositosCache = Array.isArray(items) ? items : [];
        renderDepositosList();
    } catch (err) {
        console.error(err);
        const cont = document.getElementById('depositos-lista');
        if (cont) cont.innerHTML = '<div class="text-[12px] text-rose-500">Error cargando depósitos</div>';
    }
}

function setupDepositosUI() {
    const btnNuevo = document.getElementById('btnNuevoDeposito');
    const form = document.getElementById('deposito-form');
    const btnCancelar = document.getElementById('deposito_cancelar');
    const btnEliminar = document.getElementById('deposito_eliminar');
    if (btnNuevo) {
        btnNuevo.addEventListener('click', (e) => {
            e.preventDefault();
            fillDepositoForm(null);
        });
    }
    if (btnCancelar) {
        btnCancelar.addEventListener('click', (e) => {
            e.preventDefault();
            fillDepositoForm(null);
        });
    }
    if (btnEliminar) {
        btnEliminar.addEventListener('click', async (e) => {
            e.preventDefault();
            if (!depositoEditId) return;
            const dep = depositosCache.find(d => d.id === depositoEditId);
            const nombre = dep && dep.nombre ? dep.nombre : 'este depósito';
            try {
                // Primer intento: verificar si tiene stock/productos asociados
                await apiFetchJson(`/depositos/${encodeURIComponent(depositoEditId)}`, {
                    method: 'DELETE',
                });
                showToast('Depósito eliminado', 'success');
                await loadDepositos();
                fillDepositoForm(null);
            } catch (err) {
                if (err.code === 'DEPOSITO_TIENE_STOCK') {
                    const ok = window.confirm(
                        `El depósito "${nombre}" tiene productos en inventario.\n\n` +
                        `Si continúas, esos productos se borrarán permanentemente de la lista de existencias y del stock.\n\n` +
                        `¿Seguro que deseas eliminar este depósito y su stock asociado?`
                    );
                    if (!ok) return;
                    try {
                        await apiFetchJson(`/depositos/${encodeURIComponent(depositoEditId)}?force=1`, {
                            method: 'DELETE',
                        });
                        showToast('Depósito y stock asociados eliminados', 'success');
                        await loadDepositos();
                        fillDepositoForm(null);
                    } catch (err2) {
                        console.error(err2);
                        showToast(err2.message || 'Error eliminando depósito', 'error');
                    }
                } else {
                    console.error(err);
                    showToast(err.message || 'Error eliminando depósito', 'error');
                }
            }
        });
    }
    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const idStr = document.getElementById('deposito_id')?.value || '';
            const nombre = document.getElementById('deposito_nombre')?.value.trim() || '';
            const codigo = document.getElementById('deposito_codigo')?.value.trim() || '';
            const es_principal = !!document.getElementById('deposito_principal')?.checked;
            const activo = !!document.getElementById('deposito_activo')?.checked;
            const msgEl = document.getElementById('deposito_msg');
            if (!nombre) {
                if (msgEl) msgEl.textContent = 'El nombre es obligatorio.';
                return;
            }
            const payload = { nombre, codigo, es_principal, activo };
            try {
                if (!idStr) {
                    // Crear
                    await apiFetchJson('/depositos', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload),
                    });
                    showToast('Depósito creado', 'success');
                } else {
                    // Actualizar
                    await apiFetchJson(`/depositos/${encodeURIComponent(idStr)}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload),
                    });
                    showToast('Depósito actualizado', 'success');
                }
                await loadDepositos();
                fillDepositoForm(null);
            } catch (err) {
                console.error(err);
                if (msgEl) msgEl.textContent = err.message || 'Error guardando depósito';
            }
        });
    }

    // Cargar lista inicial
    loadDepositos();
}

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
                try {
                    const j = await apiFetchJson('/admin/ajustes/upload-image', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ dataUrl, filename: name })
                    });
                    showToast('Imagen subida', 'success');
                    return j.url;
                } catch (err) {
                    showToast(err.message || 'Upload falló', 'error');
                    return null;
                }
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

async function purgeAllData(fromModal = false) {
    if (!fromModal) {
        const confirmText = prompt('Esta acción borrará TODOS los datos. Escribe BORRAR para continuar:');
        if (confirmText !== 'BORRAR') {
            showToast('Operación cancelada', 'info');
            return;
        }
    }

    try {
        const j = await apiFetchJson('/admin/ajustes/purge-data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: 'BORRAR' }) });

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

function getCurrentUser() {
    try {
        return window.Auth && typeof window.Auth.getUser === 'function'
            ? window.Auth.getUser()
            : JSON.parse(localStorage.getItem('auth_user') || 'null');
    } catch {
        return null;
    }
}

function updateTwoFAStatusUI(user) {
    const badge = document.getElementById('twofa-status-badge');
    const setupBlock = document.getElementById('twofa-setup-block');
    const enabledBlock = document.getElementById('twofa-enabled-block');
    const qr = document.getElementById('twofa-qr');
    if (!badge || !setupBlock || !enabledBlock) return;

    const enabled = !!(user && user.twofa_enabled);

    if (enabled) {
        badge.textContent = '2FA activo';
        badge.className = 'px-2 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700';
        setupBlock.classList.add('hidden');
        enabledBlock.classList.remove('hidden');
        if (qr) qr.innerHTML = '';
    } else {
        badge.textContent = '2FA desactivado';
        badge.className = 'px-2 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-600';
        setupBlock.classList.remove('hidden');
        enabledBlock.classList.add('hidden');
        if (qr) qr.innerHTML = '';
    }
}

function renderTwoFAQr(otpauthUrl) {
    const container = document.getElementById('twofa-qr');
    if (!container || !otpauthUrl) return;
    if (typeof window.QRCode !== 'function') return;
    // Limpiar QR anterior si existe
    container.innerHTML = '';
    try {
        // Librería qrcodejs: constructor QRCode(element, options)
        new window.QRCode(container, {
            text: otpauthUrl,
            width: 160,
            height: 160,
            correctLevel: window.QRCode.CorrectLevel ? window.QRCode.CorrectLevel.M : undefined,
        });
    } catch (err) {
        console.warn('No se pudo generar QR 2FA:', err);
    }
}

function setup2FASection() {
    const sec = document.getElementById('sec-2fa');
    if (!sec) return;

    const user = getCurrentUser();
    if (!user || (user.rol !== 'admin' && user.rol !== 'superadmin')) {
        sec.classList.add('hidden');
        return;
    }

    // Inicializar estado visual
    updateTwoFAStatusUI(user);

    const btnSetup = document.getElementById('btn-2fa-setup');
    const setupData = document.getElementById('twofa-setup-data');
    const secretEl = document.getElementById('twofa-secret');
    const otpauthEl = document.getElementById('twofa-otpauth');
    const codeEnable = document.getElementById('twofa-code-enable');
    const btnEnable = document.getElementById('btn-2fa-enable');
    const codeDisable = document.getElementById('twofa-code-disable');
    const btnDisable = document.getElementById('btn-2fa-disable');

    if (btnSetup && setupData && secretEl && otpauthEl) {
        btnSetup.addEventListener('click', async () => {
            try {
                const j = await apiFetchJson('/auth/2fa/setup', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({})
                });
                if (j && j.secret) {
                    secretEl.textContent = j.secret;
                    otpauthEl.textContent = j.otpauth_url || '';
                    if (j.otpauth_url) {
                        renderTwoFAQr(j.otpauth_url);
                    }
                    setupData.classList.remove('hidden');
                    if (codeEnable) codeEnable.focus();
                    showToast('Secreto 2FA generado. Configura tu app y luego confirma.', 'success');
                } else {
                    showToast('No se pudo generar secreto 2FA', 'error');
                }
            } catch (err) {
                showToast(err.message || 'Error preparando 2FA', 'error');
            }
        });
    }

    if (btnEnable && codeEnable) {
        btnEnable.addEventListener('click', async () => {
            const token = (codeEnable.value || '').trim();
            if (!token) {
                showToast('Escribe el código de tu app 2FA', 'error');
                codeEnable.focus();
                return;
            }
            try {
                const j = await apiFetchJson('/auth/2fa/enable', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ token })
                });
                if (j && j.success) {
                    const u = getCurrentUser() || {};
                    u.twofa_enabled = true;
                    localStorage.setItem('auth_user', JSON.stringify(u));
                    updateTwoFAStatusUI(u);
                    showToast('2FA habilitado correctamente', 'success');
                } else {
                    showToast('No se pudo habilitar 2FA', 'error');
                }
            } catch (err) {
                showToast(err.message || 'Error al habilitar 2FA', 'error');
            }
        });
    }

    if (btnDisable && codeDisable) {
        btnDisable.addEventListener('click', async () => {
            const token = (codeDisable.value || '').trim();
            if (!token) {
                showToast('Escribe un código válido de tu app 2FA', 'error');
                codeDisable.focus();
                return;
            }
            try {
                const j = await apiFetchJson('/auth/2fa/disable', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ token })
                });
                if (j && j.success) {
                    const u = getCurrentUser() || {};
                    u.twofa_enabled = false;
                    localStorage.setItem('auth_user', JSON.stringify(u));
                    updateTwoFAStatusUI(u);
                    showToast('2FA deshabilitado para esta cuenta', 'success');
                } else {
                    showToast('No se pudo deshabilitar 2FA', 'error');
                }
            } catch (err) {
                showToast(err.message || 'Error al deshabilitar 2FA', 'error');
            }
        });
    }
}
