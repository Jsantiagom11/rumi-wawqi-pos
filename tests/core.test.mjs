import assert from "node:assert/strict";
import test from "node:test";

await import("../app/core.js");
const Core = globalThis.RumiCore;

const MENU = [
  { id: "p1", nombre: "Trucha", precio: 35, stock: 10 },
  { id: "p2", nombre: "Pollo", precio: 30, stock: 10 },
];

class MemoryStorage {
  constructor(initial = {}) { this.values = new Map(Object.entries(initial)); }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

function sale(id = "sale-1", total = 35) {
  return {
    id,
    cerradoEn: "2026-08-26T12:00:00.000Z",
    fecha: "26/8/2026, 7:00:00 a. m.",
    mesa: "Mesa 1",
    items: [{ nombre: "Trucha", cantidad: 1, precio: total }],
    total,
  };
}

function databaseWithSale() {
  const db = Core.createDefaultDatabase(MENU);
  db.historial.push(sale());
  return db;
}

test("corrupt JSON opens a recoverable blank database without rewriting storage", () => {
  const storage = new MemoryStorage({ pos: "{truncated" });
  const result = Core.loadDatabase(storage, "pos", MENU);
  assert.equal(result.db.schemaVersion, 3);
  assert.equal(result.db.historial.length, 0);
  assert.equal(result.recovery.raw, "{truncated");
  assert.equal(storage.getItem("pos"), "{truncated");
});

test("legacy schema receives non-destructive defaults and stable string IDs", () => {
  const migrated = Core.migrateDatabase({
    schemaVersion: 2,
    platos: MENU,
    mesas: [{ id: "M1", nombre: "Mesa", estado: "libre", orden: [], detalle: "" }],
    historial: [{ ...sale(), id: 123 }],
  }, MENU);
  assert.equal(migrated.schemaVersion, 3);
  assert.equal(migrated.revision, 0);
  assert.equal(migrated.historial[0].id, "123");
  assert.deepEqual(migrated.cierres, []);
});

test("future schemas are rejected instead of silently downgraded", () => {
  assert.throws(() => Core.migrateDatabase({ schemaVersion: 99 }, MENU), /unsupported schema/);
});

test("commit detects stale writers and preserves the winning revision", () => {
  const storage = new MemoryStorage();
  const original = Core.createDefaultDatabase(MENU);
  const first = Core.commitDatabase(storage, "pos", original, 0);
  const stale = Core.clone(first);
  const winner = Core.clone(first);
  winner.platos[0].stock = 9;
  const committed = Core.commitDatabase(storage, "pos", winner, 1);
  stale.platos[0].stock = 8;
  assert.throws(() => Core.commitDatabase(storage, "pos", stale, 1), Core.StorageConflictError);
  assert.equal(JSON.parse(storage.getItem("pos")).revision, committed.revision);
  assert.equal(JSON.parse(storage.getItem("pos")).platos[0].stock, 9);
});

test("write failures surface as persistence errors", () => {
  const storage = new MemoryStorage();
  storage.setItem = () => { throw new Error("quota exceeded"); };
  assert.throws(
    () => Core.commitDatabase(storage, "pos", Core.createDefaultDatabase(MENU), 0),
    Core.PersistenceError,
  );
});

test("backup checksum rejects a single-field modification", () => {
  const backup = Core.createBackup(databaseWithSale(), new Date("2026-08-26T13:00:00Z"));
  backup.payload.historial[0].total = 1;
  assert.throws(() => Core.validateBackup(backup, MENU), /checksum/);
});

test("finalization archives sales only after a matching backup", () => {
  const db = databaseWithSale();
  const backup = Core.createBackup(db, new Date("2026-08-26T13:00:00Z"));
  const { next, closure } = Core.finalizeShift(db, backup, new Date("2026-08-26T13:01:00Z"));
  assert.equal(db.historial.length, 1, "input remains unchanged");
  assert.equal(next.historial.length, 0);
  assert.equal(next.cierres.length, 1);
  assert.equal(closure.ticketCount, 1);
  assert.equal(closure.total, 35);
  assert.equal(closure.backupChecksum, backup.checksum);
});

test("active tables and kitchen tickets independently block finalization", () => {
  const active = databaseWithSale();
  active.mesas[0].estado = "ocupada";
  active.mesas[0].orden.push({
    id: "p1", nombre: "Trucha", precio: 35, cantidad: 1,
    enviadoCocina: true, esManual: false, creadoEn: "2026-08-26T12:00:00Z",
  });
  assert.throws(() => Core.finalizeShift(active, Core.createBackup(active)), /active table/);

  const kitchen = databaseWithSale();
  kitchen.cocina.push({ id: "ticket-1" });
  assert.throws(() => Core.finalizeShift(kitchen, Core.createBackup(kitchen)), /kitchen tickets/);
});

test("recovery rejects active work and accepts a valid idle snapshot", () => {
  const snapshot = databaseWithSale();
  const backup = Core.createBackup(snapshot);
  const current = Core.createDefaultDatabase(MENU);
  current.revision = 7;
  const recovered = Core.recoverBackup(current, backup, MENU);
  assert.equal(recovered.historial.length, 1);
  assert.equal(recovered.revision, 7);

  current.mesas[0].estado = "ocupada";
  assert.throws(() => Core.recoverBackup(current, backup, MENU), /active table/);
});

test("HTML escaping neutralizes stored markup", () => {
  assert.equal(Core.escapeHtml(`<img src=x onerror="alert(1)">`), "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
});

test("database validation rejects duplicate menu identifiers and invalid money", () => {
  const duplicate = Core.createDefaultDatabase(MENU);
  duplicate.platos.push({ ...duplicate.platos[0] });
  assert.throws(() => Core.validateDatabase(duplicate), /duplicate plate id/);

  const invalid = Core.createDefaultDatabase(MENU);
  invalid.platos[0].precio = Number.NaN;
  assert.throws(() => Core.validateDatabase(invalid), /finite non-negative/);
});
