let carrito = [];
let productoSeleccionado = null;
let vendiendo = false;

// Variables para PWA y Sincronización
let isOnline = navigator.onLine;

const buscarInput = document.getElementById('buscar');
const resultadosUL = document.getElementById('resultados');
const tablaCuerpo = document.getElementById('venta-items-cuerpo');
const btnVender = document.getElementById('btnVender');
const statusIndicator = document.createElement('div');

// --- INICIALIZACIÓN DE INTERFAZ OFFLINE ---
function setupOfflineUI() {
    statusIndicator.id = 'status-indicator';
    statusIndicator.className = `fixed bottom-4 right-4 px-4 py-2 rounded-full text-xs font-bold transition-all shadow-lg ${isOnline ? 'bg-green-500 text-white' : 'bg-red-500 text-white'}`;
    statusIndicator.innerHTML = isOnline ? '<i class="fas fa-wifi mr-2"></i> EN LÍNEA' : '<i class="fas fa-wifi-slash mr-2"></i> MODO OFFLINE';
    document.body.appendChild(statusIndicator);

    window.addEventListener('online', () => {
        isOnline = true;
        statusIndicator.className = 'fixed bottom-4 right-4 px-4 py-2 rounded-full text-xs font-bold bg-green-500 text-white shadow-lg';
        statusIndicator.innerHTML = '<i class="fas fa-wifi mr-2"></i> EN LÍNEA';
        intentarSincronizar();
    });

    window.addEventListener('offline', () => {
        isOnline = false;
        statusIndicator.className = 'fixed bottom-4 right-4 px-4 py-2 rounded-full text-xs font-bold bg-red-500 text-white shadow-lg';
        statusIndicator.innerHTML = '<i class="fas fa-wifi-slash mr-2"></i> MODO OFFLINE';
    });
}

// --- GENERADOR DE ID GLOBAL (VEN-YYYY-MM-DD-UUID) ---
function generarIDVenta() {
    const fecha = new Date().toISOString().split('T')[0];
    const randomPart = Math.random().toString(36).substring(2, 10).toUpperCase();
    return `VEN-${fecha}-${randomPart}`;
}

// --- BÚSQUEDA Y SELECCIÓN ---
buscarInput.addEventListener('input', () => {
    const q = buscarInput.value.trim();
    if (q.length < 2) {
        resultadosUL.innerHTML = '';
        resultadosUL.classList.add('hidden');
        return;
    }

    fetch(`/buscar?q=${encodeURIComponent(q)}`)
        .then(res => res.json())
        .then(data => {
            resultadosUL.innerHTML = '';
            if (data.length > 0) {
                resultadosUL.classList.remove('hidden');
                data.forEach(p => {
                    const li = document.createElement('li');
                    li.className = "p-3 border-b hover:bg-slate-50 cursor-pointer flex justify-between items-center transition-colors";
                    li.innerHTML = `
                        <div class="flex flex-col">
                            <span class="font-bold text-slate-700">${p.codigo}</span>
                            <span class="text-xs text-slate-400">${p.descripcion}</span>
                        </div>
                        <div class="text-right">
                            <span class="block text-blue-600 font-black">$${p.precio_usd}</span>
                            <span class="block text-[9px] font-bold text-slate-400 uppercase">Stock: ${p.stock}</span>
                        </div>
                    `;
                    li.onclick = () => prepararParaAgregar(p);
                    resultadosUL.appendChild(li);
                });
            } else {
                resultadosUL.classList.add('hidden');
            }
        });
});

function prepararParaAgregar(p) {
    productoSeleccionado = p;
    buscarInput.value = `${p.codigo} - ${p.descripcion}`;
    resultadosUL.classList.add('hidden');
    document.getElementById('v_cantidad').focus();
}

