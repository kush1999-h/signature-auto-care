# CRITICAL ACCOUNTING ERROR FOUND

## Location

[reports.service.ts - Line 68](apps/api/src/modules/reports/reports.service.ts#L68)

## The Error

```typescript
const cogs = trx.reduce(
  (sum, t) => sum + Math.abs(safeNumber(t.qtyChange)) * safeNumber(t.unitCost),
  0
);
```

### Root Cause

The COGS (Cost of Goods Sold) calculation has a critical flaw:

1. **Optional Field Problem**: The `unitCost` field in InventoryTransaction is optional (`@Prop({ type: MongooseSchema.Types.Decimal128 })`)
2. **Missing Cost Data**: If `unitCost` is undefined/null, `safeNumber(undefined)` returns `0`
3. **Result**: COGS becomes 0 for transactions without unitCost, causing massive profit understatement
4. **Profit Impact**: Net profit is incorrectly calculated as higher than reality because COGS is too low

### Example

- Inventory Transaction created without unitCost (bug in code, or legacy data)
- 10 units sold at $100 selling price, but $60 actual cost
- Current calculation: Math.abs(-10) × 0 = **$0 COGS** ❌
- Correct calculation: Math.abs(-10) × 60 = **$600 COGS** ✓
- **Profit overstated by $600!**

### Affected Code Paths

**Counter Sale (Counter Sales)** - Missing unitCost in transaction creation:

- [invoices.service.ts:184-185](apps/api/src/modules/invoices/invoices.service.ts#L184-L185)
- Stores `part.avgCost` directly as Decimal128, not converted to number

**Work Order Issue** - Same issue:

- [work-orders.service.ts:567-568](apps/api/src/modules/work-orders/work-orders.service.ts#L567-L568)
- Stores `part.avgCost` directly as Decimal128

### Fix Required

1. Ensure `unitCost` is ALWAYS set when creating inventory transactions
2. Make `unitCost` a required field in the schema
3. Add validation to reject transactions without costs
4. Run audit of historical transactions to verify costs are populated

## Financial Impact

This bug causes net profit to be overstated whenever:

- Parts are sold without recorded costs
- Inventory adjustments are made without cost data
- Any COUNTER_SALE or ISSUE_TO_WORK_ORDER lacks unitCost
