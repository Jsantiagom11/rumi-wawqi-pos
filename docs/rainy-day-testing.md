# Rainy-day testing

The resilience suite treats sales history as the primary protected asset. Tests are
deterministic and run without network access.

## Automated matrix

| Failure or boundary | Expected invariant | Coverage |
|---|---|---|
| Truncated `localStorage` JSON | Raw value remains recoverable; app receives a blank validated model | `core.test.mjs` |
| Legacy schema v1/v2 | Data migrates to v3 without clearing sales | `core.test.mjs` |
| Unknown future schema | Startup/recovery rejects it | `core.test.mjs` |
| Two stale browser writers | Second writer is rejected by revision check | `core.test.mjs` |
| Storage quota/write failure | Operation raises a persistence error | `core.test.mjs` |
| Modified backup payload | Checksum validation rejects recovery | `core.test.mjs` |
| Finalization with open table | No history is archived or cleared | `core.test.mjs` |
| Finalization with kitchen ticket | No history is archived or cleared | `core.test.mjs` |
| Valid finalization | Backup matches pre-finalization data; sales move into one closure | `core.test.mjs` |
| Recovery over active work | Import is rejected | `core.test.mjs` |
| Stored HTML/script text | Output is escaped | `core.test.mjs` |
| Unsent order at table closure | UI blocks the action | `regression.test.mjs` |
| External tab update | UI reloads a higher revision | `regression.test.mjs` |

## Manual iPad acceptance pass

Run this pass before replacing the operational copy:

1. Create two tables, send both to kitchen and close both.
2. Download a backup and open it from Files to confirm it is non-empty JSON.
3. Attempt finalization with a pending kitchen ticket; verify it is blocked.
4. Clear the ticket, finalize, and verify the active report becomes empty while the
   closure remains in local storage.
5. Restore the downloaded backup and verify both tickets and totals return.
6. Open a second browser tab, change stock in the first, then attempt a change from the
   stale tab; verify the stale change is rejected.
7. Disable available browser storage or fill it to quota; verify the attempted operation
   is rolled back and an error is shown.

## Remaining operational limitation

Downloaded-file completion cannot be proven by a browser application. Finalization
therefore initiates the backup first and requires a separate explicit confirmation. For
stronger guarantees, the next persistence layer should write to IndexedDB and an
operator-selected Files directory before allowing closure.
