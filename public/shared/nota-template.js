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
    // 1) Preferir siempre la config cargada globalmente en el POS (por empresa)
    try {
      if (typeof window !== 'undefined' && window.configGeneral && window.configGeneral.nota) {
        const empresa = window.configGeneral.empresa || {};
        const notaBase = window.configGeneral.nota || {};
        const nota = { ...notaBase };
        if (empresa && typeof empresa.nombre === 'string' && empresa.nombre.trim() && !nota.empresa_nombre) {
          nota.empresa_nombre = empresa.nombre.trim();
        }
        try { if (typeof localStorage !== 'undefined') localStorage.setItem('nota_config', JSON.stringify(nota)); } catch {}
        return nota;
      }
    } catch {}

    // 2) Cache local
    try {
      const cached = typeof localStorage !== 'undefined' ? localStorage.getItem('nota_config') : null;
      if (cached) return JSON.parse(cached);
    } catch {}

    // 3) Solicitar al backend si estamos en navegador
    if (typeof fetch !== 'undefined') {
      try {
        const res = await fetch('/admin/ajustes/config', { credentials: 'same-origin' });
        if (res.ok) {
          const j = await res.json();
          const empresa = j && j.empresa ? j.empresa : {};
          const notaBase = j && j.nota ? j.nota : {};
          const nota = { ...notaBase };
          if (empresa && typeof empresa.nombre === 'string' && empresa.nombre.trim() && !nota.empresa_nombre) {
            nota.empresa_nombre = empresa.nombre.trim();
          }
          try { if (typeof localStorage !== 'undefined') localStorage.setItem('nota_config', JSON.stringify(nota)); } catch {}
          return nota;
        }
      } catch {}
    }
    return {
      header_logo_url: '', brand_logos: [], rif: '', telefonos: '', ubicacion: '',
      encabezado_texto: '¡Tu Proveedor de Confianza!', terminos: '', pie: 'Total a Pagar:', resaltar_color: '#fff59d'
    };
  }

  async function buildNotaHTML({ venta = {}, detalles = [] }, meta = {}) {
    const notaCfg = (meta && meta.notaCfg && typeof meta.notaCfg === 'object')
      ? meta.notaCfg
      : await getNotaConfig();
    const tasa = number(venta.tasa_bcv) || 1;
    const direccionGeneralCliente = notaCfg.direccion_general || notaCfg.ubicacion || '';

    // Descuento ahora es un monto fijo en USD, no un porcentaje
    const descuentoUsdRaw = number(venta.descuento);
    let descuentoUsd = descuentoUsdRaw > 0 ? descuentoUsdRaw : 0;

    const items = normalizeItems(venta, detalles);
    let totalUSDBase = 0;
    let totalBsBase = 0;

    items.forEach(item => {
      const lineUsd = number(item.precio_usd) * number(item.cantidad);
      const lineBs = lineUsd * tasa;
      totalUSDBase += lineUsd;
      totalBsBase += lineBs;
    });

    const maxDescUsd = Math.max(0, totalUSDBase);
    const aplicadoDescUsd = Math.min(descuentoUsd, maxDescUsd);
    const aplicadoDescBs = aplicadoDescUsd * tasa;

    const baseUsdDesc = totalUSDBase - aplicadoDescUsd;
    const baseBsDesc = totalBsBase - aplicadoDescBs;
    const fecha = venta.fecha ? new Date(venta.fecha) : new Date();
    const fechaTexto = (typeof window !== 'undefined' && window.toLocaleDateString)
      ? fecha.toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric' })
      : fecha.toISOString().slice(0, 10);
    const tipo = (meta && meta.tipo) ? String(meta.tipo) : (venta.tipo || '').toUpperCase() === 'PRESUPUESTO' ? 'PRESUPUESTO' : 'NOTA DE ENTREGA';
    const mostrarMarca = tipo === 'PRESUPUESTO';
    // Preferir siempre un número de nota amigable si existe (por ejemplo "VENTA-18"),
    // y caer de regreso al id_global técnico solo si no hay otro.
    const idTexto = venta.nro_nota
      || venta.id_nota
      || venta.numero_nota
      || (venta.id_global ? venta.id_global : (venta.id ? `${tipo === 'PRESUPUESTO' ? 'PRES' : 'VENTA'}-0${venta.id}` : ''));

    const ivaPct = clampPct(venta.iva_pct != null ? venta.iva_pct : (notaCfg.iva_pct || 0));
    const igtfPct = clampPct(venta.igtf_pct != null ? venta.igtf_pct : (notaCfg.igtf_pct || 0));

    let ivaUSD = baseUsdDesc * (ivaPct / 100);
    let ivaBs = baseBsDesc * (ivaPct / 100);
    let igtfUSD = baseUsdDesc * (igtfPct / 100);
    let igtfBs = baseBsDesc * (igtfPct / 100);
    let totalUSDFinal = baseUsdDesc + ivaUSD + igtfUSD;
    let totalBsFinal = baseBsDesc + ivaBs + igtfBs;

    // Si no hay IGTF configurado, seguir respetando totales del backend
    // para que nota y reportes coincidan exactamente.
    if (!igtfPct) {
      const hasTotalesBackendUsd = venta.total_usd_iva != null && Number(venta.total_usd_iva) > 0;
      const hasTotalesBackendBs = venta.total_bs_iva != null && Number(venta.total_bs_iva) > 0;
      if (hasTotalesBackendUsd || hasTotalesBackendBs) {
        const canonicalUsd = hasTotalesBackendUsd
          ? Number(venta.total_usd_iva)
          : (tasa ? Number(venta.total_bs_iva) / tasa : baseUsdDesc + ivaUSD);
        const canonicalBs = hasTotalesBackendBs
          ? Number(venta.total_bs_iva)
          : canonicalUsd * tasa;
        totalUSDFinal = canonicalUsd;
        totalBsFinal = canonicalBs;
        // Recalcular IVA como diferencia entre total y base con descuento
        ivaUSD = Math.max(0, totalUSDFinal - baseUsdDesc);
        ivaBs = Math.max(0, totalBsFinal - baseBsDesc);
        igtfUSD = 0;
        igtfBs = 0;
      }
    }

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

    // Construir texto de método de pago + referencia para el bloque NOTA
    const metodoPagoRaw = (venta.metodo_pago || '').toString().trim();
    const referenciaPagoRaw = (venta.referencia || '').toString().trim();
    let notaPagoHtml = '';
    if (metodoPagoRaw || referenciaPagoRaw) {
      const partes = [];
      if (metodoPagoRaw) partes.push(metodoPagoRaw.toUpperCase());
      if (referenciaPagoRaw) partes.push(`REF# ${referenciaPagoRaw}`);
      notaPagoHtml = `<div>${partes.join('. ')}</div>`;
    }

    // Plantilla HTML completa (similar a la compacta, pero marcada como "standard")
    const html = `
      <html>
      <head>
        <title>${tipo} - ${idTexto}</title>
        <style>
          @page { size: letter; margin: 0.2in; }
          body { font-family: Arial, sans-serif; color: #111; font-size: 10px; }
          .sheet { width: 100%; max-width: 8.5in; min-height: 9.5in; margin: 0 auto; display:flex; flex-direction:column; }
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
          thead th { border: 1px solid #000; padding: 3px 4px; background: #f4f4f4; font-weight: 700; text-transform: uppercase; font-size: 10px; }
          tbody td { border: none; padding: 3px 4px; font-size: 10px; line-height: 1.15; vertical-align: top; }
          tbody tr + tr td { border-top: none; }
          .totales { display: grid; grid-template-columns: 1.5fr 1fr; margin-top: auto; }
          .tot-box { border: 1px solid #000; padding: 6px 8px; font-size: 10px; }
          .tot-row { display: grid; grid-template-columns: 1fr 1fr; margin: 2px 0; }
          .foot-note { text-align: center; font-size: 9px; margin-top: 4px; }
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
                <div class="box-row"><div class="box-cell" style="font-weight:700;">DIRECCION</div><div class="box-cell">${direccionGeneralCliente}</div></div>
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
                    <th style="width:${mostrarMarca ? '34%' : '44%'}">DESCRIPCION</th>
                    ${mostrarMarca ? '<th style="width:10%">MARCA</th>' : ''}
                    <th style="width:7%">CANT</th>
                    <th style="width:7%">PRECIO $</th>
                    <th style="width:7%">TOTAL $</th>
                    <th style="width:10%">PRECIO Bs.</th>
                    <th style="width:12%">TOTAL Bs.</th>
                  </tr>
                </thead>
                <tbody>
                  ${items.map(item => {
                    const lineUsd = number(item.precio_usd) * number(item.cantidad);
                    const lineBs = lineUsd * tasa;
                    const precioBs = number(item.precio_usd) * tasa;
                    return `
                      <tr>
                        <td>${item.codigo}</td>
                        <td>${item.descripcion}</td>
                        ${mostrarMarca ? `<td>${item.marca || ''}</td>` : ''}
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
              <div class="box" style="border:1px solid #000; min-height:72px; font-size:15px;">
                <div style="font-weight:800; margin-bottom:2px; ">NOTA</div>
                <div class="nota-metodo" style="font-size:13px; margin-top:10px">${notaPagoHtml}</div>
              </div>
              <div class="tot-box">
                <div class="tot-row"><div>Sub-total Bs</div><div class="right">Bs ${totalBsBase.toFixed(2)}</div></div>
                ${aplicadoDescUsd > 0 ? `<div class="tot-row"><div>Descuento</div><div class="right">$${aplicadoDescUsd.toFixed(2)} / Bs ${aplicadoDescBs.toFixed(2)}</div></div>` : ''}
                ${ivaPct ? `<div class="tot-row"><div>I.V.A (${ivaPct}%)</div><div class="right">$${ivaUSD.toFixed(2)} / Bs ${ivaBs.toFixed(2)}</div></div>` : ''}
                ${igtfPct ? `<div class="tot-row"><div>IGTF (${igtfPct}%)</div><div class="right">$${igtfUSD.toFixed(2)} / Bs ${igtfBs.toFixed(2)}</div></div>` : ''}
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

  return { layout: 'standard', buildNotaHTML };
});
