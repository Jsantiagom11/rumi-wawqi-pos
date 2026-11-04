import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BACKUP_KIND,
  DomainError,
  SCHEMA_VERSION,
  auditDatabase,
  buildAccountingScenario,
  commitShiftFinalization,
  createAccountingSnapshot,
  migrateDatabase,
  moneyToCents,
  prepareShiftFinalization,
  recoverDatabase,
  summarizeShift,
  validateRecoveryPayload,
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

function expectDomainError(fn, code) {
  assert.throws(fn, (error) => error instanceof DomainError && error.code === code);
}

test('money uses integer cents and rounds decimal artifacts', () => {
  assert.equal(moneyToCents(0.1 + 0.2), 30);
  assert.equal(moneyToCents('25.50'), 2550);
  expectDomainError(() => moneyToCents('abc'), 'INVALID_MONEY');
});

test('migration is non-destructive and upgrades schema', () => {
  const input = baseDb({ customField: { keep: true } });
  const migrated = migrateDatabase(input, NOW);
  assert.equal(migrated.schemaVersion, SCHEMA_VERSION);
  assert.deepEqual(migrated.customField, { keep: true });
  assert.equal(migrated.historial.length, 1);
  assert.ok(Array.isArray(migrated.accountingLab));
  assert.ok(Array.isArray(migrated.backupReceipts));
  assert.ok(migrated.shift.id.startsWith('shift_'));
  assert.notStrictEqual(migrated, input);
});

test('migration repairs table state when an order exists', () => {
  const migrated = migrateDatabase(baseDb({
    mesas: [{ id: 'M1', nombre: 'Mesa 1', estado: 'libre', orden: [{ id: 'p1', nombre: 'Trucha', precio: 25, cantidad: 1 }], detalle: '' }],
  }), NOW);
  assert.equal(migrated.mesas[0].estado, 'ocupada');
});

test('summary uses cents and counts tickets/items', () => {
  const summary = summarizeShift(baseDb());
  assert.equal(summary.tickets, 1);
  assert.equal(summary.itemCount, 2);
  assert.equal(summary.totalCents, 5000);
  assert.equal(summary.total, 50);
});

test('pre-finalization creates a complete immutable backup', () => {
  const db = baseDb();
  const { backup, summary } = prepareShiftFinalization(db, NOW);
  assert.equal(backup.kind, BACKUP_KIND);
  assert.equal(backup.schemaVersion, SCHEMA_VERSION);
  assert.equal(summary.totalCents, 5000);
  assert.equal(backup.database.historial.length, 1);
  assert.match(backup.snapshotHash, /^fnv1a32:/);
  backup.database.historial[0].total = 999;
  assert.equal(db.historial[0].total, 50);
});

test('finalization is blocked with active table orders', () => {
  const db = baseDb({
    mesas: [{ id: 'M1', nombre: 'Mesa 1', estado: 'ocupada', orden: [{ id: 'p1', nombre: 'Trucha', precio: 25, cantidad: 1 }], detalle: '' }],
  });
  expectDomainError(() => prepareShiftFinalization(db, NOW), 'ACTIVE_TABLES');
});

test('finalization is blocked with pending kitchen tickets', () => {
  const db = baseDb({ cocina: [{ id: 1, desc: '1x Trucha' }] });
  expectDomainError(() => prepareShiftFinalization(db, NOW), 'PENDING_KITCHEN');
});

test('finalization is blocked for an empty shift', () => {
  expectDomainError(() => prepareShiftFinalization(baseDb({ historial: [] }), NOW), 'EMPTY_SHIFT');
});

test('commit refuses to run without prepared backup', () => {
  expectDomainError(() => commitShiftFinalization(baseDb(), null, NOW), 'BACKUP_REQUIRED');
});

