const path = require('path');

process.env.NODE_ENV = process.env.NODE_ENV || 'test';

const db = require(path.join('..', 'db'));
const proveedoresService = require(path.join('..', 'services', 'proveedoresService'));

function resetProveedoresData() {
  db.prepare('DELETE FROM proveedores').run();
}

describe('proveedoresService', () => {
  beforeEach(() => {
    resetProveedoresData();
  });

  test('createProveedor y listProveedores funcionan', () => {
    const prov = proveedoresService.createProveedor({
      nombre: 'Proveedor Uno',
      rif: 'J-123',
      telefono: '000',
      email: 'a@b.com',
      direccion: 'Dir',
      notas: 'Notas',
    });

    expect(prov.id).toBeDefined();
    expect(prov.nombre).toBe('Proveedor Uno');

    const lista = proveedoresService.listProveedores({ q: 'proveedor', soloActivos: true });
    expect(lista.length).toBe(1);
    expect(lista[0].nombre).toBe('Proveedor Uno');
  });

  test('updateProveedor y toggleProveedorActivo actualizan datos', () => {
    const prov = proveedoresService.createProveedor({ nombre: 'Prov', rif: 'J-1' });

    const actualizado = proveedoresService.updateProveedor(prov.id, {
      nombre: 'Prov Editado',
      telefono: '111',
      activo: false,
    });

    expect(actualizado.nombre).toBe('Prov Editado');
    expect(actualizado.telefono).toBe('111');
    expect(actualizado.activo).toBe(false);

    const reactivado = proveedoresService.toggleProveedorActivo(prov.id, true);
    expect(reactivado.activo).toBe(true);
  });
});
