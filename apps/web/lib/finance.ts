type LineItem = {
  type?: string;
  total?: number;
  quantity?: number;
  costAtTime?: number;
};

export type InvoiceLite = {
  createdAt: string;
  total?: number;
  tax?: number;
  lineItems?: LineItem[];
};

type DatedAmount = { date: string; amount: number };

const toNumber = (val: unknown) => {
  if (val === null || val === undefined) return 0;
  if (typeof val === "number") return Number.isFinite(val) ? val : 0;
  if (typeof val === "string") {
    const num = Number(val);
    return Number.isFinite(num) ? num : 0;
  }
  if (typeof val === "object" && "toString" in val) {
    const text = (val as { toString: () => string }).toString();
    const num = Number(text);
    return Number.isFinite(num) ? num : 0;
  }
  return 0;
};

const toDateKey = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
};

export const calcInvoiceRevenue = (inv: InvoiceLite) => {
  const lineItems = Array.isArray(inv.lineItems) ? inv.lineItems : [];
  const lineTotal = lineItems.reduce((sum, item) => sum + toNumber(item.total), 0);
  const tax = toNumber(inv.tax);
  if (lineTotal > 0) return lineTotal + tax;
  return toNumber(inv.total);
};

export const calcInvoiceCogs = (inv: InvoiceLite) => {
  const lineItems = Array.isArray(inv.lineItems) ? inv.lineItems : [];
  return lineItems.reduce((sum, item) => {
    if (item.type !== "PART") return sum;
    const cost = toNumber(item.costAtTime);
    const qty = Number(item.quantity) || 0;
    if (!Number.isFinite(cost) || cost <= 0 || qty <= 0) return sum;
    return sum + cost * qty;
  }, 0);
};

export const sumByDate = (items: DatedAmount[]) => {
  const map: Record<string, number> = {};
  items.forEach((item) => {
    const key = toDateKey(item.date);
    if (!key) return;
    map[key] = (map[key] || 0) + toNumber(item.amount);
  });
  return map;
};

export const sumByMonth = (items: DatedAmount[]) => {
  const map: Record<string, number> = {};
  items.forEach((item) => {
    const key = toDateKey(item.date);
    if (!key) return;
    const monthKey = key.slice(0, 7);
    map[monthKey] = (map[monthKey] || 0) + toNumber(item.amount);
  });
  return map;
};