// --- GESTIÓN DEL CARRITO ---
function agregarAlCarrito() {
    const cantidadInput = document.getElementById('v_cantidad');
    const cantidad = parseInt(cantidadInput.value);
    
    if (!productoSeleccionado) return alert('Por favor, busque y seleccione un producto.');
    if (isNaN(cantidad) || cantidad <= 0) return alert('Ingrese una cantidad válida.');

    if (cantidad > productoSeleccionado.stock) return alert('No hay suficiente stock disponible.');

    // Verificar si ya existe en el carrito para sumar o agregar nuevo
    const index = carrito.findIndex(item => item.codigo === productoSeleccionado.codigo);
    if (index !== -1) {
        if ((carrito[index].cantidad + cantidad) > productoSeleccionado.stock) {
            return alert('La cantidad total en el carrito supera el stock físico.');
        }
        carrito[index].cantidad += cantidad;
    } else {
        carrito.push({
            codigo: productoSeleccionado.codigo,
            descripcion: productoSeleccionado.descripcion,
            precio_usd: productoSeleccionado.precio_usd,
            cantidad: cantidad
        });
    }

    actualizarTabla();
    limpiarSeleccion();
}

function actualizarTabla() {
    if (!tablaCuerpo) return;
    tablaCuerpo.innerHTML = '';
    
    const vacioMsg = document.getElementById('vacio-msg');
    const countLabel = document.getElementById('items-count');
    
    if (carrito.length === 0) {
        if (vacioMsg) vacioMsg.classList.remove('hidden');
        if (countLabel) countLabel.innerText = "0 ITEMS";
    } else {
        if (vacioMsg) vacioMsg.classList.add('hidden');
        if (countLabel) countLabel.innerText = `${carrito.length} ITEM${carrito.length > 1 ? 'S' : ''}`;
    }

    let totalUSD = 0;
    const tasa = parseFloat(document.getElementById('v_tasa').value) || 1;

    carrito.forEach((item, index) => {
        const subtotalUSD = item.cantidad * item.precio_usd;
        totalUSD += subtotalUSD;
        
        const tr = document.createElement('tr');
        tr.className = "border-b text-sm hover:bg-slate-50 transition-colors";
        tr.innerHTML = `
            <td class="p-4 font-bold text-slate-600">${item.codigo}</td>
            <td class="p-4 text-slate-500">${item.descripcion}</td>
            <td class="p-4 text-center font-bold">${item.cantidad}</td>
            <td class="p-4 text-right text-slate-400 font-mono">$${item.precio_usd.toFixed(2)}</td>
            <td class="p-4 text-right font-black text-blue-600 font-mono">$${subtotalUSD.toFixed(2)}</td>
            <td class="p-4 text-center">
                <button onclick="eliminarDelCarrito(${index})" class="w-8 h-8 rounded-lg text-red-400 hover:bg-red-50 hover:text-red-600 transition-all">
                    <i class="fas fa-trash-alt"></i>
                </button>
            </td>
        `;
        tablaCuerpo.appendChild(tr);
    });

    document.getElementById('total-usd').innerText = totalUSD.toFixed(2);
    document.getElementById('total-bs').innerText = (totalUSD * tasa).toLocaleString('es-VE', {minimumFractionDigits: 2});
}

function eliminarDelCarrito(index) {
    carrito.splice(index, 1);
    actualizarTabla();
}

function limpiarSeleccion() {
    productoSeleccionado = null;
    buscarInput.value = '';
    document.getElementById('v_cantidad').value = 1;
    buscarInput.focus();
}

