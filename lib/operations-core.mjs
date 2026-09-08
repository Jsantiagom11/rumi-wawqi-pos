export const OPERATIONS_SCHEMA_VERSION = 1;

export class OperationsError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'OperationsError';
    this.code = code;
    this.details = details;
  }
}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const deepClone = (value) => JSON.parse(JSON.stringify(value));
const roundQty = (value) => Math.round((Number(value) + Number.EPSILON) * 1000) / 1000;

function parseDate(value) {
  if (typeof value !== 'string' || !value) return null;
  const millis = Date.parse(value);
  return Number.isFinite(millis) ? millis : null;
}

function normalizeQty(value, { allowZero = true } = {}) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0 || (!allowZero && numeric === 0)) return null;
  return roundQty(numeric);
}

function normalizeIngredient(value) {
  if (!isObject(value) || typeof value.id !== 'string' || !value.id.trim()) return null;
  const openingQty = normalizeQty(value.openingQty ?? 0);
  const reorderPoint = normalizeQty(value.reorderPoint ?? 0);
  const targetQty = normalizeQty(value.targetQty ?? reorderPoint ?? 0);
  if (openingQty === null || reorderPoint === null || targetQty === null) return null;
  return {
    ...deepClone(value),
    id: value.id.trim(),
    name: typeof value.name === 'string' && value.name.trim() ? value.name.trim() : value.id.trim(),
    unit: typeof value.unit === 'string' && value.unit.trim() ? value.unit.trim() : 'unit',
    openingQty,
    openingAt: typeof value.openingAt === 'string' ? value.openingAt : null,
    reorderPoint,
    targetQty: Math.max(targetQty, reorderPoint),
    defaultUnitCostCents: Number.isSafeInteger(value.defaultUnitCostCents) && value.defaultUnitCostCents >= 0
      ? value.defaultUnitCostCents
      : null,
  };
}

function normalizeComponent(value) {
  if (!isObject(value) || typeof value.ingredientId !== 'string' || !value.ingredientId.trim()) return null;
  const qty = normalizeQty(value.qty, { allowZero: false });
  if (qty === null) return null;
  return { ingredientId: value.ingredientId.trim(), qty };
}

function normalizeRecipe(value) {
  if (!isObject(value)) return null;
  const productId = typeof value.productId === 'string' && value.productId.trim() ? value.productId.trim() : null;
  const productName = typeof value.productName === 'string' && value.productName.trim() ? value.productName.trim() : null;
  const components = Array.isArray(value.components)
    ? value.components.map(normalizeComponent).filter(Boolean)
    : [];
  if ((!productId && !productName) || components.length === 0) return null;
  return { ...deepClone(value), productId, productName, components };
}

function normalizeMovement(value, type) {
  if (!isObject(value) || typeof value.ingredientId !== 'string' || !value.ingredientId.trim()) return null;
  const qty = normalizeQty(value.qty, { allowZero: false });
  if (qty === null) return null;
  const at = typeof value.at === 'string' && parseDate(value.at) !== null ? value.at : null;
  if (!at) return null;
  const normalized = {
    ...deepClone(value),
    id: typeof value.id === 'string' && value.id ? value.id : `${type}_${value.ingredientId}_${at}`,
    ingredientId: value.ingredientId.trim(),
    qty,
    at,
  };
  if (type === 'purchase') {
    normalized.unitCostCents = Number.isSafeInteger(value.unitCostCents) && value.unitCostCents >= 0
      ? value.unitCostCents
      : null;
  }
  return normalized;
}

export function migrateOperationsDatabase(input) {
  const db = isObject(input) ? deepClone(input) : {};
  const source = isObject(db.operations) ? db.operations : {};
  db.operations = {
    schemaVersion: OPERATIONS_SCHEMA_VERSION,
    ingredients: Array.isArray(source.ingredients)
      ? source.ingredients.map(normalizeIngredient).filter(Boolean)
      : [],
    recipes: Array.isArray(source.recipes)
      ? source.recipes.map(normalizeRecipe).filter(Boolean)
      : [],
    purchases: Array.isArray(source.purchases)
      ? source.purchases.map((entry) => normalizeMovement(entry, 'purchase')).filter(Boolean)
      : [],
    counts: Array.isArray(source.counts)
      ? source.counts.map((entry) => normalizeMovement(entry, 'count')).filter(Boolean)
      : [],
    wastes: Array.isArray(source.wastes)
      ? source.wastes.map((entry) => normalizeMovement(entry, 'waste')).filter(Boolean)
      : [],
  };
  return db;
}

function saleFingerprint(sale) {
  if (sale?.id !== undefined && sale?.id !== null) return `id:${String(sale.id)}`;
  const items = Array.isArray(sale?.items)
    ? sale.items.map((item) => `${String(item?.id ?? item?.nombre ?? '')}:${Number(item?.cantidad) || 0}:${Number(item?.precio) || 0}`).join('|')
    : '';
  return `fallback:${String(sale?.cerradoEn ?? sale?.fecha ?? '')}:${Number(sale?.total) || 0}:${items}`;
}

