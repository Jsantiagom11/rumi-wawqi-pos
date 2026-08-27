import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SCHEMA_VERSION,
  commitShiftFinalization,
  migrateDatabase,
  prepareShiftFinalization,
} from '../lib/shift-core.mjs';

const NOW = new Date('2026-08-26T23:30:00.000Z');

function baseDb(overrides = {}) {
  return {
    schemaVersion: 2,
    platos: [{ id: 'p1', nombre: 'Trucha', precio: 25, stock: 10 }],
    mesas: [{ id: 'M1', nombre: 'Mesa 1', estado: 'libre', orden: [], detalle: '' }],
    cocina: [],
    historial: [{
      id: 1,
      cerradoEn: '2026-08-26T22:00:00.000Z',
      mesa: 'Mesa 1',
      items: [{ id: 'p1', nombre: 'Trucha', precio: 25, cantidad: 2 }],
      total: 50,
    }],
    cierres: [],
    ...overrides,
  };
}

test('prepare returns canonical migrated database for two-phase callers', () => {
  const prepared = prepareShiftFinalization(baseDb(), NOW);
  assert.equal(prepared.database.schemaVersion, SCHEMA_VERSION);
  assert.equal(prepared.database.shift.id, prepared.backup.sourceShiftId);

  const later = new Date(NOW.getTime() + 60_000);
  const committed = commitShiftFinalization(prepared.database, prepared.backup, later);
  assert.equal(committed.database.cierres.length, 1);
});

test('migration preserves unknown table fields for forward compatibility', () => {
  const db = baseDb({
    mesas: [{
      id: 'M1', nombre: 'Mesa 1', estado: 'libre', orden: [], detalle: '', zone: 'terraza',
    }],
  });
  assert.equal(migrateDatabase(db, NOW).mesas[0].zone, 'terraza');
});
