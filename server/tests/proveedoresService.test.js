const path = require('path');

process.env.NODE_ENV = process.env.NODE_ENV || 'test';

const db = require(path.join('..', 'db'));
const proveedoresService = require(path.join('..', 'services', 'proveedoresService'));

function resetProveedoresData() {
  db.prepare('DELETE FROM compras').run();
  db.prepare('UPDATE productos SET proveedor_id = NULL WHERE proveedor_id IS NOT NULL').run();
  db.prepare('DELETE FROM proveedores').run();
}

describe('proveedoresService', () => {
  beforeEach(() => {
    resetProveedoresData();
  });

  test('createProveedor y listProveedores funcionan', () => {
    const empresaId = 1;

    const prov = proveedoresService.createProveedor({
      nombre: 'Proveedor Uno',
      rif: 'J-123',
      telefono: '000',
      email: 'a@b.com',
      direccion: 'Dir',
      notas: 'Notas',
    }, empresaId);

    expect(prov.id).toBeDefined();
    expect(prov.nombre).toBe('Proveedor Uno');

    const lista = proveedoresService.listProveedores({ q: 'proveedor', soloActivos: true, empresaId });
    expect(lista.length).toBe(1);
    expect(lista[0].nombre).toBe('Proveedor Uno');
  });

  test('updateProveedor y toggleProveedorActivo actualizan datos', () => {
    const empresaId = 1;
    const prov = proveedoresService.createProveedor({ nombre: 'Prov', rif: 'J-1' }, empresaId);

    const actualizado = proveedoresService.updateProveedor(prov.id, {
      nombre: 'Prov Editado',
      telefono: '111',
      activo: false,
    }, empresaId);

    expect(actualizado.nombre).toBe('Prov Editado');
    expect(actualizado.telefono).toBe('111');
    expect(actualizado.activo).toBe(false);

    const reactivado = proveedoresService.toggleProveedorActivo(prov.id, true, empresaId);
    expect(reactivado.activo).toBe(true);
  });

  test('deleteProveedor elimina proveedor sin compras y limpia referencia en productos', () => {
    const empresaId = 1;
    const prov = proveedoresService.createProveedor({ nombre: 'Prov Delete', rif: 'J-DEL' }, empresaId);

    const prod = db.prepare(
      'INSERT INTO productos (codigo, descripcion, precio_usd, costo_usd, stock, proveedor_id, empresa_id) VALUES (?,?,?,?,?,?,?)'
    ).run('PROV-DEL-1', 'Prod vinculado', 10, 5, 2, prov.id, empresaId);

    const deleted = proveedoresService.deleteProveedor(prov.id, empresaId);
    expect(deleted).toEqual({ id: prov.id });

    const providerAfter = db.prepare('SELECT id FROM proveedores WHERE id = ?').get(prov.id);
    const productAfter = db.prepare('SELECT proveedor_id FROM productos WHERE id = ?').get(prod.lastInsertRowid);
    expect(providerAfter).toBeUndefined();
    expect(productAfter.proveedor_id).toBeNull();
  });

  test('deleteProveedor bloquea eliminación si el proveedor tiene compras', () => {
    const empresaId = 1;
    const prov = proveedoresService.createProveedor({ nombre: 'Prov Compras', rif: 'J-COMP' }, empresaId);
    const userInfo = db.prepare('INSERT INTO usuarios (username, password, rol, activo, empresa_id) VALUES (?, ?, ?, 1, ?)').run(
      `prov_user_${Math.random().toString(36).slice(2, 8)}`,
      'x',
      'admin',
      empresaId
    );

    db.prepare(
      'INSERT INTO compras (proveedor_id, fecha, numero, tasa_bcv, total_bs, total_usd, estado, notas, usuario_id, empresa_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(prov.id, '2026-06-30', 'OC-1', 1, 10, 10, 'recibida', '', userInfo.lastInsertRowid, empresaId);

    expect(() => proveedoresService.deleteProveedor(prov.id, empresaId)).toThrow('No se puede eliminar este proveedor porque tiene compras registradas.');
  });

  test('listProveedores respeta empresaId y no mezcla empresas', () => {
    const empresaA = 1;
    const empresaB = 2;

    const provA = proveedoresService.createProveedor({ nombre: 'Prov A', rif: 'J-A' }, empresaA);
    const provB = proveedoresService.createProveedor({ nombre: 'Prov B', rif: 'J-B' }, empresaB);

    const listaA = proveedoresService.listProveedores({ q: 'Prov', soloActivos: true, empresaId: empresaA });
    const listaB = proveedoresService.listProveedores({ q: 'Prov', soloActivos: true, empresaId: empresaB });

    expect(listaA.find(p => p.id === provB.id)).toBeUndefined();
    expect(listaB.find(p => p.id === provA.id)).toBeUndefined();
  });
});
