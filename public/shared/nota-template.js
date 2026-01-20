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
        cantidad: number(it.cantidad),
        precio_usd: number(it.precio_usd)
      }));
    }
    if (Array.isArray(detalles)) {
      return detalles.map(d => ({
        codigo: d.codigo || '',
        descripcion: d.descripcion || '',
        cantidad: number(d.cantidad),
        precio_usd: number(d.precio_usd)
      }));
    }
    return [];
  }

  function buildNotaHTML({ venta = {}, detalles = [] }) {
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
    const fechaTexto = (typeof window !== 'undefined' && window.toLocaleString)
      ? fecha.toLocaleString()
      : fecha.toISOString();

    const idTexto = venta.id_global ? venta.id_global : (venta.id ? `VENTA-${venta.id}` : '');

    const html = `
      <html>
      <head>
        <title>Nota de Entrega - ${idTexto}</title>
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
          <p>ID: ${idTexto}</p>
        </div>
        <div class="info">
          <div>
            <p><strong>Cliente:</strong> ${venta.cliente || ''}</p>
            ${venta.cedula ? `<p><strong>Cédula:</strong> ${venta.cedula}</p>` : ''}
            ${venta.telefono ? `<p><strong>Teléfono:</strong> ${venta.telefono}</p>` : ''}
            <p><strong>Fecha:</strong> ${fechaTexto}</p>
          </div>
          <div>
            <p><strong>Tasa:</strong> ${tasa.toFixed(2)} Bs/$</p>
            <p><strong>Descuento:</strong> ${descuentoPct}%</p>
            <p><strong>Método:</strong> ${metodo}</p>
            ${venta.referencia ? `<p><strong>Referencia:</strong> ${String(venta.referencia)}</p>` : ''}
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
          <p><strong>Total USD:</strong> $${totalUSDConDesc.toFixed(2)}</p>
          <p><strong>Total Bs:</strong> ${totalBsDesc.toFixed(2)} Bs</p>
        </div>
        <div class="no-print" style="margin-top: 30px; text-align: center;">
          <button onclick="window.print()" style="padding: 10px 20px; background: #2563eb; color: white; border: none; border-radius: 5px; cursor: pointer;">Imprimir Nota</button>
        </div>
      </body>
      </html>
    `;

    return html;
  }

  return { buildNotaHTML };
});
