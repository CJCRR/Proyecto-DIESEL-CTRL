(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.NotaTemplate = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  const LAYOUT = 'compact';
  function number(n) { return Number(n) || 0; }
  function clampPct(p) { p = number(p); if (p < 0) return 0; if (p > 100) return 100; return p; }

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
    try {
      const cached = typeof localStorage !== 'undefined' ? localStorage.getItem('nota_config') : null;
      if (cached) return JSON.parse(cached);
    } catch {}
    if (typeof fetch !== 'undefined') {
      try {
        const res = await fetch('/admin/ajustes/config', { credentials: 'same-origin' });
        if (res.ok) {
          const j = await res.json();
          let nota = j && j.nota ? j.nota : {};
          // Copiar nombre de empresa si existe
          if (j && j.empresa && j.empresa.nombre) {
            nota.empresa_nombre = j.empresa.nombre;
          }
          try { localStorage.setItem('nota_config', JSON.stringify(nota)); } catch {}
          return nota;
        }
      } catch {}
    }
    return {
      header_logo_url: '', brand_logos: [], rif: '', telefonos: '', ubicacion: '',
      encabezado_texto: '¡Tu Proveedor de Confianza!', terminos: '', pie: 'Total a Pagar:', resaltar_color: '#fff59d', layout: LAYOUT
    };
  }

  async function buildNotaHTML({ venta = {}, detalles = [] }, meta = {}) {
    const notaCfg = (meta && meta.notaCfg && typeof meta.notaCfg === 'object')
      ? meta.notaCfg
      : await getNotaConfig();
    const tasa = number(venta.tasa_bcv) || 1;
    const descuentoPct = clampPct(venta.descuento);
    const multiplicador = 1 - (descuentoPct / 100);

    const items = normalizeItems(venta, detalles);
    let totalUSDBase = 0;
    let totalBsDesc = 0;

    items.forEach(item => {
      const lineUsd = number(item.precio_usd) * number(item.cantidad);
      const lineBsDesc = lineUsd * tasa * multiplicador;
      totalUSDBase += lineUsd;
      totalBsDesc += lineBsDesc;
    });

    const totalUSDConDesc = totalUSDBase * multiplicador;
    const fecha = venta.fecha ? new Date(venta.fecha) : new Date();
    const fechaTexto = (typeof window !== 'undefined' && window.toLocaleDateString)
      ? fecha.toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric' })
      : fecha.toISOString().slice(0, 10);
    const tipo = (meta && meta.tipo) ? String(meta.tipo) : (venta.tipo || '').toUpperCase() === 'PRESUPUESTO' ? 'PRESUPUESTO' : 'NOTA DE ENTREGA';
    const idTexto = venta.id_global ? venta.id_global : (venta.id ? `${tipo === 'PRESUPUESTO' ? 'PRES' : 'VENTA'}-${venta.id}` : '');

    // ...la nueva declaración de brandImgs y headerLogo ya está más abajo...
    const ivaPct = clampPct(venta.iva_pct != null ? venta.iva_pct : (notaCfg.iva_pct || 0));
    const ivaUSD = totalUSDConDesc * (ivaPct / 100);
    const ivaBs = totalBsDesc * (ivaPct / 100);
    const totalUSDFinal = totalUSDConDesc + ivaUSD;
    const totalBsFinal = totalBsDesc + ivaBs;

    // Determinar los datos de la empresa correctamente (más robusto)
    const empresa = venta.empresa || {};
    let empresaNombre = '';
    if (empresa && typeof empresa.nombre === 'string' && empresa.nombre.trim()) {
      empresaNombre = empresa.nombre.trim();
    } else if (venta.empresa_nombre && typeof venta.empresa_nombre === 'string' && venta.empresa_nombre.trim()) {
      empresaNombre = venta.empresa_nombre.trim();
    } else if (notaCfg.empresa_nombre && typeof notaCfg.empresa_nombre === 'string' && notaCfg.empresa_nombre.trim()) {
      empresaNombre = notaCfg.empresa_nombre.trim();
    } else if (notaCfg.nombre && typeof notaCfg.nombre === 'string' && notaCfg.nombre.trim()) {
      empresaNombre = notaCfg.nombre.trim();
    } else if (typeof window !== 'undefined' && window.configGeneral && window.configGeneral.empresa && window.configGeneral.empresa.nombre) {
      empresaNombre = window.configGeneral.empresa.nombre.trim();
    }
    let empresaRif = empresa.rif || venta.empresa_rif || notaCfg.rif || (typeof window !== 'undefined' && window.configGeneral && window.configGeneral.empresa && window.configGeneral.empresa.rif ? window.configGeneral.empresa.rif : '');
    let empresaTelefonos = empresa.telefonos || venta.empresa_telefonos || notaCfg.telefonos || (typeof window !== 'undefined' && window.configGeneral && window.configGeneral.empresa && window.configGeneral.empresa.telefonos ? window.configGeneral.empresa.telefonos : '');
    let empresaUbicacion = empresa.ubicacion || venta.empresa_ubicacion || notaCfg.ubicacion || (typeof window !== 'undefined' && window.configGeneral && window.configGeneral.empresa && window.configGeneral.empresa.ubicacion ? window.configGeneral.empresa.ubicacion : '');
    let empresaMarcas = venta.empresa_marcas && venta.empresa_marcas.length ? venta.empresa_marcas : (notaCfg.brand_logos || []);
    const brandImgs = empresaMarcas.map(u => `<img src="${u}" style="height:30px;object-fit:contain;margin-left:6px;">`).join('');
    const headerLogoUrl = (empresa.logo_url || venta.empresa_logo_url || notaCfg.header_logo_url || (typeof window !== 'undefined' && window.configGeneral && window.configGeneral.empresa && window.configGeneral.empresa.logo_url ? window.configGeneral.empresa.logo_url : '')).toString();
    const headerLogo = headerLogoUrl ? `<img src="${headerLogoUrl}" style="height:48px;object-fit:contain;">` : '';
    const html = `
      <html>
      <head>
        <title>${tipo} - ${idTexto}</title>
        <style>
          @page { size: letter; margin: 0.2in; }
          body { font-family: Arial, sans-serif; color: #111; font-size: 10px; }
          .sheet { width: 100%; max-width: 8.5in; height: 5.0in; margin: 0 auto; display:flex; flex-direction:column; }
          .top { display: grid; grid-template-columns: 1.4fr 1fr; align-items: center; }
          .brand-strip { text-align: right; }
          .tipo-badge { font-size: 9px; font-weight: 800; letter-spacing: 1px; text-transform: uppercase; border: 1px solid #111; padding: 2px 6px; border-radius: 999px; display:inline-block; }
          .brand-text { text-align: right; font-size: 10px; line-height: 1.1; margin-top: 2px; }
          .center-text { display:none; }
          .main { display:flex; flex-direction:column; flex:1; gap:4px; }
          .boxes { display: grid; grid-template-columns: 2fr 1.2fr; gap: 3px; margin-top: 2px; }
          .box { border: 1px solid #000; padding: 2px 4px; font-size: 10px; }
          .box-row { display: grid; grid-template-columns: 1.05fr 1fr; }
          .box-cell { padding: 1px 0; line-height: 1.1; }
          .table-wrap { flex:0; }
          table { width: 100%; border-collapse: collapse; font-size: 10px; table-layout: fixed; }
          thead th { border: 1px solid #000; padding: 2px 3px; background: #f4f4f4; font-weight: 700; text-transform: uppercase; font-size: 10px; }
          tbody td { border: none; padding: 2px 3px; font-size: 10px; line-height: 1.05; vertical-align: top; }
          tbody tr + tr td { border-top: none; }
          .totales { display: grid; grid-template-columns: 1.5fr 1fr; margin-top: auto; }
          .tot-box { border: 1px solid #000; padding: 4px 6px; font-size: 10px; }
          .tot-row { display: grid; grid-template-columns: 1fr 1fr; margin: 1px 0; }
          .foot-note { text-align: center; font-size: 9px; margin-top: 1px; }
          .sub { font-size: 10px; }
          .right { text-align: right; }
        </style>
      </head>
      <body>
        <div class="sheet">
          <div class="top">
            <div style="display:flex; align-items:center; gap:8px;">
              ${headerLogo}
              <div style="font-size:10px; line-height:1.1;">
                <div style="font-weight:800; font-size:14px; letter-spacing:0.3px;">${empresaNombre}</div>
                <div>${empresaUbicacion}</div>
              </div>
            </div>
            <div class="brand-strip">
              <div style="display:flex; flex-direction:column; align-items:flex-end; gap:2px;">
                <div style="display:flex; gap:6px; align-items:center; margin-bottom:2px;">${brandImgs}</div>
                <div class="brand-text" style="font-size:11px; font-weight:700;">${empresaRif}${empresaRif && empresaTelefonos ? ' / ' : ''}${empresaTelefonos}</div>
                <div class="brand-text" style="font-size:10px;">${notaCfg.encabezado_texto || ''}</div>
              </div>
            </div>
          </div>
          <div class="main">
            <div class="boxes">
              <div class="box">
                <div class="box-row"><div class="box-cell" style="font-weight:700;">CLIENTE</div><div class="box-cell">${venta.cliente || ''}</div></div>
                <div class="box-row"><div class="box-cell" style="font-weight:700;">R.I.F / C.I</div><div class="box-cell">${venta.cedula || ''}</div></div>
                <div class="box-row"><div class="box-cell" style="font-weight:700;">TELEFONOS</div><div class="box-cell">${venta.telefono || ''}</div></div>
                <div class="box-row"><div class="box-cell" style="font-weight:700;">DIRECCION</div><div class="box-cell">${notaCfg.ubicacion || ''}</div></div>
              </div>
              <div class="box">
                <div style="text-align:center; font-weight:800;">${tipo === 'PRESUPUESTO' ? 'PRESUPUESTO' : 'NOTA DESPACHO'}</div>
                <div class="box-row"><div class="box-cell" style="font-weight:700;">EMISION:</div><div class="box-cell">${fechaTexto}</div></div>
                <div class="box-row"><div class="box-cell" style="font-weight:700;">TASA B.C.V</div><div class="box-cell">${tasa.toFixed(2)}</div></div>
                <div class="box-row"><div class="box-cell" style="font-weight:700;">VENDEDOR:</div><div class="box-cell">${venta.vendedor || ''}</div></div>
                <div class="box-row"><div class="box-cell" style="font-weight:700;">NRO:</div><div class="box-cell">${idTexto}</div></div>
              </div>
            </div>

            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th style="width:16%">CODIGO</th>
                    <th style="width:34%">DESCRIPCION</th>
                    <th style="width:8%">CANT</th>
                    <th style="width:10%">PRECIO $</th>
                    <th style="width:10%">TOTAL $</th>
                    <th style="width:10%">PRECIO Bs.</th>
                    <th style="width:12%">TOTAL Bs.</th>
                  </tr>
                </thead>
                <tbody>
                  ${items.map(item => {
                    const lineUsd = number(item.precio_usd) * number(item.cantidad);
                    const lineBs = lineUsd * tasa * multiplicador;
                    const precioBs = number(item.precio_usd) * tasa * multiplicador;
                    return `
                      <tr>
                        <td>${item.codigo}</td>
                        <td>${item.descripcion}</td>
                        <td class="right">${item.cantidad}</td>
                        <td class="right">${number(item.precio_usd).toFixed(2)}</td>
                        <td class="right">${lineUsd.toFixed(2)}</td>
                        <td class="right">${precioBs.toFixed(2)}</td>
                        <td class="right">${lineBs.toFixed(2)}</td>
                      </tr>`;
                  }).join('')}
                </tbody>
              </table>
            </div>

            <div class="totales">
              <div class="box" style="border:1px solid #000; min-height:48px; font-size:9px;">NOTA</div>
              <div class="tot-box">
                <div class="tot-row"><div>Sub-total Bs</div><div class="right">Bs ${totalBsDesc.toFixed(2)}</div></div>
                <div class="tot-row"><div>Impuesto / I.V.A (${ivaPct}%)</div><div class="right">$${ivaUSD.toFixed(2)} / Bs ${ivaBs.toFixed(2)}</div></div>
                <div class="tot-row" style="font-weight:800; grid-template-columns: 1fr 1fr;">
                  <div>${notaCfg.pie || 'Total a Pagar:'}</div>
                  <div class="right">$${totalUSDFinal.toFixed(2)} / Bs ${totalBsFinal.toFixed(2)}</div>
                </div>
              </div>
            </div>
          </div>

          <div class="foot-note">${notaCfg.terminos || ''}</div>
        </div>
      </body>
      </html>
    `;

    return html;
  }

  return { layout: LAYOUT, buildNotaHTML };
});
