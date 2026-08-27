export const SCHEMA_VERSION = 3;
export const BACKUP_VERSION = 1;
export const BACKUP_KIND = 'rumi-wawqi/full-shift-backup';

export class DomainError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.details = details;
  }
}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const deepClone = (value) => JSON.parse(JSON.stringify(value));

export function moneyToCents(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new DomainError('INVALID_MONEY', `Valor monetario inválido: ${String(value)}`);
  }
  return Math.round((numeric + Number.EPSILON) * 100);
}

export function centsToMoney(cents) {
  if (!Number.isSafeInteger(cents)) {
    throw new DomainError('INVALID_CENTS', `Céntimos inválidos: ${String(cents)}`);
  }
  return cents / 100;
}

export function createShiftId(now = new Date(), salt = '') {
  const base = now.toISOString().replace(/[-:.TZ]/g, '');
  return salt ? `shift_${base}_${hashText(salt).toString(16)}` : `shift_${base}`;
}

function normalizeOrder(order) {
  if (!isObject(order)) return null;
  const cantidad = Number(order.cantidad);
  const precio = Number(order.precio);
  if (!Number.isSafeInteger(cantidad) || cantidad <= 0 || !Number.isFinite(precio) || precio < 0) return null;
  return {
    ...deepClone(order),
    cantidad,
    precio: centsToMoney(moneyToCents(precio)),
  };
}

function normalizeSale(sale) {
  if (!isObject(sale)) return null;
  const items = Array.isArray(sale.items) ? sale.items.map(normalizeOrder).filter(Boolean) : [];
  const calculatedCents = items.reduce((sum, item) => sum + moneyToCents(item.precio) * item.cantidad, 0);
  const reported = Number(sale.total);
  const totalCents = Number.isFinite(reported) ? moneyToCents(reported) : calculatedCents;
  return {
    ...deepClone(sale),
    items,
    total: centsToMoney(totalCents),
    totalCents,
  };
}

export function migrateDatabase(input, now = new Date()) {
  const source = isObject(input) ? deepClone(input) : {};
  const migrated = {
    ...source,
    platos: Array.isArray(source.platos) ? source.platos : [],
    mesas: Array.isArray(source.mesas) ? source.mesas : [],
    cocina: Array.isArray(source.cocina) ? source.cocina : [],
    historial: Array.isArray(source.historial) ? source.historial.map(normalizeSale).filter(Boolean) : [],
    cierres: Array.isArray(source.cierres) ? source.cierres : [],
    accountingLab: Array.isArray(source.accountingLab) ? source.accountingLab : [],
    backupReceipts: Array.isArray(source.backupReceipts) ? source.backupReceipts : [],
    shift: isObject(source.shift)
      ? source.shift
      : { id: createShiftId(now), openedAt: now.toISOString() },
    schemaVersion: SCHEMA_VERSION,
  };

  migrated.mesas = migrated.mesas.map((mesa, index) => ({
    id: typeof mesa?.id === 'string' ? mesa.id : `M${index + 1}`,
    nombre: typeof mesa?.nombre === 'string' ? mesa.nombre : `Mesa ${index + 1}`,
    estado: mesa?.estado === 'ocupada' ? 'ocupada' : 'libre',
    orden: Array.isArray(mesa?.orden) ? mesa.orden.map(normalizeOrder).filter(Boolean) : [],
    detalle: typeof mesa?.detalle === 'string' ? mesa.detalle : '',
  })).map((mesa) => ({
    ...mesa,
    estado: mesa.orden.length > 0 ? 'ocupada' : mesa.estado,
  }));

  return migrated;
}

export function getActiveTables(database) {
  const db = migrateDatabase(database);
  return db.mesas
    .filter((mesa) => mesa.estado === 'ocupada' || mesa.orden.length > 0)
    .map((mesa) => ({
      id: mesa.id,
      nombre: mesa.nombre,
      itemCount: mesa.orden.reduce((sum, item) => sum + item.cantidad, 0),
    }));
}

export function summarizeShift(database) {
  const db = migrateDatabase(database);
  const tickets = db.historial.length;
  const totalCents = db.historial.reduce((sum, sale) => sum + moneyToCents(sale.total), 0);
  const itemCount = db.historial.reduce(
    (sum, sale) => sum + sale.items.reduce((itemSum, item) => itemSum + item.cantidad, 0),
    0,
  );
  return {
    shiftId: db.shift.id,
    tickets,
    itemCount,
    totalCents,
    total: centsToMoney(totalCents),
    pendingKitchenTickets: db.cocina.length,
    activeTables: getActiveTables(db),
  };
}

export function assertFinalizable(database) {
  const summary = summarizeShift(database);
  if (summary.tickets === 0) {
    throw new DomainError('EMPTY_SHIFT', 'No hay ventas cerradas para finalizar el turno.');
  }
  if (summary.activeTables.length > 0) {
    throw new DomainError('ACTIVE_TABLES', 'No se puede finalizar con mesas activas.', {
      tables: summary.activeTables,
    });
  }
  if (summary.pendingKitchenTickets > 0) {
    throw new DomainError('PENDING_KITCHEN', 'No se puede finalizar con comandas pendientes en cocina.', {
      count: summary.pendingKitchenTickets,
    });
  }
  return summary;
}

