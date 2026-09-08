import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_SOURCE = path.join(ROOT, 'app', 'index.html');
const DEFAULT_OUTPUT = path.join(ROOT, 'dist', 'rumi-wawqi-pos-operations.html');
const CORE_SOURCE = path.join(ROOT, 'lib', 'operations-core.mjs');
const BOOTSTRAP_SOURCE = path.join(ROOT, 'lib', 'operations-bootstrap.mjs');

const CSS = String.raw`
        /* OPERATIONS_UI_V0_1 */
        .header-actions { display:flex; align-items:center; gap:10px; }
        .ops-trigger {
            border:1px solid rgba(56,189,248,.34); background:rgba(56,189,248,.08); color:var(--accent);
            height:34px; padding:0 12px; border-radius:999px; font-size:.75rem; font-weight:650;
            letter-spacing:.1px; touch-action:manipulation;
        }
        .ops-trigger:active { transform:scale(.98); }
        .ops-shell {
            width:min(92vw,760px); max-height:86vh; overflow:hidden; display:flex; flex-direction:column;
            background:rgba(19,19,22,.98); border:1px solid rgba(255,255,255,.08); border-radius:18px;
            box-shadow:0 28px 90px rgba(0,0,0,.55); padding:20px;
        }
        .ops-head { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; margin-bottom:16px; }
        .ops-eyebrow { color:var(--text-muted); text-transform:uppercase; letter-spacing:.12em; font-size:.66rem; font-weight:700; }
        .ops-title { margin-top:4px; font-size:1.35rem; font-weight:720; letter-spacing:-.035em; }
        .ops-subtitle { margin-top:4px; color:var(--text-muted); font-size:.78rem; }
        .ops-body { overflow:auto; -webkit-overflow-scrolling:touch; padding-right:2px; }
        .ops-hero {
            border:1px solid var(--border); background:linear-gradient(145deg,rgba(255,255,255,.035),rgba(255,255,255,.012));
            padding:16px; border-radius:14px; margin-bottom:12px;
        }
        .ops-hero.ok { border-color:rgba(34,197,94,.22); }
        .ops-hero.attention { border-color:rgba(251,191,36,.28); }
        .ops-hero-main { font-size:1.05rem; font-weight:690; }
        .ops-hero-meta { margin-top:4px; color:var(--text-muted); font-size:.74rem; }
        .ops-section { margin-top:16px; }
        .ops-section-title { color:var(--text-muted); text-transform:uppercase; letter-spacing:.11em; font-size:.65rem; font-weight:750; margin-bottom:8px; }
        .ops-list { border:1px solid var(--border); border-radius:12px; overflow:hidden; }
        .ops-row { min-height:48px; padding:10px 12px; display:flex; align-items:center; justify-content:space-between; gap:12px; background:rgba(255,255,255,.015); }
        .ops-row + .ops-row { border-top:1px solid var(--border); }
        .ops-row-main { min-width:0; }
        .ops-row-name { font-size:.84rem; font-weight:590; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .ops-row-meta { margin-top:2px; font-size:.68rem; color:var(--text-muted); }
        .ops-value { font-variant-numeric:tabular-nums; font-weight:730; font-size:.92rem; white-space:nowrap; }
        .ops-value.warn { color:var(--warning); }
        .ops-value.good { color:var(--success); }
        .ops-mini-btn {
            border:1px solid var(--border); background:var(--input); color:var(--text); border-radius:8px;
            min-height:32px; padding:0 10px; font-size:.7rem; font-weight:650; touch-action:manipulation;
        }
        .ops-mini-btn.primary { border-color:rgba(56,189,248,.45); color:var(--accent); background:rgba(56,189,248,.06); }
        .ops-actions { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:14px; }
        .ops-form { border:1px solid var(--border); border-radius:14px; padding:14px; background:rgba(255,255,255,.018); }
        .ops-form-grid { display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-top:12px; }
        .ops-label { display:block; font-size:.68rem; color:var(--text-muted); margin-bottom:5px; }
        .ops-input, .ops-select {
            width:100%; min-height:42px; background:var(--input); color:var(--text); border:1px solid var(--border);
            border-radius:9px; padding:8px 10px; font-size:.88rem; outline:none;
        }
        .ops-input:focus, .ops-select:focus { border-color:var(--accent); }
        .ops-empty { color:var(--text-muted); font-size:.76rem; padding:12px; }
        .ops-risk { color:var(--warning); }
        @media (max-width:720px) {
            body { padding:12px; }
            header { margin-bottom:12px; }
            .ops-shell { width:96vw; max-height:90vh; padding:16px; border-radius:15px; }
            .ops-form-grid { grid-template-columns:1fr; }
            .ops-actions { grid-template-columns:1fr; }
        }
`;

