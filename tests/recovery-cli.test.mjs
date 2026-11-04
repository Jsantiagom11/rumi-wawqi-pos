import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { prepareShiftFinalization } from '../lib/shift-core.mjs';

const cli = new URL('../cli/rumi-lab.mjs', import.meta.url);
const NOW = new Date('2026-08-26T23:30:00.000Z');

function fixture(overrides = {}) {
  return {
    schemaVersion: 2,
    platos: [{ id: 'p1', nombre: 'Trucha', precio: 25, stock: 10 }],
    mesas: [{ id: 'M1', nombre: 'Mesa 1', estado: 'libre', orden: [], detalle: '' }],
    cocina: [],
    historial: [{ id: 1, items: [{ nombre: 'Trucha', precio: 25, cantidad: 2 }], total: 50 }],
    cierres: [],
    ...overrides,
  };
}

function run(...args) {
  return spawnSync(process.execPath, [cli.pathname, ...args], { encoding: 'utf8' });
}

async function writeRecoveryFixture(dir) {
  const source = fixture();
  const { backup } = prepareShiftFinalization(source, NOW);
  const backupFile = path.join(dir, 'backup.json');
  await writeFile(backupFile, JSON.stringify(backup), 'utf8');
  return { source, backupFile };
}

test('CLI recover writes validated backup to a new database file', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'rumi-recover-'));
  const { backupFile } = await writeRecoveryFixture(dir);
  const currentFile = path.join(dir, 'current.json');
  const recoveredFile = path.join(dir, 'recovered.json');
  await writeFile(currentFile, JSON.stringify(fixture({ historial: [] })), 'utf8');

  const result = run('recover', currentFile, backupFile, recoveredFile);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, true);
  const recovered = JSON.parse(await readFile(recoveredFile, 'utf8'));
  assert.equal(recovered.historial.length, 1);
  assert.equal(recovered.historial[0].total, 50);
});

test('CLI recover blocks active orders unless explicit override is supplied', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'rumi-recover-'));
  const { backupFile } = await writeRecoveryFixture(dir);
  const currentFile = path.join(dir, 'current-active.json');
  const blockedOut = path.join(dir, 'blocked.json');
  const forcedOut = path.join(dir, 'forced.json');
  await writeFile(currentFile, JSON.stringify(fixture({
    historial: [],
    mesas: [{
      id: 'M9', nombre: 'Mesa 9', estado: 'ocupada',
      orden: [{ id: 'p1', nombre: 'Trucha', precio: 25, cantidad: 1 }], detalle: '',
    }],
  })), 'utf8');

  const blocked = run('recover', currentFile, backupFile, blockedOut);
  assert.equal(blocked.status, 1);
  assert.match(blocked.stderr, /ACTIVE_TABLES_PRESENT/);

  const forced = run('recover', currentFile, backupFile, forcedOut, '--allow-active-overwrite');
  assert.equal(forced.status, 0, forced.stderr);
  const recovered = JSON.parse(await readFile(forcedOut, 'utf8'));
  assert.equal(recovered.mesas[0].id, 'M1');
});
