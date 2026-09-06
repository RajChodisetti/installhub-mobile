import type { CostLine, CostLineInput, InvoiceStatus, PricingMode, UpsertFinanceHeaderInput } from '../types/commercial';

export function commercialNumber(value: string, label: string, optional = false, step = 0.01): number | null {
  if (!value.trim()) {
    if (optional) return null;
    throw new Error(`${label} is required.`);
  }
  const parsed = Number(value.trim());
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be a valid number.`);
  if (parsed < 0) throw new Error(`${label} cannot be negative.`);
  if (Math.abs(parsed / step - Math.round(parsed / step)) > 0.0000001) throw new Error(`${label} must use increments of ${step}.`);
  return parsed;
}

export function financeHeaderInput(pricingMode: PricingMode, amount: string, notes: string): UpsertFinanceHeaderInput {
  return { pricingMode, pricedAmount: commercialNumber(amount, 'Priced amount', true), notes: notes.trim() || null };
}

export function costLineInput(input: { category: CostLineInput['category']; description: string; cost: string; sell: string }): CostLineInput {
  if (!input.description.trim()) throw new Error('Description is required.');
  return {
    category: input.category, description: input.description.trim(),
    costAmount: commercialNumber(input.cost, 'Cost')!,
    sellAmount: commercialNumber(input.sell, 'Sell amount', true),
    billable: true,
  };
}

export function eligibleInvoiceLines(lines: readonly CostLine[]): CostLine[] {
  return lines.filter((line) => line.billable && !line.invoiced);
}

export function selectedInvoiceLineIds(lines: readonly CostLine[], excluded: ReadonlySet<string>): string[] {
  return eligibleInvoiceLines(lines).filter((line) => !excluded.has(line.id)).map((line) => line.id);
}

/** Matches the portal preview; the accepted server invoice remains authoritative. */
export function invoicePreview(lines: readonly CostLine[], excluded: ReadonlySet<string>) {
  const selected = eligibleInvoiceLines(lines).filter((line) => !excluded.has(line.id));
  const subtotal = selected.reduce((total, line) => total + (line.sellAmount ?? line.costAmount), 0);
  const gst = Math.round(subtotal * 0.1 * 100) / 100;
  return { subtotal, gst, total: Math.round((subtotal + gst) * 100) / 100 };
}

export function invoiceActions(status: InvoiceStatus): { issue: boolean; void: boolean; download: boolean } {
  return { issue: status === 'draft', void: status !== 'void', download: status !== 'void' };
}

export function commercialMoney(value: number, currency = 'AUD'): string {
  try { return new Intl.NumberFormat('en-AU', { style: 'currency', currency }).format(value); }
  catch { return `${currency} ${value.toFixed(2)}`; }
}
