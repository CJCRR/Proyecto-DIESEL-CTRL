(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.NotaTemplate = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  function number(n) { return Number(n) || 0; }
  function clampPct(p) { p = number(p); if (p < 0) return 0; if (p > 100) return 100; return p; }

  // Normaliza items desde dos posibles orígenes:
  // - venta.items (cliente)
  // - detalles (servidor)
  function normalizeItems(venta, detalles) {
    if (Array.isArray(venta && venta.items)) {
      return venta.items.map(it => ({
        codigo: it.codigo || '',
        descripcion: it.descripcion || '',
        marca: it.marca || '',
        cantidad: number(it.cantidad),
        precio_usd: number(it.precio_usd)
      }));
    }
    if (Array.isArray(detalles)) {
      return detalles.map(d => ({
        codigo: d.codigo || '',
        descripcion: d.descripcion || '',
        marca: d.marca || d.nombre_marca || '',
        cantidad: number(d.cantidad),
        precio_usd: number(d.precio_usd)
      }));
    }
    return [];
  }

  async function getNotaConfig() {
    // Intenta cache local primero
    try {
      const cached = typeof localStorage !== 'undefined' ? localStorage.getItem('nota_config') : null;
      if (cached) return JSON.parse(cached);
    } catch {}
    // Intentar solicitar al backend si estamos en navegador
    if (typeof fetch !== 'undefined') {
      try {
        const token = typeof localStorage !== 'undefined' ? localStorage.getItem('auth_token') : null;
        const res = await fetch('/admin/ajustes/config', { headers: token ? { 'Authorization': `Bearer ${token}` } : {} });
        if (res.ok) {
          const j = await res.json();
          const nota = j && j.nota ? j.nota : {};
          try { localStorage.setItem('nota_config', JSON.stringify(nota)); } catch {}
          return nota;
        }
      } catch {}
    }
    return {
      header_logo_url: '', brand_logos: [], rif: '', telefonos: '', ubicacion: '',
      encabezado_texto: '¡Tu Proveedor de Confianza!', terminos: '', pie: 'Total a Pagar:', resaltar_color: '#fff59d'
    };
  }

  async function buildNotaHTML({ venta = {}, detalles = [] }) {
    const tasa = number(venta.tasa_bcv) || 1;
    const descuentoPct = clampPct(venta.descuento);
    const metodo = (venta.metodo_pago || '').toString();
    const multiplicador = 1 - (descuentoPct / 100);

    const items = normalizeItems(venta, detalles);

    let totalUSDBase = 0;
    let totalBsDesc = 0;

    const filasHTML = items.map(item => {
      const lineUsd = number(item.precio_usd) * number(item.cantidad);
      const lineBs = lineUsd * tasa;
      const lineBsDesc = lineBs * multiplicador;
      totalUSDBase += lineUsd;
      totalBsDesc += lineBsDesc;
      return (
        '<tr>' +
        `<td style="border: 1px solid #ddd; padding: 8px;">${item.codigo}</td>` +
        `<td style="border: 1px solid #ddd; padding: 8px;">${item.descripcion}</td>` +
        `<td style="border: 1px solid #ddd; padding: 8px; text-align: center;">${item.cantidad}</td>` +
        `<td style="border: 1px solid #ddd; padding: 8px; text-align: right;">$${number(item.precio_usd).toFixed(2)}</td>` +
        `<td style="border: 1px solid #ddd; padding: 8px; text-align: right;">${lineBsDesc.toFixed(2)} Bs</td>` +
        '</tr>'
      );
    }).join('');

    const totalUSDConDesc = totalUSDBase * multiplicador;

    const fecha = venta.fecha ? new Date(venta.fecha) : new Date();
    const fechaTexto = (typeof window !== 'undefined' && window.toLocaleDateString)
      ? fecha.toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric' })
      : fecha.toISOString().slice(0, 10);

    const idTexto = venta.id_global ? venta.id_global : (venta.id ? `VENTA-${venta.id}` : '');

    const notaCfg = await getNotaConfig();
    const brandImgs = (notaCfg.brand_logos || []).map(u => `<img src="${u}" style="height:26px;margin:0 6px;object-fit:contain;">`).join('');
    const headerLogoUrl = (notaCfg.header_logo_url || venta.empresa_logo_url || '').toString();
    const headerLogo = headerLogoUrl ? `<img src="${headerLogoUrl}" style="height:42px;object-fit:contain;">` : '';

    const ivaPct = clampPct(notaCfg.iva_pct || 0);
    const ivaUSD = totalUSDConDesc * (ivaPct / 100);
    const ivaBs = totalBsDesc * (ivaPct / 100);
    const totalUSDFinal = totalUSDConDesc + ivaUSD;
    const totalBsFinal = totalBsDesc + ivaBs;

    const html = `
      <html>
      <head>
        <title>Nota de Entrega - ${idTexto}</title>
        <style>
          body { font-family: Arial, Helvetica, sans-serif; padding: 18px; color: #111827; margin:0; }
          .sheet { min-height: 10.0in; display:flex; flex-direction:column; }
          .header-top { display:flex; align-items:flex-end; justify-content:space-between; gap:12px; }
          .marca-bar { display:flex; align-items:center; gap:8px; }
          .empresa-box { font-size:12px; color:#374151; margin-top: 6px; }
          .encabezado { text-align:right; font-size:12px; color:#111827; font-weight:700; }
          .main { flex:1; display:flex; flex-direction:column; gap:10px; }
          .paneles { margin-top:10px; display:grid; grid-template-columns:1fr 1fr; gap:10px; }
          .panel { border:1px solid #111827; padding:8px; }
          .panel h4 { margin:0 0 6px 0; font-size:12px; font-weight:800; }
          .table-wrap { flex:0; }
          table { width: 100%; border-collapse: collapse; margin-top: 8px; }
          th, td { padding: 6px; font-size:12px; }
          thead th { border: 1px solid #bdbdbd; background:#f1f5f9; text-transform:uppercase; font-weight:800; color:#475569; }
          tbody td { border: none; }
          tr.highlight td { background:${notaCfg.resaltar_color || '#fff59d'}; }
          .totales { margin-top:auto; display:grid; grid-template-columns:1fr 320px; gap:12px; align-items:start; }
          .tot-card { border:1px solid #e5e7eb; padding:8px; }
          .tot-card .row { display:flex; justify-content:space-between; margin:4px 0; }
          .pie { margin-top:8px; font-size:11px; color:#374151; text-align:center; page-break-inside: avoid; page-break-before: avoid; }
          @media print { .no-print { display: none; } }
        </style>
      </head>
      <body>
        <div class="sheet">
          <div class="header-top">
            <div style="display:flex; align-items:flex-end; gap:12px;">
              ${headerLogo}
              <div class="empresa-box">
                <div style="font-weight:900; letter-spacing:1px; font-size:16px;">${venta.empresa_nombre || 'DIESEL CTRL'}</div>
                <div>RIF: ${notaCfg.rif || '—'}</div>
                <div>${notaCfg.telefonos || ''}</div>
                <div>${notaCfg.ubicacion || ''}</div>
              </div>
            </div>
            <div class="marca-bar">${brandImgs}</div>
          </div>
          <div style="margin-top:6px; text-align:right; font-size:12px; font-weight:700;">${idTexto}</div>
          <div class="encabezado">${notaCfg.encabezado_texto || ''}</div>

          <div class="main">
            <div class="paneles">
              <div class="panel">
                <h4>CLIENTE</h4>
                <div><strong>Cliente:</strong> ${venta.cliente || ''}</div>
                ${venta.cedula ? `<div><strong>R.I.F / C.I:</strong> ${venta.cedula}</div>` : ''}
                ${venta.telefono ? `<div><strong>Teléfonos:</strong> ${venta.telefono}</div>` : ''}

              </div>
              <div class="panel">
                <h4>NOTA DESPACHO</h4>
                <div><strong>EMISIÓN:</strong> ${fechaTexto}</div>
                <div><strong>TASA B.C.V:</strong> ${tasa.toFixed(2)}</div>
                <div><strong>VENDEDOR:</strong> ${venta.vendedor || ''}</div>
              </div>
            </div>

            <div class="table-wrap">
              <table>
                <thead>
                  <tr style="background: #f4f4f4;">
                    <th>Código</th>
                    <th>Descripción</th>
                    <th>Marca</th>
                    <th>Cant</th>
                    <th>Precio $</th>
                    <th>Total $</th>
                    <th>Precio Bs.</th>
                    <th>Total Bs.</th>
                  </tr>
                </thead>
                <tbody>
                  ${items.map((item, idx) => {
                    const lineUsd = number(item.precio_usd) * number(item.cantidad);
                    const lineBs = lineUsd * tasa;
                    const precioBs = number(item.precio_usd) * tasa;
                    const rowCls = idx === items.length - 1 ? 'highlight' : '';
                    return (
                      `<tr class="${rowCls}">`+
                      `<td>${item.codigo}</td>`+
                      `<td>${item.descripcion}</td>`+
                      `<td>${item.marca || ''}</td>`+
                      `<td style="text-align:center;">${item.cantidad}</td>`+
                      `<td style="text-align:right;">${number(item.precio_usd).toFixed(2)}</td>`+
                      `<td style="text-align:right;">${lineUsd.toFixed(2)}</td>`+
                      `<td style="text-align:right;">${precioBs.toFixed(2)}</td>`+
                      `<td style="text-align:right;">${lineBs.toFixed(2)}</td>`+
                      `</tr>`
                    );
                  }).join('')}
                </tbody>
              </table>
            </div>
          </div>

          <div class="totales">
            <div></div>
            <div class="tot-card">
              <div class="row"><span>Sub-total Bs</span><span>Bs ${totalBsDesc.toFixed(2)}</span></div>
              <div class="row"><span>Impuesto / I.V.A (${ivaPct}%)</span><span>$${ivaUSD.toFixed(2)} • Bs ${ivaBs.toFixed(2)}</span></div>
              <div class="row" style="font-weight:800"><span>${notaCfg.pie_usd || 'Total USD'}</span><span>$${totalUSDFinal.toFixed(2)}</span></div>
              <div class="row" style="font-weight:800"><span>${notaCfg.pie_bs || 'Total Bs'}</span><span>Bs ${totalBsFinal.toFixed(2)}</span></div>
            </div>
          </div>
          <div class="pie">${notaCfg.terminos || ''}</div>
        </div>
        <div class="no-print" style="margin-top: 30px; text-align: center;">
          <button onclick="window.print()" style="padding: 10px 20px; background: #2563eb; color: white; border: none; border-radius: 5px; cursor: pointer;">Imprimir Nota</button>
        </div>
      </body>
      </html>
    `;

    return html;
  }

  return { layout: 'standard', buildNotaHTML };
});
