(function attachRumiCore(root) {
  "use strict";

  const SCHEMA_VERSION = 3;
  const BACKUP_FORMAT = "rumi-wawqi-pos-backup";

  class DataValidationError extends Error {}
  class StorageConflictError extends Error {}
  class PersistenceError extends Error {}

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function assert(condition, message) {
    if (!condition) throw new DataValidationError(message);
  }

  function finiteNonNegative(value, field) {
    assert(typeof value === "number" && Number.isFinite(value) && value >= 0, `${field} must be a finite non-negative number`);
  }

  function validateIso(value, field) {
    assert(typeof value === "string" && Number.isFinite(Date.parse(value)), `${field} must be an ISO timestamp`);
  }

  function validateDatabase(candidate) {
    assert(candidate && typeof candidate === "object" && !Array.isArray(candidate), "database must be an object");
    assert(candidate.schemaVersion === SCHEMA_VERSION, `unsupported schema version: ${candidate.schemaVersion}`);
    assert(Number.isInteger(candidate.revision) && candidate.revision >= 0, "revision must be a non-negative integer");
    for (const key of ["platos", "mesas", "cocina", "historial", "cierres"]) {
      assert(Array.isArray(candidate[key]), `${key} must be an array`);
    }

    const plateIds = new Set();
    for (const [index, plate] of candidate.platos.entries()) {
      assert(plate && typeof plate === "object", `platos[${index}] must be an object`);
      assert(typeof plate.id === "string" && plate.id.length > 0, `platos[${index}].id is required`);
      assert(!plateIds.has(plate.id), `duplicate plate id: ${plate.id}`);
      plateIds.add(plate.id);
      assert(typeof plate.nombre === "string" && plate.nombre.trim(), `platos[${index}].nombre is required`);
      finiteNonNegative(plate.precio, `platos[${index}].precio`);
      assert(Number.isInteger(plate.stock) && plate.stock >= 0, `platos[${index}].stock must be a non-negative integer`);
    }

    const tableIds = new Set();
    for (const [index, table] of candidate.mesas.entries()) {
      assert(table && typeof table === "object", `mesas[${index}] must be an object`);
      assert(typeof table.id === "string" && table.id.length > 0, `mesas[${index}].id is required`);
      assert(!tableIds.has(table.id), `duplicate table id: ${table.id}`);
      tableIds.add(table.id);
      assert(table.estado === "libre" || table.estado === "ocupada", `mesas[${index}].estado is invalid`);
      assert(Array.isArray(table.orden), `mesas[${index}].orden must be an array`);
      assert(typeof table.detalle === "string", `mesas[${index}].detalle must be a string`);
      for (const [itemIndex, item] of table.orden.entries()) {
        assert(item && typeof item === "object", `mesas[${index}].orden[${itemIndex}] must be an object`);
        assert(typeof item.id === "string" && item.id.length > 0, `mesas[${index}].orden[${itemIndex}].id is required`);
        assert(typeof item.nombre === "string" && item.nombre.trim(), `mesas[${index}].orden[${itemIndex}].nombre is required`);
        finiteNonNegative(item.precio, `mesas[${index}].orden[${itemIndex}].precio`);
        assert(Number.isInteger(item.cantidad) && item.cantidad > 0, `mesas[${index}].orden[${itemIndex}].cantidad must be positive`);
        assert(typeof item.enviadoCocina === "boolean", `mesas[${index}].orden[${itemIndex}].enviadoCocina must be boolean`);
        assert(typeof item.esManual === "boolean", `mesas[${index}].orden[${itemIndex}].esManual must be boolean`);
        validateIso(item.creadoEn, `mesas[${index}].orden[${itemIndex}].creadoEn`);
      }
    }

    for (const [index, sale] of candidate.historial.entries()) {
      assert(sale && typeof sale === "object", `historial[${index}] must be an object`);
      assert(typeof sale.id === "string" && sale.id.length > 0, `historial[${index}].id is required`);
      validateIso(sale.cerradoEn, `historial[${index}].cerradoEn`);
      assert(Array.isArray(sale.items) && sale.items.length > 0, `historial[${index}].items must not be empty`);
      finiteNonNegative(sale.total, `historial[${index}].total`);
    }
    return candidate;
  }

  function createDefaultDatabase(menu) {
    return validateDatabase({
      platos: clone(menu),
      mesas: [{ id: "M1", nombre: "Mesa 1", estado: "libre", orden: [], detalle: "" }],
      cocina: [],
      historial: [],
      cierres: [],
      schemaVersion: SCHEMA_VERSION,
      revision: 0,
    });
  }

  function normalizeLegacyItem(item, index) {
    const created = item.creadoEn || new Date(0).toISOString();
    return {
      id: String(item.id || `legacy-item-${index}`),
      nombre: String(item.nombre || "Ítem sin nombre"),
      precio: Number(item.precio),
      cantidad: Number(item.cantidad),
      enviadoCocina: Boolean(item.enviadoCocina),
      esManual: Boolean(item.esManual),
      creadoEn: created,
    };
  }

  function migrateDatabase(raw, menu) {
    assert(raw && typeof raw === "object" && !Array.isArray(raw), "stored database is not an object");
    const version = raw.schemaVersion == null ? 1 : Number(raw.schemaVersion);
    assert(Number.isInteger(version) && version >= 1 && version <= SCHEMA_VERSION, `unsupported schema version: ${raw.schemaVersion}`);
    const base = createDefaultDatabase(menu);
    const migrated = {
      ...base,
      ...raw,
      platos: Array.isArray(raw.platos) ? raw.platos : base.platos,
      mesas: Array.isArray(raw.mesas) ? raw.mesas.map((table, tableIndex) => ({
        id: String(table.id || `M${tableIndex + 1}`),
        nombre: String(table.nombre || table.id || `Mesa ${tableIndex + 1}`),
        estado: table.estado === "ocupada" ? "ocupada" : "libre",
        orden: Array.isArray(table.orden) ? table.orden.map(normalizeLegacyItem) : [],
        detalle: typeof table.detalle === "string" ? table.detalle : "",
      })) : base.mesas,
      cocina: Array.isArray(raw.cocina) ? raw.cocina : [],
      historial: Array.isArray(raw.historial) ? raw.historial.map((sale, index) => ({
        ...sale,
        id: String(sale.id || `legacy-sale-${index}`),
        cerradoEn: sale.cerradoEn || new Date(0).toISOString(),
      })) : [],
      cierres: Array.isArray(raw.cierres) ? raw.cierres : [],
      schemaVersion: SCHEMA_VERSION,
      revision: Number.isInteger(raw.revision) && raw.revision >= 0 ? raw.revision : 0,
    };
    return validateDatabase(migrated);
  }

  function loadDatabase(storage, key, menu) {
    const serialized = storage.getItem(key);
    if (serialized == null) return { db: createDefaultDatabase(menu), recovery: null };
    try {
      return { db: migrateDatabase(JSON.parse(serialized), menu), recovery: null };
    } catch (error) {
      return {
        db: createDefaultDatabase(menu),
        recovery: { raw: serialized, message: error instanceof Error ? error.message : String(error) },
      };
    }
  }

  function commitDatabase(storage, key, candidate, expectedRevision) {
    const currentRaw = storage.getItem(key);
    if (currentRaw != null) {
      let current;
      try {
        current = JSON.parse(currentRaw);
      } catch (error) {
        throw new PersistenceError("Stored data changed and is no longer valid JSON", { cause: error });
      }
      const currentRevision = Number.isInteger(current.revision) ? current.revision : 0;
      if (currentRevision !== expectedRevision) {
        throw new StorageConflictError(`Expected revision ${expectedRevision}, found ${currentRevision}`);
      }
    } else if (expectedRevision !== 0) {
      throw new StorageConflictError("Stored data was removed by another session");
    }

    const next = clone(candidate);
    next.schemaVersion = SCHEMA_VERSION;
    next.revision = expectedRevision + 1;
    validateDatabase(next);
    const serialized = JSON.stringify(next);
    try {
      storage.setItem(key, serialized);
      if (storage.getItem(key) !== serialized) throw new Error("read-back mismatch");
    } catch (error) {
      throw new PersistenceError("The sale could not be persisted", { cause: error });
    }
    return next;
  }

  function checksum(text) {
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  function createBackup(db, now = new Date()) {
    validateDatabase(db);
    const payload = clone(db);
    const payloadText = JSON.stringify(payload);
    return {
      format: BACKUP_FORMAT,
      schemaVersion: SCHEMA_VERSION,
      generatedAt: now.toISOString(),
      checksum: checksum(payloadText),
      payload,
    };
  }

  function validateBackup(backup, menu) {
    assert(backup && typeof backup === "object", "backup must be an object");
    assert(backup.format === BACKUP_FORMAT, "unknown backup format");
    assert(backup.schemaVersion === SCHEMA_VERSION, `backup schema ${backup.schemaVersion} is not supported`);
    validateIso(backup.generatedAt, "backup.generatedAt");
    const payload = migrateDatabase(backup.payload, menu);
    assert(checksum(JSON.stringify(backup.payload)) === backup.checksum, "backup checksum does not match");
    return payload;
  }

  function activeWork(db) {
    const tables = db.mesas.filter((table) => table.orden.length > 0 || table.estado === "ocupada");
    return { tables, kitchenTickets: db.cocina.length };
  }

  function finalizeShift(db, backup, now = new Date()) {
    validateDatabase(db);
    const verified = validateBackup(backup, db.platos);
    assert(JSON.stringify(verified) === JSON.stringify(db), "backup does not represent the current shift");
    const work = activeWork(db);
    assert(work.tables.length === 0, "active table orders must be closed before finalization");
    assert(work.kitchenTickets === 0, "kitchen tickets must be cleared before finalization");
    assert(db.historial.length > 0, "there are no sales to finalize");
    const next = clone(db);
    const closure = {
      id: uniqueId("shift"),
      finalizedAt: now.toISOString(),
      ticketCount: db.historial.length,
      total: db.historial.reduce((sum, sale) => sum + sale.total, 0),
      sales: clone(db.historial),
      backupChecksum: backup.checksum,
    };
    next.cierres.push(closure);
    next.historial = [];
    return { next, closure };
  }

  function recoverBackup(currentDb, backup, menu) {
    validateDatabase(currentDb);
    const work = activeWork(currentDb);
    assert(work.tables.length === 0, "active table orders prevent recovery");
    assert(work.kitchenTickets === 0, "kitchen tickets prevent recovery");
    const recovered = validateBackup(backup, menu);
    recovered.revision = currentDb.revision;
    return recovered;
  }

  function uniqueId(prefix = "event") {
    if (root.crypto && typeof root.crypto.randomUUID === "function") return `${prefix}_${root.crypto.randomUUID()}`;
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[character]);
  }

  root.RumiCore = Object.freeze({
    BACKUP_FORMAT,
    SCHEMA_VERSION,
    DataValidationError,
    PersistenceError,
    StorageConflictError,
    activeWork,
    checksum,
    clone,
    commitDatabase,
    createBackup,
    createDefaultDatabase,
    escapeHtml,
    finalizeShift,
    loadDatabase,
    migrateDatabase,
    recoverBackup,
    uniqueId,
    validateBackup,
    validateDatabase,
  });
})(globalThis);