test('commit refuses stale backup after a new sale', () => {
  const db = migrateDatabase(baseDb(), NOW);
  const { backup } = prepareShiftFinalization(db, NOW);
  db.historial.push({ id: 2, items: [{ nombre: 'Agua', precio: 3, cantidad: 1 }], total: 3 });
  expectDomainError(() => commitShiftFinalization(db, backup, NOW), 'STALE_BACKUP');
});

test('successful commit archives sales, clears only active history, and creates accounting snapshot', () => {
  const db = baseDb();
  const { backup } = prepareShiftFinalization(db, NOW);
  const result = commitShiftFinalization(db, backup, NOW);
  assert.equal(result.database.historial.length, 0);
  assert.equal(result.database.cierres.length, 1);
  assert.equal(result.database.cierres[0].sales.length, 1);
  assert.equal(result.database.accountingLab.length, 1);
  assert.equal(result.database.backupReceipts.length, 1);
  assert.notEqual(result.database.shift.id, migrateDatabase(db, NOW).shift.id);
  assert.equal(db.historial.length, 1, 'input database must remain untouched');
});

test('accounting snapshot is based on real shift totals and product mix', () => {
  const snapshot = createAccountingSnapshot(baseDb(), 'closure_1', NOW);
  assert.equal(snapshot.basis.grossSalesCents, 5000);
  assert.equal(snapshot.basis.products[0].name, 'Trucha');
  assert.equal(snapshot.basis.products[0].quantity, 2);
});

test('educational scenario clearly separates real basis from hypothetical variance', () => {
  const snapshot = createAccountingSnapshot(baseDb(), 'closure_1', NOW);
  const scenario = buildAccountingScenario(snapshot);
  assert.equal(scenario.educational, true);
  assert.equal(scenario.realBasis.grossSalesCents, 5000);
  assert.match(scenario.guardrail, /simulado/i);
  assert.match(scenario.prompt, /HIPOTÉTICO/);
});

test('recovery validation rejects malformed, wrong kind, future schema and incomplete backups', () => {
  assert.equal(validateRecoveryPayload(null).ok, false);
  assert.equal(validateRecoveryPayload({}).ok, false);
  const { backup } = prepareShiftFinalization(baseDb(), NOW);
  assert.equal(validateRecoveryPayload({ ...backup, kind: 'wrong' }).ok, false);
  assert.equal(validateRecoveryPayload({ ...backup, schemaVersion: SCHEMA_VERSION + 1 }).ok, false);
  assert.equal(validateRecoveryPayload({ ...backup, database: null }).ok, false);
});

test('recovery validation rejects corrupted backup checksum', () => {
  const { backup } = prepareShiftFinalization(baseDb(), NOW);
  backup.database.historial[0].total = 49;
  const result = validateRecoveryPayload(backup);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((message) => /checksum/.test(message)));
});

test('recovery validation rejects internally inconsistent sale even with recomputed-looking metadata', () => {
  const { backup } = prepareShiftFinalization(baseDb(), NOW);
  backup.database.historial[0].total = 49;
  delete backup.snapshotHash;
  const result = validateRecoveryPayload(backup);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((message) => /snapshotHash/.test(message)));
});

test('recovery never silently overwrites active tables', () => {
  const { backup } = prepareShiftFinalization(baseDb(), NOW);
  const current = baseDb({
    mesas: [{ id: 'M1', nombre: 'Mesa 1', estado: 'ocupada', orden: [{ id: 'p1', nombre: 'Trucha', precio: 25, cantidad: 1 }], detalle: '' }],
  });
  expectDomainError(() => recoverDatabase(current, backup), 'ACTIVE_TABLES_PRESENT');
});

test('recovery succeeds when current state has no active orders', () => {
  const source = baseDb();
  const { backup } = prepareShiftFinalization(source, NOW);
  const recovered = recoverDatabase(baseDb({ historial: [] }), backup);
  assert.equal(recovered.historial.length, 1);
  assert.equal(recovered.historial[0].total, 50);
});

