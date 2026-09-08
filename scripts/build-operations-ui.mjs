import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_SOURCE = path.join(ROOT, 'app', 'index.html');
const DEFAULT_OUTPUT = path.join(ROOT, 'dist', 'rumi-wawqi-pos-operations.html');
const RUNTIME_SOURCES = [
  path.join(ROOT, 'lib', 'operations-core.mjs'),
  path.join(ROOT, 'lib', 'operations-bootstrap.mjs'),
  path.join(ROOT, 'lib', 'operations-browser-ui.mjs'),
];

const CSS = `
        /* OPERATIONS_UI_V0_1 */
        .header-actions { display:flex; align-items:center; gap:10px; }
        .ops-trigger { border:1px solid rgba(56,189,248,.34); background:rgba(56,189,248,.08); color:var(--accent); height:34px; padding:0 12px; border-radius:999px; font-size:.75rem; font-weight:650; letter-spacing:.1px; touch-action:manipulation; }
        .ops-trigger:active { transform:scale(.98); }
        .ops-shell { width:min(92vw,760px); max-height:86vh; overflow:hidden; display:flex; flex-direction:column; background:rgba(19,19,22,.98); border:1px solid rgba(255,255,255,.08); border-radius:18px; box-shadow:0 28px 90px rgba(0,0,0,.55); padding:20px; }
        .ops-head { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; margin-bottom:16px; }
        .ops-eyebrow { color:var(--text-muted); text-transform:uppercase; letter-spacing:.12em; font-size:.66rem; font-weight:700; }
        .ops-title { margin-top:4px; font-size:1.35rem; font-weight:720; letter-spacing:-.035em; }
        .ops-subtitle { margin-top:4px; color:var(--text-muted); font-size:.78rem; }
        .ops-body { overflow:auto; -webkit-overflow-scrolling:touch; padding-right:2px; }
        .ops-hero { border:1px solid var(--border); background:linear-gradient(145deg,rgba(255,255,255,.035),rgba(255,255,255,.012)); padding:16px; border-radius:14px; margin-bottom:12px; }
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
        .ops-value.warn, .ops-risk { color:var(--warning); }
        .ops-value.good { color:var(--success); }
        .ops-mini-btn { border:1px solid var(--border); background:var(--input); color:var(--text); border-radius:8px; min-height:32px; padding:0 10px; font-size:.7rem; font-weight:650; touch-action:manipulation; }
        .ops-mini-btn.primary { border-color:rgba(56,189,248,.45); color:var(--accent); background:rgba(56,189,248,.06); }
        .ops-actions { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:14px; }
        .ops-form { border:1px solid var(--border); border-radius:14px; padding:14px; background:rgba(255,255,255,.018); }
        .ops-form-grid { display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-top:12px; }
        .ops-label { display:block; font-size:.68rem; color:var(--text-muted); margin-bottom:5px; }
        .ops-input, .ops-select { width:100%; min-height:42px; background:var(--input); color:var(--text); border:1px solid var(--border); border-radius:9px; padding:8px 10px; font-size:.88rem; outline:none; }
        .ops-input:focus, .ops-select:focus { border-color:var(--accent); }
        .ops-empty { color:var(--text-muted); font-size:.76rem; padding:12px; }
        @media (max-width:720px) { body { padding:12px; } header { margin-bottom:12px; } .ops-shell { width:96vw; max-height:90vh; padding:16px; border-radius:15px; } .ops-form-grid, .ops-actions { grid-template-columns:1fr; } }
`;

const MODAL = `
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

export async function buildOperationsUi({ sourcePath = DEFAULT_SOURCE, outputPath = DEFAULT_OUTPUT } = {}) {
  const [source, ...runtimeModules] = await Promise.all([
    readFile(sourcePath, 'utf8'),
    ...RUNTIME_SOURCES.map((sourcePathEntry) => readFile(sourcePathEntry, 'utf8')),
  ]);

  if (source.includes('OPERATIONS_UI_V0_1')) {
    throw new Error('Source already contains Operations UI markers; refusing a double injection.');
  }

  const runtime = runtimeModules.map(stripModuleSyntax).join('\n\n');
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
    `        // Inline Operations runtime generated from tested source modules.\n${runtime}\n\n        const CARTA_ESTANDAR = [`,
    'menu declaration',
  );
  built = replaceOnce(
    built,
    '        db.schemaVersion = 2;',
    `        db.schemaVersion = 2;\n        // OPERATIONS_BOOTSTRAP_V0_1 — idempotent, no stock assumptions.\n        db = bootstrapTrustedOperationsProfile(db);\n        localStorage.setItem('rumi_wawqi_offline_db', JSON.stringify(db));`,
    'legacy migration',
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