function deterministicId(prefix, now, salt = '') {
  const source = `${prefix}|${now.toISOString()}|${salt}`;
  let hash = 2166136261;
  for (let i = 0; i < source.length; i += 1) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}_${now.getTime()}_${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function prepareShiftFinalization(database, now = new Date()) {
  const db = migrateDatabase(database, now);
  const summary = assertFinalizable(db);
  const backupId = deterministicId('backup', now, db.shift.id);
  const databaseSnapshot = deepClone(db);
  const snapshotHash = checksum(databaseSnapshot);
  const backup = {
    kind: BACKUP_KIND,
    backupVersion: BACKUP_VERSION,
    schemaVersion: SCHEMA_VERSION,
    id: backupId,
    generatedAt: now.toISOString(),
    sourceShiftId: db.shift.id,
    snapshotHash,
    summary,
    database: databaseSnapshot,
  };
  return { backup, summary };
}

export function createAccountingSnapshot(database, closureId, now = new Date()) {
  const db = migrateDatabase(database, now);
  const summary = summarizeShift(db);
  const productTotals = new Map();
  for (const sale of db.historial) {
    for (const item of sale.items) {
      const current = productTotals.get(item.nombre) ?? { quantity: 0, totalCents: 0 };
      current.quantity += item.cantidad;
      current.totalCents += moneyToCents(item.precio) * item.cantidad;
      productTotals.set(item.nombre, current);
    }
  }
  return {
    id: deterministicId('lab', now, closureId),
    closureId,
    shiftId: db.shift.id,
    generatedAt: now.toISOString(),
    basis: {
      tickets: summary.tickets,
      grossSalesCents: summary.totalCents,
      grossSales: summary.total,
      itemCount: summary.itemCount,
      products: [...productTotals.entries()]
        .map(([name, value]) => ({
          name,
          quantity: value.quantity,
          totalCents: value.totalCents,
          total: centsToMoney(value.totalCents),
        }))
        .sort((a, b) => b.totalCents - a.totalCents),
    },
  };
}

export function commitShiftFinalization(database, preparedBackup, now = new Date()) {
  const db = migrateDatabase(database, now);
  if (!isObject(preparedBackup) || preparedBackup.kind !== BACKUP_KIND) {
    throw new DomainError('BACKUP_REQUIRED', 'Se requiere el backup completo preparado antes de finalizar.');
  }
  if (preparedBackup.sourceShiftId !== db.shift.id) {
    throw new DomainError('STALE_BACKUP', 'El backup pertenece a otro turno y no puede autorizar este cierre.');
  }
  const backupValidation = validateRecoveryPayload(preparedBackup);
  if (!backupValidation.ok) {
    throw new DomainError('INVALID_BACKUP', 'El backup preparado no superó la validación de integridad.', { errors: backupValidation.errors });
  }
  const currentSummary = assertFinalizable(db);
  if (
    preparedBackup.summary?.tickets !== currentSummary.tickets ||
    preparedBackup.summary?.totalCents !== currentSummary.totalCents ||
    preparedBackup.snapshotHash !== checksum(db)
  ) {
    throw new DomainError('STALE_BACKUP', 'El estado cambió después de generar el backup. Genere uno nuevo.');
  }

  const closureId = deterministicId('closure', now, db.shift.id);
  const accountingSnapshot = createAccountingSnapshot(db, closureId, now);
  const closure = {
    id: closureId,
    shiftId: db.shift.id,
    openedAt: db.shift.openedAt,
    finalizedAt: now.toISOString(),
    backupId: preparedBackup.id,
    summary: currentSummary,
    sales: deepClone(db.historial),
  };

  const next = deepClone(db);
  next.cierres.push(closure);
  next.accountingLab.push(accountingSnapshot);
  next.backupReceipts.push({
    id: preparedBackup.id,
    shiftId: db.shift.id,
    generatedAt: preparedBackup.generatedAt,
    tickets: currentSummary.tickets,
    totalCents: currentSummary.totalCents,
  });
  next.historial = [];
  next.shift = { id: createShiftId(now, closureId), openedAt: now.toISOString() };
  next.schemaVersion = SCHEMA_VERSION;

  return { database: next, closure, accountingSnapshot };
}

export function validateRecoveryPayload(payload) {
  const errors = [];
  if (!isObject(payload)) {
    return { ok: false, errors: ['El archivo no contiene un objeto JSON.'] };
  }
  if (payload.kind !== BACKUP_KIND) errors.push(`Tipo de backup inválido: ${String(payload.kind)}`);
  if (payload.backupVersion !== BACKUP_VERSION) errors.push(`Versión de backup no soportada: ${String(payload.backupVersion)}`);
  if (!Number.isInteger(payload.schemaVersion)) errors.push('schemaVersion ausente o inválido.');
  else if (payload.schemaVersion > SCHEMA_VERSION) errors.push(`El backup usa schema ${payload.schemaVersion}; esta app soporta hasta ${SCHEMA_VERSION}.`);
  if (!isObject(payload.database)) errors.push('El backup no incluye un snapshot completo de database.');
  if (typeof payload.sourceShiftId !== 'string' || !payload.sourceShiftId) errors.push('sourceShiftId ausente.');
  if (typeof payload.generatedAt !== 'string' || Number.isNaN(Date.parse(payload.generatedAt))) errors.push('generatedAt inválido.');
  if (typeof payload.snapshotHash !== 'string' || !payload.snapshotHash) errors.push('snapshotHash ausente.');
  else if (isObject(payload.database) && checksum(payload.database) !== payload.snapshotHash) errors.push('El checksum del snapshot no coincide; el backup puede estar corrupto o modificado.');

  if (errors.length === 0) {
    try {
      const recovered = migrateDatabase(payload.database);
      for (const sale of recovered.historial) {
        const sumCents = sale.items.reduce((sum, item) => sum + moneyToCents(item.precio) * item.cantidad, 0);
        if (sumCents !== moneyToCents(sale.total)) {
          errors.push(`Venta ${String(sale.id)} tiene total inconsistente con sus ítems.`);
        }
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  return { ok: errors.length === 0, errors };
}

export function recoverDatabase(currentDatabase, payload, { allowActiveOverwrite = false } = {}) {
  const validation = validateRecoveryPayload(payload);
  if (!validation.ok) {
    throw new DomainError('INVALID_BACKUP', 'El backup no superó la validación.', { errors: validation.errors });
  }
  const current = migrateDatabase(currentDatabase);
  const activeTables = getActiveTables(current);
  if (!allowActiveOverwrite && activeTables.length > 0) {
    throw new DomainError('ACTIVE_TABLES_PRESENT', 'La recuperación se bloqueó para proteger comandas activas.', {
      tables: activeTables,
    });
  }
  return migrateDatabase(payload.database);
}

function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function fnv1a32(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function checksum(value) {
  return `fnv1a32:${fnv1a32(canonicalize(value)).toString(16).padStart(8, '0')}`;
}

function hashText(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) hash = (Math.imul(hash, 31) + text.charCodeAt(i)) | 0;
  return Math.abs(hash);
}

export function buildAccountingScenario(snapshot) {
  if (!isObject(snapshot) || !isObject(snapshot.basis)) {
    throw new DomainError('INVALID_SNAPSHOT', 'Snapshot contable inválido.');
  }
  const grossCents = Number(snapshot.basis.grossSalesCents);
  if (!Number.isSafeInteger(grossCents) || grossCents < 0) {
    throw new DomainError('INVALID_SNAPSHOT', 'Ventas brutas inválidas en el snapshot.');
  }
  const seed = hashText(`${snapshot.id}|${snapshot.closureId}`);
  const magnitude = ((seed % 5) + 1) * 500;
  const sign = seed % 2 === 0 ? 1 : -1;
  const hypotheticalVarianceCents = magnitude * sign;
  return {
    scenarioId: `scenario_${snapshot.id}`,
    type: 'cash-reconciliation-training',
    educational: true,
    realBasis: {
      tickets: snapshot.basis.tickets,
      grossSalesCents: grossCents,
      grossSales: centsToMoney(grossCents),
      itemCount: snapshot.basis.itemCount,
    },
    hypothetical: {
      varianceCents: hypotheticalVarianceCents,
      variance: centsToMoney(hypotheticalVarianceCents),
    },
    prompt: `Con ${snapshot.basis.tickets} tickets y ventas reales por S/ ${centsToMoney(grossCents).toFixed(2)}, analiza un descuadre HIPOTÉTICO de S/ ${centsToMoney(hypotheticalVarianceCents).toFixed(2)}. Propón al menos 3 causas, la evidencia necesaria para confirmarlas y el tratamiento contable solo después de identificar la causa.`,
    guardrail: 'El descuadre es simulado para entrenamiento; no representa un faltante o sobrante real del turno.',
  };
}

export function auditDatabase(database) {
  const db = migrateDatabase(database);
  const findings = [];
  const activeTables = getActiveTables(db);
  const summary = summarizeShift(db);

  if (db.schemaVersion !== SCHEMA_VERSION) findings.push({ severity: 'error', code: 'SCHEMA', message: 'Schema inesperado.' });
  if (activeTables.some((table) => table.itemCount <= 0)) findings.push({ severity: 'error', code: 'ACTIVE_EMPTY', message: 'Mesa activa sin ítems.' });

  for (const sale of db.historial) {
    const itemTotal = sale.items.reduce((sum, item) => sum + moneyToCents(item.precio) * item.cantidad, 0);
    if (itemTotal !== moneyToCents(sale.total)) {
      findings.push({ severity: 'error', code: 'SALE_TOTAL_MISMATCH', message: `Venta ${String(sale.id)} no cuadra.` });
    }
  }

  return {
    ok: findings.every((finding) => finding.severity !== 'error'),
    schemaVersion: db.schemaVersion,
    summary,
    findings,
  };
}