const MODAL = String.raw`
    <div id="modal-operaciones" class="modal-overlay" aria-hidden="true">
        <section class="ops-shell" role="dialog" aria-modal="true" aria-labelledby="ops-title">
            <div class="ops-head">
                <div>
                    <div class="ops-eyebrow">Rumi / Operación</div>
                    <div id="ops-title" class="ops-title">Estado operativo</div>
                    <div class="ops-subtitle">Solo excepciones. El POS hace el resto.</div>
                </div>
                <button class="modal-close" aria-label="Cerrar operación" onclick="operationsManager.close()">&times;</button>
            </div>
            <div id="ops-body" class="ops-body"></div>
        </section>
    </div>
`;

const INITIALIZE = String.raw`
        // OPERATIONS_BOOTSTRAP_V0_1 — idempotent, no stock assumptions.
        db = bootstrapTrustedOperationsProfile(db);
        localStorage.setItem('rumi_wawqi_offline_db', JSON.stringify(db));
`;

const MANAGER = String.raw`
        const operationsManager = {
            esc(value) {
                return String(value ?? '')
                    .replaceAll('&', '&amp;')
                    .replaceAll('<', '&lt;')
                    .replaceAll('>', '&gt;')
                    .replaceAll('"', '&quot;')
                    .replaceAll("'", '&#039;');
            },
            qty(value) {
                if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
                return Number(value).toLocaleString('es-PE', { maximumFractionDigits: 3 });
            },
            open() {
                const modal = document.getElementById('modal-operaciones');
                modal.style.display = 'flex';
                modal.setAttribute('aria-hidden', 'false');
                this.render();
            },
            close() {
                const modal = document.getElementById('modal-operaciones');
                modal.style.display = 'none';
                modal.setAttribute('aria-hidden', 'true');
            },
            render() {
                const dashboard = buildOperationsDashboard(db);
                const foods = dashboard.capacities.filter((entry) => String(entry.productId || '').startsWith('p'));
                const pendingCounts = dashboard.ingredientStock.filter((entry) => !entry.initialized);
                const hardRisks = dashboard.risks.filter((entry) => entry.code !== 'COUNT_NEEDED');
                const attention = pendingCounts.length + hardRisks.length + dashboard.purchaseSuggestions.length;
                const heroClass = attention === 0 ? 'ok' : 'attention';
                const heroTitle = attention === 0 ? 'Todo bajo control' : (attention === 1 ? '1 cosa por revisar' : \`\${attention} cosas por revisar\`);
                const heroMeta = pendingCounts.length > 0
                    ? 'Activa precisión con un único conteo físico por proteína.'
                    : 'Stock esperado derivado automáticamente de la operación.';

                const todayRows = foods.map((entry) => {
                    const waiting = entry.source === 'legacy-awaiting-count';
                    const label = entry.capacity === null ? '—' : String(entry.capacity);
                    const meta = waiting ? 'capacidad actual · falta conteo inicial' : (entry.source === 'derived-bom' ? 'derivado de proteína' : 'capacidad de servicio');
                    return \`<div class="ops-row">
                        <div class="ops-row-main"><div class="ops-row-name">\${this.esc(entry.productName)}</div><div class="ops-row-meta">\${this.esc(meta)}</div></div>
                        <div class="ops-value \${waiting ? 'warn' : ''}">\${label}</div>
                    </div>\`;
                }).join('');

                const proteinRows = dashboard.ingredientStock.map((entry) => {
                    if (!entry.initialized) {
                        return \`<div class="ops-row">
                            <div class="ops-row-main"><div class="ops-row-name">\${this.esc(entry.name)}</div><div class="ops-row-meta">una vez para activar seguimiento</div></div>
                            <button class="ops-mini-btn primary" onclick="operationsManager.countForm('\${this.esc(entry.ingredientId)}')">Contar</button>
                        </div>\`;
                    }
                    return \`<div class="ops-row">
                        <div class="ops-row-main"><div class="ops-row-name">\${this.esc(entry.name)}</div><div class="ops-row-meta">stock esperado</div></div>
                        <div style="display:flex;align-items:center;gap:8px;"><span class="ops-value \${entry.quantity < 0 ? 'warn' : 'good'}">\${this.qty(entry.quantity)} \${this.esc(entry.unit)}</span><button class="ops-mini-btn" onclick="operationsManager.countForm('\${this.esc(entry.ingredientId)}')">Corregir</button></div>
                    </div>\`;
                }).join('');

                const purchaseRows = dashboard.purchaseSuggestions.length === 0
                    ? '<div class="ops-empty">Sin compra automática urgente.</div>'
                    : dashboard.purchaseSuggestions.map((entry) => \`<div class="ops-row">
                        <div class="ops-row-main"><div class="ops-row-name">\${this.esc(entry.name)}</div><div class="ops-row-meta">llevar stock teórico a \${this.qty(entry.targetQty)} \${this.esc(entry.unit)}</div></div>
                        <div class="ops-value warn">+\${this.qty(entry.buyQty)} \${this.esc(entry.unit)}</div>
                    </div>\`).join('');

                const riskRows = hardRisks.length === 0
                    ? '<div class="ops-empty">Sin anomalías detectadas.</div>'
                    : hardRisks.map((risk) => \`<div class="ops-row"><div class="ops-row-main"><div class="ops-row-name ops-risk">\${this.esc(risk.message)}</div></div></div>\`).join('');

                document.getElementById('ops-body').innerHTML = \`
                    <div class="ops-hero \${heroClass}"><div class="ops-hero-main">\${heroTitle}</div><div class="ops-hero-meta">\${heroMeta}</div></div>
                    <div class="ops-section"><div class="ops-section-title">Hoy</div><div class="ops-list">\${todayRows || '<div class="ops-empty">Sin platos configurados.</div>'}</div></div>
                    <div class="ops-section"><div class="ops-section-title">Proteínas</div><div class="ops-list">\${proteinRows || '<div class="ops-empty">Sin proteínas rastreadas.</div>'}</div></div>
                    <div class="ops-section"><div class="ops-section-title">Falta</div><div class="ops-list">\${purchaseRows}</div></div>
                    <div class="ops-section"><div class="ops-section-title">Riesgo</div><div class="ops-list">\${riskRows}</div></div>
                    <div class="ops-actions"><button class="btn-action btn-pool" style="margin:0;" onclick="operationsManager.purchaseForm()">+ Registrar compra</button><button class="btn-action btn-pool" style="margin:0;border-color:var(--border);color:var(--text-muted);" onclick="operationsManager.close()">Volver al POS</button></div>
                \`;
            },
            countForm(ingredientId) {
                const ingredient = db.operations.ingredients.find((entry) => entry.id === ingredientId);
                if (!ingredient) return;
                const current = computeIngredientStock(db, ingredientId);
                const initialValue = current.initialized && current.quantity >= 0 ? this.qty(current.quantity).replace(',', '.') : '';
                document.getElementById('ops-body').innerHTML = \`
                    <div class="ops-form">
                        <div class="ops-eyebrow">Conteo físico</div>
                        <div class="ops-title" style="font-size:1.1rem;">\${this.esc(ingredient.name)}</div>
                        <div class="ops-subtitle">Esto reemplaza el stock teórico en este instante. No necesitas reconstruir movimientos anteriores.</div>
                        <div class="ops-form-grid"><label><span class="ops-label">Cantidad (\${this.esc(ingredient.unit)})</span><input id="ops-count-qty" class="ops-input" type="number" min="0" step="0.001" inputmode="decimal" value="\${initialValue}" autofocus></label></div>
                        <div class="ops-actions"><button class="btn-action" style="margin:0;" onclick="operationsManager.saveCount('\${this.esc(ingredientId)}')">Guardar conteo</button><button class="btn-action btn-pool" style="margin:0;" onclick="operationsManager.render()">Cancelar</button></div>
                    </div>\`;
                setTimeout(() => document.getElementById('ops-count-qty')?.focus(), 0);
            },
            saveCount(ingredientId) {
                const input = document.getElementById('ops-count-qty');
                const qty = Number(input?.value);
                if (!Number.isFinite(qty) || qty < 0) { alert('Ingresa una cantidad válida.'); return; }
                db = recordPhysicalCount(db, { ingredientId, qty }, new Date());
                syncDB();
                this.render();
            },
            purchaseForm() {
                const options = db.operations.ingredients.map((entry) => \`<option value="\${this.esc(entry.id)}">\${this.esc(entry.name)}</option>\`).join('');
                document.getElementById('ops-body').innerHTML = \`
                    <div class="ops-form">
                        <div class="ops-eyebrow">Movimiento nuevo</div>
                        <div class="ops-title" style="font-size:1.1rem;">Registrar compra</div>
                        <div class="ops-subtitle">Solo registra lo que realmente ingresó. El resto se deriva del POS.</div>
                        <div class="ops-form-grid">
                            <label><span class="ops-label">Proteína</span><select id="ops-purchase-ingredient" class="ops-select">\${options}</select></label>
                            <label><span class="ops-label">Cantidad</span><input id="ops-purchase-qty" class="ops-input" type="number" min="0.001" step="0.001" inputmode="decimal" placeholder="kg"></label>
                            <label><span class="ops-label">Costo unitario S/ (opcional)</span><input id="ops-purchase-cost" class="ops-input" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0.00"></label>
                        </div>
                        <div class="ops-actions"><button class="btn-action" style="margin:0;" onclick="operationsManager.savePurchase()">Guardar compra</button><button class="btn-action btn-pool" style="margin:0;" onclick="operationsManager.render()">Cancelar</button></div>
                    </div>\`;
                setTimeout(() => document.getElementById('ops-purchase-qty')?.focus(), 0);
            },
            savePurchase() {
                const ingredientId = document.getElementById('ops-purchase-ingredient')?.value;
                const qty = Number(document.getElementById('ops-purchase-qty')?.value);
                const rawCost = document.getElementById('ops-purchase-cost')?.value?.trim();
                if (!ingredientId || !Number.isFinite(qty) || qty <= 0) { alert('Ingresa una compra válida.'); return; }
                let unitCostCents = null;
                if (rawCost) {
                    const cost = Number(rawCost);
                    if (!Number.isFinite(cost) || cost < 0) { alert('Ingresa un costo válido.'); return; }
                    unitCostCents = Math.round((cost + Number.EPSILON) * 100);
                }
                db = recordPurchase(db, { ingredientId, qty, unitCostCents }, new Date());
                syncDB();
                this.render();
            },
        };
`;

