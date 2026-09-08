# Rumi Wawqi Operations Engine v0.1

## Product rule

The POS must not become an ERP. Operations is an exception-driven layer over the existing sales flow.

Normal service should require no inventory entry. The engine derives expected stock from data the POS already owns and only asks for input when something materially changes.

## Primary question

> What can we sell now, what is at risk, and what should we buy?

## Data flow

```text
physical count (occasional anchor)
+ purchases
- closed sales × BOM
- active orders × BOM
- explicit waste
= expected stock
```

The latest physical count reanchors the calculation. Older movements are not replayed after that point.

## Sources already present in the POS

- `db.historial`: current closed sales.
- `db.cierres[].sales`: hardened shift closures.
- `db.cierres[].ventas`: legacy backup shape.
- `db.mesas[].orden`: active orders/reservations.
- `db.platos[].stock`: legacy plate-level capacity, retained as fallback while a BOM is not configured.

Sales are deduplicated before consumption is calculated so the same ticket can exist in history and a backup without double-counting.

## New state

```js
operations: {
  schemaVersion: 1,
  ingredients: [],
  recipes: [],
  purchases: [],
  counts: [],
  wastes: []
}
```

### Ingredient

```js
{
  id: 'pork',
  name: 'Chancho',
  unit: 'kg',
  openingQty: 0,
  openingAt: 'ISO-8601',
  reorderPoint: 0,
  targetQty: 0,
  defaultUnitCostCents: null
}
```

`reorderPoint` and `targetQty` are one-time policy values, not daily input.

### BOM recipe

```js
{
  productId: 'p2',
  productName: 'Chancho al Palo',
  components: [
    { ingredientId: 'pork', qty: 0.4 }
  ]
}
```

Quantities are per sold plate in the ingredient's configured unit.

Do not ship guessed BOM quantities. A product without a trusted BOM continues using the existing `db.platos[].stock` capacity.

### Purchase

```js
{
  id: 'purchase_pork_...',
  ingredientId: 'pork',
  qty: 7,
  unitCostCents: 1950,
  at: 'ISO-8601'
}
```

### Physical count

```js
{
  id: 'count_pork_...',
  ingredientId: 'pork',
  qty: 3.7,
  at: 'ISO-8601'
}
```

A count is an absolute observation and becomes the new stock anchor.

### Waste

```js
{
  id: 'waste_pork_...',
  ingredientId: 'pork',
  qty: 0.3,
  at: 'ISO-8601'
}
```

Waste is an exception, not a required daily workflow.

## Dashboard contract

`buildOperationsDashboard(db)` returns:

```js
{
  status: 'ok' | 'attention',
  attentionCount,
  capacities,
  ingredientStock,
  purchaseSuggestions,
  risks
}
```

Capacity sources:

- `derived-bom`: computed from tracked ingredients.
- `legacy-plate-stock`: existing POS stock, used while no BOM is configured.
- `incomplete-bom`: configuration is incomplete; do not invent a number.

## POS UX target

One entry point: **Operación**.

Default state:

```text
RUMI

Todo bajo control
```

Attention state:

```text
RUMI

3 cosas requieren atención

HOY
Pachamanca        18
Chancho al palo   11
Lomo               7

FALTA
Chancho          +2.4 kg

RIESGO
Lomo             stock sin BOM confiable

[ Comprar ]
```

No charts. No permanent inventory tables. No daily stock form.

## Human interactions allowed

Normal operation should reduce to three actions:

1. Confirm a suggested state.
2. Correct a physical count when expected stock is wrong.
3. Register a genuinely new event such as a purchase or waste.

## Safety / invariants

- Never mutate sales history to make stock reconcile.
- Never clear or reset Operations during shift finalization.
- Never double-count a sale that also exists in a closure backup.
- Active orders reserve stock until they become a closed sale or are removed.
- A physical count only affects movements after its timestamp.
- Manual pool items do not consume ingredients unless explicitly mapped later.
- Unknown or incomplete BOMs must degrade to a visible risk, not a guessed capacity.
- Existing cashier and kitchen actions remain unchanged during v0.1 integration.

## Implementation sequence

1. **Core engine** — complete in `lib/operations-core.mjs`.
2. **Domain tests** — complete in `tests/operations-core.test.mjs`.
3. **POS state migration** — add `operations` non-destructively to the browser database.
4. **Read-only Operación surface** — render dashboard from current POS state.
5. **Quick purchase/count actions** — append events; no inventory editing table.
6. **Backup inclusion** — confirm `operations` survives full-shift backup/recovery.
7. **Single-file release artifact** — preserve the current iPad/offline deployment path.

## v0.1 non-goals

- Multi-terminal sync.
- Supplier API automation.
- OCR of invoices.
- Full ingredient catalog.
- Accounting ledger replacement.
- Forecasting/ML.
- Server requirement.
