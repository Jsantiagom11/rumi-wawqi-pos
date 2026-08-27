# WSL runbook — shift engine and Accounting Lab

The browser POS remains runtime-dependency-free. The files under `lib/` and `cli/` are an operational test harness for Linux/WSL and the domain contract for explicit shift finalization and recovery.

## 1. Bootstrap

```bash
cd ~/workspace
git clone https://github.com/Jsantiagom11/rumi-wawqi-pos.git
cd rumi-wawqi-pos
node --version   # 20+
npm test
make check
```

No `npm install` is required: the project uses only Node built-ins.

## 2. Audit a database export

```bash
npm run audit -- fixtures/sample-shift-v2.json
# or
node cli/rumi-lab.mjs audit /path/to/database.json
```

Exit codes are automation-friendly: `0` means the audit passed; `1` means a data/invariant failure; `2` means invalid CLI usage.

## 3. Simulate the two-phase close

```bash
make finalize-demo
find .tmp/finalize-demo -maxdepth 1 -type f -print
```

The command creates three independent artifacts:

1. **Full backup** — pre-finalization snapshot; this is the recovery source of truth.
2. **Database after finalization** — archived closure + empty active history + new shift id.
3. **Accounting snapshot** — immutable educational basis generated from the real closed sales.

The commit phase refuses to run when there are active tables, pending kitchen tickets, an empty shift, a missing backup, or a stale backup created before state changed.

## 4. Validate a recovery file

```bash
npm run recovery:check -- .tmp/finalize-demo/backup_*.json
```

Recovery validation is fail-closed. It checks backup kind/version, schema compatibility, a deterministic snapshot checksum and internal sale totals. Applying recovery also blocks silent overwrite when the current database has active table orders.

The checksum detects accidental modification/corruption; it is **not** a cryptographic signature or authentication mechanism.

## 5. Generate an Accounting Lab scenario

Use the `lab_*.json` file created by `simulate-finalize`:

```bash
npm run scenario -- .tmp/finalize-demo/lab_*.json
```

The scenario keeps two namespaces separate:

- `realBasis`: actual tickets, item count and gross sales from the shift.
- `hypothetical`: an explicitly simulated reconciliation variance for training.

A simulated discrepancy must never be presented as a real shortage/surplus.

## 6. Regression / rainy-day suite

```bash
make check
```

Protected invariants include:

- decimal money normalization through integer cents;
- non-destructive schema migration;
- active-table and pending-kitchen finalization blocks;
- immutable complete backup before finalization;
- stale/foreign/corrupt backup rejection;
- preservation of menu, tables and previous closures;
- no silent recovery over active orders;
- malformed-JSON CLI behavior;
- deterministic Accounting Lab scenarios;
- legacy browser regression checks in `tests/regression.test.mjs`.

## 7. Browser smoke run from WSL

```bash
make serve
```

Then open `http://localhost:8080`. The current iPad single-file deployment remains unchanged by the WSL domain harness until the UI integration is explicitly released.