test('audit catches mismatched sale totals', () => {
  const db = baseDb();
  db.historial[0].total = 40;
  const audit = auditDatabase(db);
  assert.equal(audit.ok, false);
  assert.ok(audit.findings.some((finding) => finding.code === 'SALE_TOTAL_MISMATCH'));
});

test('audit passes a valid database', () => {
  const audit = auditDatabase(baseDb());
  assert.equal(audit.ok, true);
  assert.equal(audit.findings.length, 0);
});

test('backup from another shift cannot authorize finalization', () => {
  const db = migrateDatabase(baseDb(), NOW);
  const { backup } = prepareShiftFinalization(db, NOW);
  const other = { ...db, shift: { id: 'shift_other', openedAt: db.shift.openedAt } };
  expectDomainError(() => commitShiftFinalization(other, backup, NOW), 'STALE_BACKUP');
});

test('finalization preserves menu, tables and prior closures', () => {
  const prior = { id: 'closure_old', sales: [] };
  const db = baseDb({ cierres: [prior] });
  const { backup } = prepareShiftFinalization(db, NOW);
  const { database } = commitShiftFinalization(db, backup, NOW);
  assert.deepEqual(database.platos, migrateDatabase(db, NOW).platos);
  assert.deepEqual(database.mesas, migrateDatabase(db, NOW).mesas);
  assert.equal(database.cierres[0].id, 'closure_old');
  assert.equal(database.cierres.length, 2);
});

test('recovery can overwrite only when explicitly opted in', () => {
  const { backup } = prepareShiftFinalization(baseDb(), NOW);
  const current = baseDb({
    mesas: [{ id: 'M9', nombre: 'Mesa 9', estado: 'ocupada', orden: [{ id: 'p1', nombre: 'Trucha', precio: 25, cantidad: 1 }], detalle: '' }],
  });
  const recovered = recoverDatabase(current, backup, { allowActiveOverwrite: true });
  assert.equal(recovered.mesas[0].id, 'M1');
  assert.equal(recovered.historial.length, 1);
});

test('malformed orders are discarded during migration instead of poisoning totals', () => {
  const db = baseDb({
    historial: [{
      id: 1,
      items: [
        { nombre: 'bad-negative', precio: -1, cantidad: 1 },
        { nombre: 'bad-zero-qty', precio: 10, cantidad: 0 },
        { nombre: 'good', precio: 10, cantidad: 2 },
      ],
      total: 20,
    }],
  });
  const migrated = migrateDatabase(db, NOW);
  assert.equal(migrated.historial[0].items.length, 1);
  assert.equal(migrated.historial[0].items[0].nombre, 'good');
});

test('accounting scenario is deterministic for a given snapshot', () => {
  const snapshot = createAccountingSnapshot(baseDb(), 'closure_1', NOW);
  assert.deepEqual(buildAccountingScenario(snapshot), buildAccountingScenario(snapshot));
});

test('commit rejects non-sales state changes after backup', () => {
  const db = migrateDatabase(baseDb(), NOW);
  const { backup } = prepareShiftFinalization(db, NOW);
  db.platos[0].stock -= 1;
  expectDomainError(() => commitShiftFinalization(db, backup, NOW), 'STALE_BACKUP');
});

test('commit rejects a corrupted prepared backup', () => {
  const db = migrateDatabase(baseDb(), NOW);
  const { backup } = prepareShiftFinalization(db, NOW);
  backup.database.platos[0].stock = 999;
  expectDomainError(() => commitShiftFinalization(db, backup, NOW), 'INVALID_BACKUP');
});

test('fractional item quantities are rejected during migration', () => {
  const db = baseDb({
    historial: [{ id: 1, items: [{ nombre: 'bad', precio: 10, cantidad: 1.5 }], total: 0 }],
  });
  const migrated = migrateDatabase(db, NOW);
  assert.equal(migrated.historial[0].items.length, 0);
});
