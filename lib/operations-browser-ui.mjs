export const operationsManager = {
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
    const heroTitle = attention === 0
      ? 'Todo bajo control'
      : (attention === 1 ? '1 cosa por revisar' : `${attention} cosas por revisar`);
    const heroMeta = pendingCounts.length > 0
      ? 'Activa precisión con un único conteo físico por proteína.'
      : 'Stock esperado derivado automáticamente de la operación.';

    const todayRows = foods.map((entry) => {
      const waiting = entry.source === 'legacy-awaiting-count';
      const label = entry.capacity === null ? '—' : String(entry.capacity);
      const meta = waiting
        ? 'capacidad actual · falta conteo inicial'
        : (entry.source === 'derived-bom' ? 'derivado de proteína' : 'capacidad de servicio');
      return `<div class="ops-row">
        <div class="ops-row-main"><div class="ops-row-name">${this.esc(entry.productName)}</div><div class="ops-row-meta">${this.esc(meta)}</div></div>
        <div class="ops-value ${waiting ? 'warn' : ''}">${label}</div>
      </div>`;
    }).join('');

    const proteinRows = dashboard.ingredientStock.map((entry) => {
      if (!entry.initialized) {
        return `<div class="ops-row">
          <div class="ops-row-main"><div class="ops-row-name">${this.esc(entry.name)}</div><div class="ops-row-meta">una vez para activar seguimiento</div></div>
          <button class="ops-mini-btn primary" onclick="operationsManager.countForm('${this.esc(entry.ingredientId)}')">Contar</button>
        </div>`;
      }
      return `<div class="ops-row">
        <div class="ops-row-main"><div class="ops-row-name">${this.esc(entry.name)}</div><div class="ops-row-meta">stock esperado</div></div>
        <div style="display:flex;align-items:center;gap:8px;"><span class="ops-value ${entry.quantity < 0 ? 'warn' : 'good'}">${this.qty(entry.quantity)} ${this.esc(entry.unit)}</span><button class="ops-mini-btn" onclick="operationsManager.countForm('${this.esc(entry.ingredientId)}')">Corregir</button></div>
      </div>`;
    }).join('');

    const purchaseRows = dashboard.purchaseSuggestions.length === 0
      ? '<div class="ops-empty">Sin compra automática urgente.</div>'
      : dashboard.purchaseSuggestions.map((entry) => `<div class="ops-row">
        <div class="ops-row-main"><div class="ops-row-name">${this.esc(entry.name)}</div><div class="ops-row-meta">llevar stock teórico a ${this.qty(entry.targetQty)} ${this.esc(entry.unit)}</div></div>
        <div class="ops-value warn">+${this.qty(entry.buyQty)} ${this.esc(entry.unit)}</div>
      </div>`).join('');

    const riskRows = hardRisks.length === 0
      ? '<div class="ops-empty">Sin anomalías detectadas.</div>'
      : hardRisks.map((risk) => `<div class="ops-row"><div class="ops-row-main"><div class="ops-row-name ops-risk">${this.esc(risk.message)}</div></div></div>`).join('');

    document.getElementById('ops-body').innerHTML = `
      <div class="ops-hero ${heroClass}"><div class="ops-hero-main">${heroTitle}</div><div class="ops-hero-meta">${heroMeta}</div></div>
      <div class="ops-section"><div class="ops-section-title">Hoy</div><div class="ops-list">${todayRows || '<div class="ops-empty">Sin platos configurados.</div>'}</div></div>
      <div class="ops-section"><div class="ops-section-title">Proteínas</div><div class="ops-list">${proteinRows || '<div class="ops-empty">Sin proteínas rastreadas.</div>'}</div></div>
      <div class="ops-section"><div class="ops-section-title">Falta</div><div class="ops-list">${purchaseRows}</div></div>
      <div class="ops-section"><div class="ops-section-title">Riesgo</div><div class="ops-list">${riskRows}</div></div>
      <div class="ops-actions"><button class="btn-action btn-pool" style="margin:0;" onclick="operationsManager.purchaseForm()">+ Registrar compra</button><button class="btn-action btn-pool" style="margin:0;border-color:var(--border);color:var(--text-muted);" onclick="operationsManager.close()">Volver al POS</button></div>
    `;
  },

  countForm(ingredientId) {
    const ingredient = db.operations.ingredients.find((entry) => entry.id === ingredientId);
    if (!ingredient) return;
    const current = computeIngredientStock(db, ingredientId);
    const initialValue = current.initialized && current.quantity >= 0
      ? this.qty(current.quantity).replace(',', '.')
      : '';
    document.getElementById('ops-body').innerHTML = `
      <div class="ops-form">
        <div class="ops-eyebrow">Conteo físico</div>
        <div class="ops-title" style="font-size:1.1rem;">${this.esc(ingredient.name)}</div>
        <div class="ops-subtitle">Esto reemplaza el stock teórico en este instante. No necesitas reconstruir movimientos anteriores.</div>
        <div class="ops-form-grid"><label><span class="ops-label">Cantidad (${this.esc(ingredient.unit)})</span><input id="ops-count-qty" class="ops-input" type="number" min="0" step="0.001" inputmode="decimal" value="${initialValue}" autofocus></label></div>
        <div class="ops-actions"><button class="btn-action" style="margin:0;" onclick="operationsManager.saveCount('${this.esc(ingredientId)}')">Guardar conteo</button><button class="btn-action btn-pool" style="margin:0;" onclick="operationsManager.render()">Cancelar</button></div>
      </div>`;
    setTimeout(() => document.getElementById('ops-count-qty')?.focus(), 0);
  },

  saveCount(ingredientId) {
    const input = document.getElementById('ops-count-qty');
    const qty = Number(input?.value);
    if (!Number.isFinite(qty) || qty < 0) {
      alert('Ingresa una cantidad válida.');
      return;
    }
    db = recordPhysicalCount(db, { ingredientId, qty }, new Date());
    syncDB();
    this.render();
  },

  purchaseForm() {
    const options = db.operations.ingredients
      .map((entry) => `<option value="${this.esc(entry.id)}">${this.esc(entry.name)}</option>`)
      .join('');
    document.getElementById('ops-body').innerHTML = `
      <div class="ops-form">
        <div class="ops-eyebrow">Movimiento nuevo</div>
        <div class="ops-title" style="font-size:1.1rem;">Registrar compra</div>
        <div class="ops-subtitle">Solo registra lo que realmente ingresó. El resto se deriva del POS.</div>
        <div class="ops-form-grid">
          <label><span class="ops-label">Proteína</span><select id="ops-purchase-ingredient" class="ops-select">${options}</select></label>
          <label><span class="ops-label">Cantidad</span><input id="ops-purchase-qty" class="ops-input" type="number" min="0.001" step="0.001" inputmode="decimal" placeholder="kg"></label>
          <label><span class="ops-label">Costo unitario S/ (opcional)</span><input id="ops-purchase-cost" class="ops-input" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0.00"></label>
        </div>
        <div class="ops-actions"><button class="btn-action" style="margin:0;" onclick="operationsManager.savePurchase()">Guardar compra</button><button class="btn-action btn-pool" style="margin:0;" onclick="operationsManager.render()">Cancelar</button></div>
      </div>`;
    setTimeout(() => document.getElementById('ops-purchase-qty')?.focus(), 0);
  },

  savePurchase() {
    const ingredientId = document.getElementById('ops-purchase-ingredient')?.value;
    const qty = Number(document.getElementById('ops-purchase-qty')?.value);
    const rawCost = document.getElementById('ops-purchase-cost')?.value?.trim();
    if (!ingredientId || !Number.isFinite(qty) || qty <= 0) {
      alert('Ingresa una compra válida.');
      return;
    }

    let unitCostCents = null;
    if (rawCost) {
      const cost = Number(rawCost);
      if (!Number.isFinite(cost) || cost < 0) {
        alert('Ingresa un costo válido.');
        return;
      }
      unitCostCents = Math.round((cost + Number.EPSILON) * 100);
    }

    db = recordPurchase(db, { ingredientId, qty, unitCostCents }, new Date());
    syncDB();
    this.render();
  },
};
