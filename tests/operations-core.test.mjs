import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildOperationsDashboard,
  buildPurchaseSuggestions,
  collectUniqueSales,
  computeIngredientStock,
  computeProductCapacity,
  migrateOperationsDatabase,
  recordPhysicalCount,
  recordPurchase,
  recordWaste,
} from '../lib/operations-core.mjs';

function baseDatabase() {
  return {
    platos: [
      { id: 'p2', nombre: 'Chancho al Palo', precio: 35, stock: 20 },
      { id: 'p7', nombre: 'Lomo Saltado', precio: 40, stock: 8 },
    ],
    mesas: [
      {
        id: 'M1',
        nombre: 'Mesa 1',
        estado: 'ocupada',
        orden: [
          {
            id: 'p2',
            nombre: 'Chancho al Palo',
            cantidad: 1,
            precio: 35,
            creadoEn: '2026-09-07T11:30:00.000Z',
            enviadoCocina: true,
            esManual: false,
          },
        ],
      },
    ],
    historial: [
      {
        id: 1001,
        cerradoEn: '2026-09-07T11:00:00.000Z',
        items: [{ nombre: 'Chancho al Palo', cantidad: 2, precio: 35 }],
        total: 70,
      },
    ],
    cierres: [],
    operations: {
      ingredients: [
        {
          id: 'pork',
          name: 'Chancho',
          unit: 'kg',
          openingQty: 10,
          openingAt: '2026-09-07T10:00:00.000Z',
          reorderPoint: 3,
          targetQty: 8,
          defaultUnitCostCents: 1950,
        },
      ],
      recipes: [
        {
          productId: 'p2',
          productName: 'Chancho al Palo',
          components: [{ ingredientId: 'pork', qty: 0.4 }],
        },
      ],
      purchases: [
        {
          id: 'purchase_1',
          ingredientId: 'pork',
          qty: 2,
          unitCostCents: 1900,
          at: '2026-09-07T10:30:00.000Z',
        },
      ],
      counts: [],
      wastes: [],
    },
  };
}

test('operations migration is non-destructive and initializes missing collections', () => {
  const source = { platos: [{ id: 'p1', stock: 3 }], operations: { ingredients: [] } };
  const migrated = migrateOperationsDatabase(source);

  assert.notEqual(migrated, source);
  assert.deepEqual(source, { platos: [{ id: 'p1', stock: 3 }], operations: { ingredients: [] } });
  assert.equal(migrated.operations.schemaVersion, 1);
  assert.deepEqual(migrated.operations.recipes, []);
  assert.deepEqual(migrated.operations.purchases, []);
  assert.deepEqual(migrated.operations.counts, []);
  assert.deepEqual(migrated.operations.wastes, []);
});

test('derived stock uses purchases, closed sales and active orders without extra input', () => {
  const stock = computeIngredientStock(baseDatabase(), 'pork');
  assert.equal(stock.quantity, 10.8);
});

test('closed sales are deduplicated across current history and closure backups', () => {
  const db = baseDatabase();
  db.cierres = [
    { id: 'backup', ventas: [structuredClone(db.historial[0])] },
    { id: 'closure', sales: [structuredClone(db.historial[0])] },
  ];

  assert.equal(collectUniqueSales(db).length, 1);
  assert.equal(computeIngredientStock(db, 'pork').quantity, 10.8);
});

test('latest physical count reanchors stock and ignores older active orders', () => {
  let db = baseDatabase();
  db = recordPhysicalCount(db, { ingredientId: 'pork', qty: 5 }, new Date('2026-09-07T12:00:00.000Z'));
  db = recordPurchase(db, { ingredientId: 'pork', qty: 1, unitCostCents: 2000 }, new Date('2026-09-07T12:30:00.000Z'));
  db.historial.push({
    id: 1002,
    cerradoEn: '2026-09-07T13:00:00.000Z',
    items: [{ nombre: 'Chancho al Palo', cantidad: 1, precio: 35 }],
    total: 35,
  });
  db.mesas[0].orden.push({
    id: 'p2',
    nombre: 'Chancho al Palo',
    cantidad: 1,
    precio: 35,
    creadoEn: '2026-09-07T13:30:00.000Z',
    enviadoCocina: false,
    esManual: false,
  });

  assert.equal(computeIngredientStock(db, 'pork').quantity, 5.2);
});

