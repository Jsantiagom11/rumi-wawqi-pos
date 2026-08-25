import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../app/index.html', import.meta.url), 'utf8');

test('cash backup never clears sales history', () => {
  const exportBlock = source.slice(
    source.indexOf('exportarCierreCaja() {'),
    source.indexOf('cerrarModal()', source.indexOf('exportarCierreCaja() {')),
  );
  assert.ok(exportBlock.includes('db.cierres.push(cierre)'));
  assert.ok(!exportBlock.includes('db.historial = []'));
});

test('sales and kitchen events have ISO timestamps', () => {
  assert.ok(source.includes('cerradoEn: new Date().toISOString()'));
  assert.ok(source.includes('creadoEn: new Date().toISOString()'));
});

test('legacy local data receives a non-destructive schema migration', () => {
  assert.ok(source.includes('db.historial = Array.isArray(db.historial)'));
  assert.ok(source.includes('db.cierres = Array.isArray(db.cierres)'));
  assert.ok(source.includes('db.schemaVersion = 2'));
});

