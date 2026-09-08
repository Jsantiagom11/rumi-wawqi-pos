import { migrateOperationsDatabase } from './operations-core.mjs';

export const TRUSTED_OPERATIONS_PROFILE_VERSION = 1;

export const TRUSTED_INGREDIENTS = Object.freeze([
  Object.freeze({
    id: 'pork_raw',
    name: 'Panceta de cerdo',
    unit: 'kg',
    openingQty: null,
    openingAt: null,
    reorderPoint: 0,
    targetQty: 0,
    defaultUnitCostCents: null,
  }),
  Object.freeze({
    id: 'beef_lomo_raw',
    name: 'Lomo fino de res',
    unit: 'kg',
    openingQty: null,
    openingAt: null,
    reorderPoint: 0,
    targetQty: 0,
    defaultUnitCostCents: null,
  }),
]);

export const TRUSTED_RECIPES = Object.freeze([
  Object.freeze({
    productId: 'p2',
    productName: 'Chancho al Palo',
    components: Object.freeze([
      Object.freeze({ ingredientId: 'pork_raw', qty: 0.417 }),
    ]),
    provenance: Object.freeze({
      source: 'Rumi_Wawqi_Plan_Compras_Produccion_2026-09-12.xlsx',
      basis: '72% real yield; 300 g served portion; raw equivalent = 0.300 / 0.72 kg per plate',
      status: 'confirmed-operational',
    }),
  }),
  Object.freeze({
    productId: 'p7',
    productName: 'Lomo Saltado',
    components: Object.freeze([
      Object.freeze({ ingredientId: 'beef_lomo_raw', qty: 0.22 }),
    ]),
    provenance: Object.freeze({
      source: 'Rumi_Wawqi_Plan_Compras_Produccion_2026-09-12.xlsx',
      basis: '220 g gross lomo fino per plate',
      status: 'canonical',
    }),
  }),
]);

const deepClone = (value) => JSON.parse(JSON.stringify(value));

function recipeKey(recipe) {
  if (typeof recipe?.productId === 'string' && recipe.productId) return `id:${recipe.productId}`;
  if (typeof recipe?.productName === 'string' && recipe.productName) return `name:${recipe.productName}`;
  return null;
}

export function bootstrapTrustedOperationsProfile(input) {
  const db = migrateOperationsDatabase(input);
  const ingredientIds = new Set(db.operations.ingredients.map((ingredient) => ingredient.id));
  for (const ingredient of TRUSTED_INGREDIENTS) {
    if (!ingredientIds.has(ingredient.id)) {
      db.operations.ingredients.push(deepClone(ingredient));
      ingredientIds.add(ingredient.id);
    }
  }

  const recipeKeys = new Set(db.operations.recipes.map(recipeKey).filter(Boolean));
  for (const recipe of TRUSTED_RECIPES) {
    const key = recipeKey(recipe);
    if (key && !recipeKeys.has(key)) {
      db.operations.recipes.push(deepClone(recipe));
      recipeKeys.add(key);
    }
  }

  db.operations.profileVersion = Math.max(
    Number.isSafeInteger(db.operations.profileVersion) ? db.operations.profileVersion : 0,
    TRUSTED_OPERATIONS_PROFILE_VERSION,
  );

  return db;
}