export function collectUniqueSales(input) {
  const db = migrateOperationsDatabase(input);
  const unique = new Map();
  const addSales = (sales) => {
    if (!Array.isArray(sales)) return;
    for (const sale of sales) {
      if (!isObject(sale) || !Array.isArray(sale.items)) continue;
      unique.set(saleFingerprint(sale), deepClone(sale));
    }
  };

  addSales(db.historial);
  if (Array.isArray(db.cierres)) {
    for (const closure of db.cierres) {
      addSales(closure?.sales);
      addSales(closure?.ventas);
    }
  }
  return [...unique.values()];
}

function eventTimestamp(value) {
  return parseDate(value?.cerradoEn) ?? parseDate(value?.creadoEn) ?? parseDate(value?.at) ?? parseDate(value?.fecha);
}

function itemMatchesRecipe(item, recipe) {
  const itemId = typeof item?.productId === 'string'
    ? item.productId
    : (typeof item?.id === 'string' ? item.id : null);
  if (recipe.productId && itemId === recipe.productId) return true;
  return Boolean(recipe.productName && item?.nombre === recipe.productName);
}

function quantityForIngredient(items, recipes, ingredientId) {
  let total = 0;
  for (const item of Array.isArray(items) ? items : []) {
    const quantity = Number(item?.cantidad);
    if (!Number.isFinite(quantity) || quantity <= 0 || item?.esManual === true) continue;
    const recipe = recipes.find((candidate) => itemMatchesRecipe(item, candidate));
    if (!recipe) continue;
    const component = recipe.components.find((candidate) => candidate.ingredientId === ingredientId);
    if (component) total += quantity * component.qty;
  }
  return roundQty(total);
}

function activeOrders(db) {
  if (!Array.isArray(db.mesas)) return [];
  return db.mesas.flatMap((mesa) => Array.isArray(mesa?.orden) ? mesa.orden : []);
}

function latestCount(counts, ingredientId) {
  return counts
    .filter((entry) => entry.ingredientId === ingredientId)
    .map((entry) => ({ entry, millis: parseDate(entry.at) }))
    .filter(({ millis }) => millis !== null)
    .sort((a, b) => b.millis - a.millis)[0] ?? null;
}

function latestUnitCostCents(db, ingredient) {
  const purchase = db.operations.purchases
    .filter((entry) => entry.ingredientId === ingredient.id && Number.isSafeInteger(entry.unitCostCents))
    .map((entry) => ({ entry, millis: parseDate(entry.at) ?? 0 }))
    .sort((a, b) => b.millis - a.millis)[0]?.entry;
  return purchase?.unitCostCents ?? ingredient.defaultUnitCostCents ?? null;
}

export function computeIngredientStock(input, ingredientId) {
  const db = migrateOperationsDatabase(input);
  const ingredient = db.operations.ingredients.find((entry) => entry.id === ingredientId);
  if (!ingredient) throw new OperationsError('UNKNOWN_INGREDIENT', `Ingrediente no configurado: ${ingredientId}`);

  const countAnchor = latestCount(db.operations.counts, ingredientId);
  const anchorMillis = countAnchor?.millis ?? parseDate(ingredient.openingAt) ?? Number.NEGATIVE_INFINITY;
  let stock = countAnchor ? countAnchor.entry.qty : ingredient.openingQty;

  for (const purchase of db.operations.purchases) {
    if (purchase.ingredientId !== ingredientId) continue;
    const millis = parseDate(purchase.at);
    if (millis !== null && millis > anchorMillis) stock += purchase.qty;
  }

  for (const waste of db.operations.wastes) {
    if (waste.ingredientId !== ingredientId) continue;
    const millis = parseDate(waste.at);
    if (millis !== null && millis > anchorMillis) stock -= waste.qty;
  }

  const sales = collectUniqueSales(db);
  for (const sale of sales) {
    const millis = eventTimestamp(sale);
    if (millis !== null && millis <= anchorMillis) continue;
    stock -= quantityForIngredient(sale.items, db.operations.recipes, ingredientId);
  }

  stock -= quantityForIngredient(activeOrders(db), db.operations.recipes, ingredientId);

  return {
    ingredientId,
    name: ingredient.name,
    unit: ingredient.unit,
    quantity: roundQty(stock),
    anchor: countAnchor ? { type: 'count', id: countAnchor.entry.id, at: countAnchor.entry.at } : { type: 'opening', at: ingredient.openingAt },
  };
}

function recipeForProduct(db, product) {
  return db.operations.recipes.find((recipe) =>
    (recipe.productId && recipe.productId === product?.id)
    || (recipe.productName && recipe.productName === product?.nombre));
}

