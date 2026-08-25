# Case study: offline restaurant operations at Rumi Wawqi

## Executive summary

Rumi Wawqi operates weekend restaurant service in Caraz, Peru, normally producing 30–50 plates per day and supporting events of up to approximately 450 plates. Connectivity and infrastructure cannot be assumed, so the operational system must remain useful on an iPad without a server or printer.

The POS was built around that constraint: coordinate tables, orders, kitchen dispatch, menu stock and cash history locally while avoiding destructive closure actions.

## Operational context

- Regular weekend service with variable demand.
- High-volume event service with multiple floor, kitchen and cashier roles.
- Shared responsibility across service, runners, kitchen and cashiers.
- Limited tolerance for setup complexity during opening preparation.
- Internet-independent operation is more valuable than cloud sophistication.

## Failure modes addressed

| Failure mode | Control in the product |
|---|---|
| Selling unavailable products | Stock reserved when an order is captured |
| Kitchen misses new items | Explicit kitchen dispatch queue |
| Table changes lose context | Persistent table order and preparation notes |
| Cash backup destroys history | Non-destructive versioned backup snapshot |
| Existing iPad data breaks after an update | Schema migration preserves legacy state |
| Misleading UI implies printing | Action renamed to match actual behavior |

## Workflow

1. Select or name a table.
2. Capture menu and special items.
3. Reserve stock immediately.
4. Send only new items to the kitchen queue.
5. Close and release the table after confirmation.
6. Add the sale to persistent shift history.
7. Download a backup without clearing revenue data.

## Key product decisions

| Decision | Why it fits the operation | Trade-off |
|---|---|---|
| Single HTML application | Easy iPad deployment and emergency recovery | Larger source file |
| Local persistence | Works without accounts, server or internet | Data remains device-local |
| Inventory reservation on capture | Reduces overselling during service | Voids must restore stock correctly |
| Explicit kitchen dispatch | Separates order capture from kitchen commitment | Adds one operational action |
| Non-destructive backup | Protects the financial record | Requires an archival policy |

## Validation

Automated regression tests protect the three highest-risk invariants:

- Exporting a shift cannot erase sales history.
- Orders, kitchen tickets and sales retain timestamps.
- Legacy local data migrates without destructive resets.

## Current limitations

- `localStorage` is appropriate for the MVP but not ideal for large histories.
- There is no payment-method reconciliation or cashier authorization.
- Receipt generation and physical printing are not implemented.
- Recovery import needs schema validation and conflict handling.

## Next measurable increment

[Issue #1](https://github.com/Jsantiagom11/rumi-wawqi-pos/issues/1) separates backup, shift finalization and recovery into an auditable cashier workflow.

