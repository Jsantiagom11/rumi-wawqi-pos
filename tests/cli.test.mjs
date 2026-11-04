import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const cli = new URL('../cli/rumi-lab.mjs', import.meta.url);

function fixture() {
  return {
    schemaVersion: 2,
    platos: [],
    mesas: [{ id: 'M1', nombre: 'Mesa 1', estado: 'libre', orden: [], detalle: '' }],
    cocina: [],
    historial: [{ id: 1, items: [{ nombre: 'Trucha', precio: 25, cantidad: 2 }], total: 50 }],
    cierres: [],
  };
}

function run(...args) {
  return spawnSync(process.execPath, [cli.pathname, ...args], { encoding: 'utf8' });
}

test('CLI audit returns JSON and success for valid database', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'rumi-cli-'));
  const file = path.join(dir, 'db.json');
  await writeFile(file, JSON.stringify(fixture()));
  const result = run('audit', file);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, true);
  assert.equal(output.summary.totalCents, 5000);
});

test('CLI simulate-finalize writes backup, next database and accounting snapshot', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'rumi-cli-'));
  const file = path.join(dir, 'db.json');
  const out = path.join(dir, 'out');
  await writeFile(file, JSON.stringify(fixture()));
  const result = run('simulate-finalize', file, out);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  const nextDb = JSON.parse(await readFile(output.dbPath, 'utf8'));
  const backup = JSON.parse(await readFile(output.backupPath, 'utf8'));
  const lab = JSON.parse(await readFile(output.labPath, 'utf8'));
  assert.equal(nextDb.historial.length, 0);
  assert.equal(backup.database.historial.length, 1);
  assert.equal(lab.basis.grossSalesCents, 5000);
});

test('CLI rejects unknown command', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'rumi-cli-'));
  const file = path.join(dir, 'db.json');
  await writeFile(file, JSON.stringify(fixture()));
  const result = run('unknown', file);
  assert.equal(result.status, 2);
});

test('CLI reports invalid JSON without stack-trace noise', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'rumi-cli-'));
  const file = path.join(dir, 'broken.json');
  await writeFile(file, '{broken');
  const result = run('audit', file);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /JSON inválido/);
  assert.doesNotMatch(result.stderr, /at main/);
});