function stripModuleSyntax(source) {
  return source
    .replace(/^import\s+.*?;\s*$/gm, '')
    .replace(/^export\s+/gm, '');
}

function replaceOnce(source, anchor, replacement, label) {
  const first = source.indexOf(anchor);
  if (first < 0) throw new Error(`Build anchor not found: ${label}`);
  if (source.indexOf(anchor, first + anchor.length) >= 0) throw new Error(`Build anchor is ambiguous: ${label}`);
  return source.slice(0, first) + replacement + source.slice(first + anchor.length);
}

export async function buildOperationsUi({
  sourcePath = DEFAULT_SOURCE,
  outputPath = DEFAULT_OUTPUT,
  corePath = CORE_SOURCE,
  bootstrapPath = BOOTSTRAP_SOURCE,
} = {}) {
  const [source, coreModule, bootstrapModule] = await Promise.all([
    readFile(sourcePath, 'utf8'),
    readFile(corePath, 'utf8'),
    readFile(bootstrapPath, 'utf8'),
  ]);

  if (source.includes('OPERATIONS_UI_V0_1')) {
    throw new Error('Source already contains Operations UI markers; refusing a double injection.');
  }

  const runtime = `${stripModuleSyntax(coreModule)}\n${stripModuleSyntax(bootstrapModule)}\n`;
  let built = source;
  built = replaceOnce(built, '    </style>', `${CSS}\n    </style>`, 'style close');
  built = replaceOnce(
    built,
    '        <div id="reloj">--:--:--</div>',
    '        <div class="header-actions"><button class="ops-trigger" onclick="operationsManager.open()">Operación</button><div id="reloj">--:--:--</div></div>',
    'header clock',
  );
  built = replaceOnce(
    built,
    '    <div id="modal-reporte" class="modal-overlay">',
    `${MODAL}\n    <div id="modal-reporte" class="modal-overlay">`,
    'report modal',
  );
  built = replaceOnce(
    built,
    '        const CARTA_ESTANDAR = [',
    `        // Inline domain runtime generated from tested source modules.\n${runtime}\n        const CARTA_ESTANDAR = [`,
    'menu declaration',
  );
  built = replaceOnce(
    built,
    '        db.schemaVersion = 2;',
    `        db.schemaVersion = 2;\n${INITIALIZE}`,
    'legacy migration',
  );
  built = replaceOnce(
    built,
    '        const analyticsManager = {',
    `${MANAGER}\n        const analyticsManager = {`,
    'analytics manager',
  );

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, built, 'utf8');
  return { outputPath, bytes: Buffer.byteLength(built), html: built };
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  const requestedOutput = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_OUTPUT;
  const result = await buildOperationsUi({ outputPath: requestedOutput });
  console.log(`Built ${result.outputPath} (${result.bytes} bytes)`);
}
