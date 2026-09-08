import assert from 'node:assert/strict';
import test from 'node:test';

import { bootstrapTrustedOperationsProfile } from '../lib/operations-bootstrap.mjs';
import { computeProductCapacity, recordPhysicalCount } from '../lib/operations-core.mjs';

function legacyDatabase() {
  return {
    platos: [
      { id: 'p2', nombre: 'Chancho al Palo', precio: 35, stock: 20 },
      { id: 'p7', nombre: 'Lomo Saltado', precio: 40, stock: 9 },
      { id: 'p5', nombre: 'Pachamanca', precio: 40, stock: 25 },
    ],
    mesas: [],
    historial: [],
    cierres: [],
  };
}

test('trusted profile adds only confirmed protein BOMs and waits for first physical count', () => {
  const db = bootstrapTrustedOperationsProfile(legacyDatabase());

  assert.equal(db.operations.profileVersion, 1);
  assert.deepEqual(db.operations.ingredients.map((entry) => entry.id), ['pork_raw', 'beef_lomo_raw']);
  assert.deepEqual(db.operations.recipes.map((entry) => entry.productId), ['p2', 'p7']);
  assert.equal(db.operations.recipes.some((entry) => entry.productId === 'p5'), false);

  const pork = computeProductCapacity(db, db.platos[0]);
  const lomo = computeProductCapacity(db, db.platos[1]);
  assert.equal(pork.source, 'legacy-awaiting-count');
  assert.equal(pork.capacity, 20);
  assert.equal(lomo.source, 'legacy-awaiting-count');
  assert.equal(lomo.capacity, 9);
});

test('trusted profile is idempotent', () => {
  const once = bootstrapTrustedOperationsProfile(legacyDatabase());
  const twice = bootstrapTrustedOperationsProfile(once);

  assert.deepEqual(twice.operations, once.operations);
});

test('trusted profile never overwrites existing ingredient policy or user recipe', () => {
  const source = legacyDatabase();
  source.operations = {
    ingredients: [
      {
        id: 'pork_raw',
        name: 'Mi chancho',
        unit: 'kg',
        openingQty: 4,
        openingAt: '2026-09-07T10:00:00.000Z',
        reorderPoint: 2,
        targetQty: 9,
        defaultUnitCostCents: 2300,
      },
    ],
    recipes: [
      {
        productId: 'p2',
        productName: 'Chancho al Palo',
        components: [{ ingredientId: 'pork_raw', qty: 0.5 }],
      },
    ],
    purchases: [],
    counts: [],
    wastes: [],
  };

  const db = bootstrapTrustedOperationsProfile(source);
  const pork = db.operations.ingredients.find((entry) => entry.id === 'pork_raw');
  const recipe = db.operations.recipes.find((entry) => entry.productId === 'p2');

  assert.equal(pork.name, 'Mi chancho');
  assert.equal(pork.reorderPoint, 2);
  assert.equal(pork.targetQty, 9);
  assert.equal(recipe.components[0].qty, 0.5);
});

test('first counts activate canonical safe capacities for chancho and lomo', () => {
  let db = bootstrapTrustedOperationsProfile(legacyDatabase());
  db = recordPhysicalCount(db, { ingredientId: 'pork_raw', qty: 7 }, new Date('2026-09-07T12:00:00.000Z'));
  db = recordPhysicalCount(db, { ingredientId: 'beef_lomo_raw', qty: 2 }, new Date('2026-09-07T12:00:01.000Z'));

  const pork = computeProductCapacity(db, db.platos[0]);
  const lomo = computeProductCapacity(db, db.platos[1]);
  assert.equal(pork.source, 'derived-bom');
  assert.equal(pork.capacity, 16);
  assert.equal(lomo.source, 'derived-bom');
  assert.equal(lomo.capacity, 9);
});

test('unstandardized pachamanca remains on legacy plate stock', () => {
  const db = bootstrapTrustedOperationsProfile(legacyDatabase());
  const pachamanca = computeProductCapacity(db, db.platos[2]);

  assert.equal(pachamanca.source, 'legacy-plate-stock');
  assert.equal(pachamanca.capacity, 25);
});