// --- FUNCIÓN DE IMPRESIÓN OFFLINE (GENERACIÓN LOCAL) ---
function imprimirNotaLocal(venta) {
    const ventana = window.open('', '_blank');
    const fechaFormateada = new Date(venta.fecha).toLocaleString();
    let totalBs = 0;
    let totalUSD = 0;

    const filasHTML = venta.items.map(item => {
        const subtotalUSD = item.cantidad * item.precio_usd;
        const subtotalBs = subtotalUSD * venta.tasa_bcv;
        totalUSD += subtotalUSD;
        totalBs += subtotalBs;
        return `
            <tr>
                <td style="border: 1px solid #ddd; padding: 8px;">${item.codigo}</td>
                <td style="border: 1px solid #ddd; padding: 8px;">${item.descripcion}</td>
                <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">${item.cantidad}</td>
                <td style="border: 1px solid #ddd; padding: 8px; text-align: right;">$${item.precio_usd.toFixed(2)}</td>
                <td style="border: 1px solid #ddd; padding: 8px; text-align: right;">${subtotalBs.toFixed(2)} Bs</td>
            </tr>
        `;
    }).join('');

    ventana.document.write(`
        <html>
        <head>
            <title>Nota de Entrega - ${venta.id_global}</title>
            <style>
                body { font-family: sans-serif; padding: 20px; color: #333; }
                .header { text-align: center; margin-bottom: 20px; }
                .info { margin-bottom: 20px; display: flex; justify-content: space-between; }
                table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
                .totals { text-align: right; }
                .totals p { margin: 5px 0; font-size: 1.2em; }
                @media print { .no-print { display: none; } }
            </style>
        </head>
        <body>
            <div class="header">
                <h1>NOTA DE ENTREGA</h1>
                <p>ID: ${venta.id_global}</p>
            </div>
            <div class="info">
                <div>
                    <p><strong>Cliente:</strong> ${venta.cliente}</p>
                    <p><strong>Fecha:</strong> ${fechaFormateada}</p>
                </div>
                <div>
                    <p><strong>Tasa:</strong> ${venta.tasa_bcv.toFixed(2)} Bs/$</p>
                </div>
            </div>
            <table>
                <thead>
                    <tr style="background: #f4f4f4;">
                        <th style="border: 1px solid #ddd; padding: 8px;">Código</th>
                        <th style="border: 1px solid #ddd; padding: 8px;">Descripción</th>
                        <th style="border: 1px solid #ddd; padding: 8px;">Cant.</th>
                        <th style="border: 1px solid #ddd; padding: 8px;">P. Unit ($)</th>
                        <th style="border: 1px solid #ddd; padding: 8px;">Subtotal (Bs)</th>
                    </tr>
                </thead>
                <tbody>
                    ${filasHTML}
                </tbody>
            </table>
            <div class="totals">
                <p><strong>Total USD:</strong> $${totalUSD.toFixed(2)}</p>
                <p><strong>Total Bs:</strong> ${totalBs.toFixed(2)} Bs</p>
            </div>
            <div class="no-print" style="margin-top: 30px; text-align: center;">
                <button onclick="window.print()" style="padding: 10px 20px; background: #2563eb; color: white; border: none; border-radius: 5px; cursor: pointer;">Imprimir Nota</button>
            </div>
            <script>
                window.onload = function() {
                    // Opcional: window.print();
                };
            </script>
        </body>
        </html>
    `);
    ventana.document.close();
}

// --- PROCESAR VENTA FINAL ---
async function registrarVenta() {
    if (vendiendo || carrito.length === 0) return;
    
    const cliente = document.getElementById('v_cliente').value.trim();
    const tasa = parseFloat(document.getElementById('v_tasa').value);

    if (!cliente || isNaN(tasa)) return alert('Datos incompletos');

    const ventaData = {
        id_global: generarIDVenta(),
        items: [...carrito],
        cliente,
        tasa_bcv: tasa,
        fecha: new Date().toISOString(),
        sync: false
    };

    vendiendo = true;
    btnVender.disabled = true;

    // Paso 1: Respaldo local preventivo
    guardarVentaLocal(ventaData);

    if (!isOnline) {
        // Modo Offline puro
        imprimirNotaLocal(ventaData);
        finalizarVentaUI();
    } else {
        // Intento Online
        try {
            const res = await fetch('/ventas', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ items: carrito, cliente, tasa_bcv: tasa })
            });
            const data = await res.json();
            
            if (res.ok) {
                marcarVentaComoSincronizada(ventaData.id_global);
                window.open(`/nota/${data.ventaId}`, '_blank');
                finalizarVentaUI();
            } else {
                throw new Error("Error servidor");
            }
        } catch (e) {
            // Fallback: Si el servidor falla estando online, imprimimos local
            imprimirNotaLocal(ventaData);
            finalizarVentaUI();
        }
    }
}

function finalizarVentaUI() {
    carrito = [];
    actualizarTabla();
    document.getElementById('v_cliente').value = '';
    vendiendo = false;
    btnVender.disabled = false;
    actualizarHistorial();
}