test('waste is an explicit exception and reduces stock after the latest count', () => {
  let db = baseDatabase();
  db = recordPhysicalCount(db, { ingredientId: 'pork', qty: 5 }, new Date('2026-09-07T12:00:00.000Z'));
  db = recordWaste(db, { ingredientId: 'pork', qty: 0.3 }, new Date('2026-09-07T12:10:00.000Z'));

  assert.equal(computeIngredientStock(db, 'pork').quantity, 4.7);
});

test('BOM capacity is constrained by ingredient stock', () => {
  const capacity = computeProductCapacity(baseDatabase(), { id: 'p2', nombre: 'Chancho al Palo', stock: 20 });
  assert.equal(capacity.source, 'derived-bom');
  assert.equal(capacity.capacity, 27);
  assert.equal(capacity.constraints[0].ingredientId, 'pork');
});

test('tracked ingredients activate only after the first count and preserve legacy capacity before then', () => {
  let db = baseDatabase();
  db.operations.ingredients[0].openingQty = null;
  db.operations.ingredients[0].openingAt = null;
  db.operations.purchases = [];

  const before = computeProductCapacity(db, db.platos[0]);
  assert.equal(before.source, 'legacy-awaiting-count');
  assert.equal(before.capacity, 20);
  assert.equal(computeIngredientStock(db, 'pork').initialized, false);

  db = recordPhysicalCount(db, { ingredientId: 'pork', qty: 7 }, new Date('2026-09-07T12:00:00.000Z'));
  const after = computeProductCapacity(db, db.platos[0]);
  assert.equal(after.source, 'derived-bom');
  assert.equal(after.capacity, 17);
});

test('products without a BOM preserve legacy plate-stock behavior', () => {
  const capacity = computeProductCapacity(baseDatabase(), { id: 'p7', nombre: 'Lomo Saltado', stock: 8 });
  assert.equal(capacity.source, 'legacy-plate-stock');
  assert.equal(capacity.capacity, 8);
});

test('incomplete BOMs degrade safely instead of crashing the dashboard', () => {
  const db = baseDatabase();
  db.operations.recipes.push({
    productId: 'p7',
    productName: 'Lomo Saltado',
    components: [{ ingredientId: 'beef', qty: 0.22 }],
  });

  const dashboard = buildOperationsDashboard(db);
  const lomo = dashboard.capacities.find((entry) => entry.productId === 'p7');
  assert.equal(lomo.source, 'incomplete-bom');
  assert.equal(lomo.capacity, null);
  assert.ok(dashboard.risks.some((risk) => risk.code === 'INCOMPLETE_BOM'));
});

test('purchase suggestions only appear below the reorder point and reuse latest cost', () => {
  let db = baseDatabase();
  db = recordPhysicalCount(db, { ingredientId: 'pork', qty: 2 }, new Date('2026-09-07T12:00:00.000Z'));
  db = recordPurchase(db, { ingredientId: 'pork', qty: 0.5, unitCostCents: 2100 }, new Date('2026-09-07T12:30:00.000Z'));

  const [suggestion] = buildPurchaseSuggestions(db);
  assert.equal(suggestion.ingredientId, 'pork');
  assert.equal(suggestion.currentQty, 2.5);
  assert.equal(suggestion.buyQty, 5.5);
  assert.equal(suggestion.unitCostCents, 2100);
  assert.equal(suggestion.estimatedCostCents, 11550);
});

test('manual pool items never consume configured ingredients', () => {
  const db = baseDatabase();
  db.mesas[0].orden.push({
    id: 'm_1',
    nombre: '[Esp] Chancho promo',
    cantidad: 10,
    precio: 1,
    creadoEn: '2026-09-07T11:40:00.000Z',
    esManual: true,
  });
  assert.equal(computeIngredientStock(db, 'pork').quantity, 10.8);
});