export function computeProductCapacity(input, product) {
  const db = migrateOperationsDatabase(input);
  const recipe = recipeForProduct(db, product);
  if (!recipe) {
    const legacy = Number(product?.stock);
    return {
      productId: product?.id ?? null,
      productName: product?.nombre ?? 'Producto',
      capacity: Number.isFinite(legacy) ? Math.max(0, Math.floor(legacy)) : null,
      source: 'legacy-plate-stock',
      constraints: [],
    };
  }

  const constraints = recipe.components.map((component) => {
    const stock = computeIngredientStock(db, component.ingredientId);
    return {
      ingredientId: component.ingredientId,
      name: stock.name,
      unit: stock.unit,
      availableQty: stock.quantity,
      qtyPerPlate: component.qty,
      plates: Math.max(0, Math.floor(stock.quantity / component.qty)),
    };
  });
  const capacity = constraints.length > 0 ? Math.min(...constraints.map((entry) => entry.plates)) : null;
  return {
    productId: product?.id ?? recipe.productId,
    productName: product?.nombre ?? recipe.productName ?? 'Producto',
    capacity,
    source: 'derived-bom',
    constraints,
  };
}

export function buildPurchaseSuggestions(input) {
  const db = migrateOperationsDatabase(input);
  return db.operations.ingredients.flatMap((ingredient) => {
    const stock = computeIngredientStock(db, ingredient.id);
    if (stock.quantity > ingredient.reorderPoint || ingredient.targetQty <= stock.quantity) return [];
    const qty = roundQty(ingredient.targetQty - stock.quantity);
    const unitCostCents = latestUnitCostCents(db, ingredient);
    return [{
      ingredientId: ingredient.id,
      name: ingredient.name,
      unit: ingredient.unit,
      currentQty: stock.quantity,
      reorderPoint: ingredient.reorderPoint,
      targetQty: ingredient.targetQty,
      buyQty: qty,
      unitCostCents,
      estimatedCostCents: unitCostCents === null ? null : Math.round(qty * unitCostCents),
    }];
  });
}

export function buildOperationsDashboard(input) {
  const db = migrateOperationsDatabase(input);
  const products = Array.isArray(db.platos) ? db.platos : [];
  const capacities = products.map((product) => computeProductCapacity(db, product));
  const ingredientStock = db.operations.ingredients.map((ingredient) => computeIngredientStock(db, ingredient.id));
  const purchaseSuggestions = buildPurchaseSuggestions(db);
  const risks = ingredientStock
    .filter((entry) => entry.quantity < 0)
    .map((entry) => ({
      code: 'NEGATIVE_STOCK',
      ingredientId: entry.ingredientId,
      message: `${entry.name}: stock teórico ${entry.quantity} ${entry.unit}`,
    }));
  const soldOut = capacities.filter((entry) => entry.capacity === 0);
  const attentionCount = risks.length + purchaseSuggestions.length + soldOut.length;
  return {
    status: attentionCount === 0 ? 'ok' : 'attention',
    attentionCount,
    capacities,
    ingredientStock,
    purchaseSuggestions,
    risks,
  };
}

function makeMovementId(prefix, ingredientId, now) {
  return `${prefix}_${ingredientId}_${now.getTime()}`;
}

function assertIngredient(db, ingredientId) {
  if (!db.operations.ingredients.some((entry) => entry.id === ingredientId)) {
    throw new OperationsError('UNKNOWN_INGREDIENT', `Ingrediente no configurado: ${ingredientId}`);
  }
}

export function recordPurchase(input, { ingredientId, qty, unitCostCents = null }, now = new Date()) {
  const db = migrateOperationsDatabase(input);
  assertIngredient(db, ingredientId);
  const normalizedQty = normalizeQty(qty, { allowZero: false });
  if (normalizedQty === null) throw new OperationsError('INVALID_QUANTITY', 'La cantidad comprada debe ser mayor que cero.');
  if (unitCostCents !== null && (!Number.isSafeInteger(unitCostCents) || unitCostCents < 0)) {
    throw new OperationsError('INVALID_UNIT_COST', 'El costo unitario debe expresarse en céntimos enteros no negativos.');
  }
  db.operations.purchases.push({
    id: makeMovementId('purchase', ingredientId, now),
    ingredientId,
    qty: normalizedQty,
    unitCostCents,
    at: now.toISOString(),
  });
  return db;
}

export function recordPhysicalCount(input, { ingredientId, qty }, now = new Date()) {
  const db = migrateOperationsDatabase(input);
  assertIngredient(db, ingredientId);
  const normalizedQty = normalizeQty(qty);
  if (normalizedQty === null) throw new OperationsError('INVALID_QUANTITY', 'El conteo físico no puede ser negativo.');
  db.operations.counts.push({
    id: makeMovementId('count', ingredientId, now),
    ingredientId,
    qty: normalizedQty,
    at: now.toISOString(),
  });
  return db;
}

export function recordWaste(input, { ingredientId, qty }, now = new Date()) {
  const db = migrateOperationsDatabase(input);
  assertIngredient(db, ingredientId);
  const normalizedQty = normalizeQty(qty, { allowZero: false });
  if (normalizedQty === null) throw new OperationsError('INVALID_QUANTITY', 'La merma debe ser mayor que cero.');
  db.operations.wastes.push({
    id: makeMovementId('waste', ingredientId, now),
    ingredientId,
    qty: normalizedQty,
    at: now.toISOString(),
  });
  return db;
}
