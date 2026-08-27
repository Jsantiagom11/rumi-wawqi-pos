#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {
  auditDatabase,
  buildAccountingScenario,
  commitShiftFinalization,
  prepareShiftFinalization,
  validateRecoveryPayload,
} from '../lib/shift-core.mjs';

const usage = `Rumi Wawqi POS Lab\n\nUsage:\n  node cli/rumi-lab.mjs audit <db.json>\n  node cli/rumi-lab.mjs recovery-check <backup.json>\n  node cli/rumi-lab.mjs scenario <snapshot.json>\n  node cli/rumi-lab.mjs simulate-finalize <db.json> <out-dir>\n`;

async function readJson(filePath) {
  const raw = await readFile(filePath, 'utf8');
  try { return JSON.parse(raw); }
  catch (error) { throw new Error(`JSON inválido en ${filePath}: ${error.message}`); }
}

function print(value) { process.stdout.write(`${JSON.stringify(value, null, 2)}\n`); }

async function main() {
  const [command, input, output] = process.argv.slice(2);
  if (!command || !input) {
    process.stderr.write(usage);
    process.exitCode = 2;
    return;
  }

  if (command === 'audit') {
    const result = auditDatabase(await readJson(input));
    print(result);
    if (!result.ok) process.exitCode = 1;
    return;
  }
  if (command === 'recovery-check') {
    const result = validateRecoveryPayload(await readJson(input));
    print(result);
    if (!result.ok) process.exitCode = 1;
    return;
  }
  if (command === 'scenario') {
    print(buildAccountingScenario(await readJson(input)));
    return;
  }
  if (command === 'simulate-finalize') {
    if (!output) throw new Error('simulate-finalize requiere <out-dir>.');
    const db = await readJson(input);
    const now = new Date();
    const prepared = prepareShiftFinalization(db, now);
    const committed = commitShiftFinalization(db, prepared.backup, now);
    await mkdir(output, { recursive: true });
    const backupPath = path.join(output, `${prepared.backup.id}.json`);
    const dbPath = path.join(output, 'database-after-finalization.json');
    const labPath = path.join(output, `${committed.accountingSnapshot.id}.json`);
    await Promise.all([
      writeFile(backupPath, `${JSON.stringify(prepared.backup, null, 2)}\n`, 'utf8'),
      writeFile(dbPath, `${JSON.stringify(committed.database, null, 2)}\n`, 'utf8'),
      writeFile(labPath, `${JSON.stringify(committed.accountingSnapshot, null, 2)}\n`, 'utf8'),
    ]);
    print({ ok: true, backupPath, dbPath, labPath, summary: prepared.summary });
    return;
  }

  process.stderr.write(usage);
  process.exitCode = 2;
}

main().catch((error) => {
  process.stderr.write(`${error.name}: ${error.message}\n`);
  if (error.code) process.stderr.write(`code=${error.code}\n`);
  if (error.details && Object.keys(error.details).length) process.stderr.write(`${JSON.stringify(error.details, null, 2)}\n`);
  process.exitCode = 1;
});
