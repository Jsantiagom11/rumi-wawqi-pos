import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';

async function captureDemoSale(page, context, offlineBeforeClose = false) {
  await page.goto('/');
  await page.locator('.mesa-btn').first().click({ position: { x: 5, y: 5 } });
  await page.locator('.plato-row').first().click({ position: { x: 5, y: 5 } });
  await expect(page.getByText('S/ 10.00', { exact: true })).toBeVisible();
  if (offlineBeforeClose) await context.setOffline(true);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Cerrar y liberar mesa' }).click();
}

async function readLocalDatabase(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('rumi_wawqi_offline_db')));
}

test('a completed offline sale survives a reload without duplicating its totals', async ({ page, context }) => {
  await captureDemoSale(page, context, true);
  const before = await readLocalDatabase(page);
  assert.equal(before.historial.length, 1);
  assert.equal(before.historial[0].total, 10);
  assert.equal(before.historial[0].items[0].cantidad, 1);
  assert.ok(!Number.isNaN(Date.parse(before.historial[0].cerradoEn)));

  await context.setOffline(false);
  await page.reload();
  const after = await readLocalDatabase(page);
  assert.deepEqual(after.historial, before.historial);
  assert.equal(after.cierres.length, 0);
});

test('a downloaded shift backup retains sales on device and in the JSON artifact', async ({ page, context }) => {
  await captureDemoSale(page, context);
  await context.setOffline(true);
  page.once('dialog', dialog => dialog.accept());
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Respaldar turno' }).click();
  const download = await downloadPromise;
  assert.match(download.suggestedFilename(), /^respaldo_rumi_wawqi_.*\.json$/);

  const backup = JSON.parse(await readFile(await download.path(), 'utf8'));
  assert.equal(backup.cantidadTickets, 1);
  assert.equal(backup.total, 10);
  assert.equal(backup.ventas.length, 1);

  const before = await readLocalDatabase(page);
  assert.equal(before.historial.length, 1);
  assert.equal(before.cierres.length, 1);
  assert.deepEqual(before.cierres[0].ventas, backup.ventas);

  await context.setOffline(false);
  await page.reload();
  const after = await readLocalDatabase(page);
  assert.deepEqual(after.historial, before.historial);
  assert.equal(after.cierres.length, 1);
});
