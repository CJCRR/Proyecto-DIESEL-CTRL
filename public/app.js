let carrito = [];
let productoSeleccionado = null;
let vendiendo = false;

const buscarInput = document.getElementById('buscar');
const resultadosUL = document.getElementById('resultados');
const tablaCuerpo = document.getElementById('venta-items-cuerpo');
const btnVender = document.getElementById('btnVender');

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
    
    // Validar stock disponible
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

function eliminarDelCarrito(index) {
    carrito.splice(index, 1);
    actualizarTabla();
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

function limpiarSeleccion() {
    productoSeleccionado = null;
    buscarInput.value = '';
    document.getElementById('v_cantidad').value = 1;
    buscarInput.focus();
}

// --- PROCESAR VENTA FINAL ---
function registrarVenta() {
    if (vendiendo) return;
    if (carrito.length === 0) return alert('Debe agregar al menos un producto a la lista.');
    
    const cliente = document.getElementById('v_cliente').value.trim();
    const tasa = parseFloat(document.getElementById('v_tasa').value);

    if (!cliente) return alert('El nombre del cliente es obligatorio.');
    if (isNaN(tasa) || tasa <= 0) return alert('La tasa del día no es válida.');

    vendiendo = true;
    btnVender.disabled = true;
    btnVender.innerText = 'GUARDANDO...';

    // Se envía el objeto 'items' que contiene el array del carrito
    const payload = {
        items: carrito,
        cliente: cliente,
        tasa_bcv: tasa
    };

    fetch('/ventas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    })
    .then(async res => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Error en el servidor');
        return data;
    })
    .then(data => {
        alert('✅ Venta registrada correctamente');
        // Abrir nota de entrega si el servidor retorna el ID
        if (data.ventaId) window.open(`/nota/${data.ventaId}`, '_blank');
        
        // Limpiar estado tras éxito
        carrito = [];
        actualizarTabla();
        document.getElementById('v_cliente').value = '';
        actualizarHistorial();
    })
    .catch(err => {
        console.error(err);
        alert('❌ No se pudo completar la venta: ' + err.message);
    })
    .finally(() => {
        vendiendo = false;
        btnVender.disabled = false;
        btnVender.innerText = 'REGISTRAR VENTA';
    });
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

document.addEventListener('DOMContentLoaded', () => {
    actualizarHistorial();
});