async function enviarVentaAlServidor(venta) {
    const res = await fetch('/ventas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(venta)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    
    marcarVentaComoSincronizada(venta.id_global);
    return data; // Contiene el ID generado por el servidor
}

function guardarVentaLocal(venta) {
    const historico = JSON.parse(localStorage.getItem('ventas_pendientes') || '[]');
    historico.push(venta);
    localStorage.setItem('ventas_pendientes', JSON.stringify(historico));
}

function marcarVentaComoSincronizada(idGlobal) {
    const historico = JSON.parse(localStorage.getItem('ventas_pendientes') || '[]');
    const nuevo = historico.map(v => v.id_global === idGlobal ? { ...v, sync: true } : v);
    localStorage.setItem('ventas_pendientes', JSON.stringify(nuevo));
}

// --- ADMINISTRACIÓN DE PRODUCTOS ---
function crearProducto() {
    const body = {
        codigo: document.getElementById('i_codigo').value.trim(),
        descripcion: document.getElementById('i_desc').value.trim(),
        precio_usd: parseFloat(document.getElementById('i_precio').value),
        stock: parseInt(document.getElementById('i_stock').value) || 0
    };

    if (!body.codigo || !body.descripcion || isNaN(body.precio_usd)) {
        return alert('Complete todos los campos del producto.');
    }

    fetch('/admin/productos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    })
    .then(r => r.json())
    .then(d => {
        if(d.error) throw new Error(d.error);
        alert('✅ Producto registrado');
        document.getElementById('i_codigo').value = '';
        document.getElementById('i_desc').value = '';
        document.getElementById('i_precio').value = '';
        document.getElementById('i_stock').value = '';
    })
    .catch(err => alert('Error: ' + err.message));
}

function ajustarStock() {
    const body = {
        codigo: document.getElementById('a_codigo').value.trim(),
        diferencia: parseInt(document.getElementById('a_diff').value),
        motivo: document.getElementById('a_motivo').value
    };

    if (!body.codigo || isNaN(body.diferencia)) {
        return alert('Ingrese el código y la cantidad a ajustar.');
    }

    fetch('/admin/ajustes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    })
    .then(r => r.json())
    .then(d => {
        if(d.error) throw new Error(d.error);
        alert('✅ Stock actualizado');
        document.getElementById('a_codigo').value = '';
        document.getElementById('a_diff').value = '';
    })
    .catch(err => alert('Error: ' + err.message));
}

function switchAdminTab(tab) {
    const pCrear = document.getElementById('panel-crear');
    const pAjuste = document.getElementById('panel-ajuste');
    const bCrear = document.getElementById('btn-tab-crear');
    const bAjuste = document.getElementById('btn-tab-ajuste');

    if(tab === 'crear') {
        pCrear.classList.remove('hidden'); pAjuste.classList.add('hidden');
        bCrear.classList.add('active-tab'); bAjuste.classList.remove('active-tab'); bAjuste.classList.add('text-slate-400');
    } else {
        pCrear.classList.add('hidden'); pAjuste.classList.remove('hidden');
        bAjuste.classList.add('active-tab'); bCrear.classList.remove('active-tab'); bCrear.classList.add('text-slate-400');
    }
}

// --- REPORTES ---
function actualizarHistorial() {
    fetch('/reportes/ventas')
        .then(res => res.json())
        .then(data => {
            const cont = document.getElementById('historial');
            if (!cont) return;
            cont.innerHTML = '';
            data.slice(0, 5).forEach(v => {
                const div = document.createElement('div');
                div.className = "group p-3 border rounded-xl flex justify-between items-center text-xs hover:border-blue-200 hover:bg-blue-50 transition-all cursor-pointer";
                div.onclick = () => window.open(`/nota/${v.id}`, '_blank');
                div.innerHTML = `
                    <div class="flex flex-col">
                        <span class="font-black text-slate-700 uppercase">${v.cliente}</span>
                        <span class="text-[9px] text-slate-400 font-mono">${new Date(v.fecha).toLocaleString()}</span>
                    </div>
                    <div class="text-right">
                        <span class="font-black text-blue-600 block">${v.total_bs.toFixed(2)} Bs</span>
                        <span class="text-[8px] text-slate-400 font-bold uppercase">Ver Nota <i class="fas fa-external-link-alt ml-1"></i></span>
                    </div>
                `;
                cont.appendChild(div);
            });
        });
}

function intentarSincronizar() {
    const historico = JSON.parse(localStorage.getItem('ventas_pendientes') || '[]');
    const pendientes = historico.filter(v => !v.sync);
    if (pendientes.length === 0) return;

    pendientes.reduce(async (promise, venta) => {
        await promise;
        return enviarVentaAlServidor(venta).catch(e => console.error(e));
    }, Promise.resolve()).then(() => actualizarHistorial());
}

document.addEventListener('DOMContentLoaded', () => {
    setupOfflineUI();
    actualizarHistorial();
    if (isOnline) intentarSincronizar();
});