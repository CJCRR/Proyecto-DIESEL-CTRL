/**
 * Tipos compartidos del backend Diesel-CTRL.
 *
 * Este archivo no contiene lógica de negocio, solo definiciones JSDoc
 * pensadas para documentar mejor los servicios y servir como base
 * para una futura migración parcial a TypeScript.
 */

/**
 * Detalle de un ítem vendido dentro de una venta.
 * @typedef {Object} VentaDetalle
 * @property {number} producto_id
 * @property {string} [codigo]
 * @property {string} [descripcion]
 * @property {number} cantidad
 * @property {number} precio_usd
 * @property {number} [costo_usd]
 * @property {number} [subtotal_bs]
 */

/**
 * Registro de venta almacenado en la tabla `ventas`.
 * @typedef {Object} Venta
 * @property {number} id
 * @property {string} fecha ISO string
 * @property {string} cliente
 * @property {string} [vendedor]
 * @property {string} [cedula]
 * @property {string} [telefono]
 * @property {number} tasa_bcv
 * @property {number} descuento
 * @property {string} metodo_pago
 * @property {string} [referencia]
 * @property {number} [total_bs]
 * @property {number} [total_bs_iva]
 * @property {number} [total_usd_iva]
 * @property {number} [iva_pct]
 * @property {number|null} [usuario_id]
 */

/**
 * Payload esperado para registrar una venta desde el POS.
 * @typedef {Object} VentaPayload
 * @property {Array<{codigo:string,cantidad:number}>} items
 * @property {string} cliente
 * @property {string} [vendedor]
 * @property {string} [cedula]
 * @property {string} [telefono]
 * @property {number} tasa_bcv
 * @property {number|string} [descuento]
 * @property {string} [metodo_pago]
 * @property {string} [referencia]
 * @property {number|null} [usuario_id]
 * @property {string} [cliente_doc]
 * @property {boolean} [credito]
 * @property {number|string} [dias_vencimiento]
 * @property {string|null} [fecha_vencimiento]
 * @property {number|string} [iva_pct]
 */

/**
 * Cuenta por cobrar registrada en `cuentas_cobrar`.
 * @typedef {Object} CuentaPorCobrar
 * @property {number} id
 * @property {string} cliente_nombre
 * @property {string} [cliente_doc]
 * @property {number|null} [venta_id]
 * @property {number} total_usd
 * @property {number} tasa_bcv
 * @property {number} saldo_usd
 * @property {string} fecha_emision
 * @property {string} fecha_vencimiento
 * @property {"pendiente"|"parcial"|"cancelado"|"vencido"} estado
 * @property {string} [notas]
 * @property {string} [creado_en]
 * @property {string} [actualizado_en]
 * @property {string} [estado_calc]
 * @property {number} [dias_mora]
 */

/**
 * Pago asociado a una cuenta por cobrar.
 * @typedef {Object} PagoCuentaCobrar
 * @property {number} id
 * @property {number} cuenta_id
 * @property {string} fecha
 * @property {number} monto_usd
 * @property {"USD"|"BS"} moneda
 * @property {number} tasa_bcv
 * @property {number} monto_moneda
 * @property {string|null} [metodo]
 * @property {string|null} [referencia]
 * @property {string|null} [notas]
 * @property {string|null} [usuario]
 */

/**
 * Configuración de la empresa usada en reportes y notas.
 * @typedef {Object} EmpresaConfig
 * @property {string} nombre
 * @property {string} [logo_url]
 * @property {string} [color_primario]
 * @property {string} [color_secundario]
 * @property {string} [color_acento]
 * @property {string} [rif]
 * @property {string} [telefonos]
 * @property {string} [ubicacion]
 * @property {string} [precio1_nombre]
 * @property {number} [precio1_pct]
 * @property {string} [precio2_nombre]
 * @property {number} [precio2_pct]
 * @property {string} [precio3_nombre]
 * @property {number} [precio3_pct]
 */

/**
 * Regla de descuento por volumen.
 * @typedef {Object} DescuentoVolumen
 * @property {number} min_qty
 * @property {number} descuento_pct
 */

/**
 * Configuración de política de devoluciones.
 * @typedef {Object} DevolucionConfig
 * @property {boolean} habilitado
 * @property {number} dias_max
 * @property {boolean} requiere_referencia
 * @property {number} recargo_restock_pct
 */

/**
 * Configuración visual y de textos de la nota de entrega/factura.
 * @typedef {Object} NotaConfig
 * @property {string} [header_logo_url]
 * @property {string[]} [brand_logos]
 * @property {string} [rif]
 * @property {string} [telefonos]
 * @property {string} [ubicacion]
 * @property {string} [direccion_general]
 * @property {string} [encabezado_texto]
 * @property {string} [terminos]
 * @property {string} [pie]
 * @property {string} [pie_usd]
 * @property {string} [pie_bs]
 * @property {number} [iva_pct]
 * @property {string} [resaltar_color]
 * @property {"compact"|"standard"} [layout]
 */

/**
 * Objeto de configuración general que combina empresa, descuentos,
 * política de devoluciones y configuración de nota.
 * @typedef {Object} ConfigGeneral
 * @property {EmpresaConfig} empresa
 * @property {DescuentoVolumen[]} descuentos_volumen
 * @property {DevolucionConfig} devolucion
 * @property {NotaConfig} nota
 */

/**
 * Resultado de obtención o guardado de tasa BCV.
 * @typedef {Object} TasaBcvInfo
 * @property {boolean} ok
 * @property {number} tasa_bcv
 * @property {string} [actualizado_en]
 * @property {number} [previa]
 * @property {string} [error]
 */
