import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import {
  Invoice,
  InvoiceDocument,
  Payment,
  PaymentDocument,
  WorkOrder,
  WorkOrderDocument,
  Expense,
  ExpenseDocument,
  Payable,
  PayableDocument,
  InventoryTransaction,
  InventoryTransactionDocument,
} from "../../schemas";
function inRangeFilter(dateFrom?: Date, dateTo?: Date, field: string = "createdAt") {
  if (!dateFrom && !dateTo) return {};
  const range: { $gte?: Date; $lte?: Date } = {};
  if (dateFrom) range.$gte = dateFrom;
  if (dateTo) range.$lte = dateTo;
  return { [field]: range };
}

const toNumber = (val: unknown) => {
  if (!val) return 0;
  if (typeof val === "object" && "toString" in val) {
    return parseFloat((val as { toString: () => string }).toString());
  }
  return typeof val === "number" ? val : Number(val);
};

const safeNumber = (val: unknown) => {
  const num = toNumber(val);
  return Number.isFinite(num) ? num : 0;
};

type InvoiceLean = {
  _id: unknown;
  workOrderId?: unknown;
  createdAt?: Date | string;
  lineItems?: unknown;
  total?: unknown;
  subtotal?: unknown;
  tax?: unknown;
};

@Injectable()
export class ReportsService {
  constructor(
    @InjectModel(Invoice.name) private invoiceModel: Model<InvoiceDocument>,
    @InjectModel(Payment.name) private paymentModel: Model<PaymentDocument>,
    @InjectModel(WorkOrder.name) private workOrderModel: Model<WorkOrderDocument>,
    @InjectModel(Expense.name) private expenseModel: Model<ExpenseDocument>,
    @InjectModel(Payable.name) private payableModel: Model<PayableDocument>,
    @InjectModel(InventoryTransaction.name)
    private trxModel: Model<InventoryTransactionDocument>
  ) {}

  async salesReport(params: { from?: string; to?: string }) {
    const from = params.from ? new Date(params.from) : undefined;
    const to = params.to ? new Date(params.to) : undefined;
    const closedInvoices = (await this.invoiceModel
      .find({ status: "CLOSED" })
      .lean()
      .exec()) as InvoiceLean[];

    const hasDateFilter = Boolean(from || to);
    let deliveredByWorkOrderId = new Map<string, Date>();
    if (hasDateFilter) {
      const workOrderIds = closedInvoices
        .map((invoice) => invoice.workOrderId)
        .filter(Boolean);
      if (workOrderIds.length) {
        const deliveredOrders = await this.workOrderModel
          .find({
            _id: { $in: workOrderIds },
            ...inRangeFilter(from, to, "deliveredAt"),
          })
          .select("_id deliveredAt")
          .lean()
          .exec();
        deliveredByWorkOrderId = new Map(
          deliveredOrders
            .filter((wo) => wo.deliveredAt)
            .map((wo) => [wo._id.toString(), new Date(wo.deliveredAt as Date)])
        );
      }
    } else {
      const workOrderIds = closedInvoices
        .map((invoice) => invoice.workOrderId)
        .filter(Boolean);
      if (workOrderIds.length) {
        const deliveredOrders = await this.workOrderModel
          .find({ _id: { $in: workOrderIds } })
          .select("_id deliveredAt")
          .lean()
          .exec();
        deliveredByWorkOrderId = new Map(
          deliveredOrders
            .filter((wo) => wo.deliveredAt)
            .map((wo) => [wo._id.toString(), new Date(wo.deliveredAt as Date)])
        );
      }
    }

    const invoices = closedInvoices.filter((invoice) => {
      if (!hasDateFilter) return true;
      if (invoice.workOrderId) {
        return deliveredByWorkOrderId.has(invoice.workOrderId.toString());
      }
      const invoiceCreatedAt = new Date(invoice.createdAt || 0);
      if (from && invoiceCreatedAt < from) return false;
      if (to && invoiceCreatedAt > to) return false;
      return true;
    });
    
    // Convert Decimal128 values to numbers for calculation
    const invoicesWithNumbers = (invoices || []).map((inv) => {
      const invoice = inv as InvoiceLean;
      const lineItems = Array.isArray(invoice.lineItems) ? invoice.lineItems : [];
      return {
        ...invoice,
        deliveredAt: invoice.workOrderId
          ? deliveredByWorkOrderId.get(invoice.workOrderId.toString()) || null
          : null,
        total: safeNumber(invoice.total),
        subtotal: safeNumber(invoice.subtotal),
        tax: safeNumber(invoice.tax),
        lineItems: lineItems.map((li) => {
          const item = li as { total?: unknown; unitPrice?: unknown; costAtTime?: unknown; quantity?: unknown; type?: unknown };
          return {
            ...item,
            total: safeNumber(item.total),
            unitPrice: safeNumber(item.unitPrice),
            costAtTime: safeNumber(item.costAtTime),
            quantity: Number(item.quantity) || 0
          };
        })
      };
    });
    
    // Parts revenue = sum of PART line items only
    const partsRevenue = invoicesWithNumbers.reduce((sum, inv) => {
      return (
        sum +
        (inv.lineItems || [])
          .filter((li) => li.type === "PART")
          .reduce((p: number, li) => p + li.total, 0)
      );
    }, 0);
    
    // Labor revenue = sum of LABOR line items only
    const laborRevenue = invoicesWithNumbers.reduce((sum, inv) => {
      return (
        sum +
        (inv.lineItems || [])
          .filter((li) => li.type === "LABOR")
          .reduce((p: number, li) => p + li.total, 0)
      );
    }, 0);
    
    // Other revenue = sum of OTHER line items only
    const otherRevenue = invoicesWithNumbers.reduce((sum, inv) => {
      return (
        sum +
        (inv.lineItems || [])
          .filter((li) => li.type === "OTHER")
          .reduce((p: number, li) => p + li.total, 0)
      );
    }, 0);

    // Service revenue = sum of SERVICE line items only
    const serviceRevenue = invoicesWithNumbers.reduce((sum, inv) => {
      return (
        sum +
        (inv.lineItems || [])
          .filter((li) => li.type === "SERVICE")
          .reduce((p: number, li) => p + li.total, 0)
      );
    }, 0);
    
    // Revenue prefers summed line items (PART + LABOR + OTHER) and falls back to invoice total when line items are missing/zero
    const revenue = invoicesWithNumbers.reduce((sum, inv) => {
      const lineItemsTotal = (inv.lineItems || []).reduce(
        (lineSum: number, li) => lineSum + safeNumber(li.total),
        0
      );
      const tax = safeNumber(inv.tax);
      const invoiceTotal = safeNumber(inv.total);
      const effectiveTotal =
        lineItemsTotal > 0 ? lineItemsTotal + tax : invoiceTotal;
      return sum + effectiveTotal;
    }, 0);
    
    return { invoices: invoicesWithNumbers, revenue, partsRevenue, laborRevenue, serviceRevenue, otherRevenue };
  }

  async profitReport(params: { from?: string; to?: string }) {
    const from = params.from ? new Date(params.from) : undefined;
    const to = params.to ? new Date(params.to) : undefined;
    const sales = await this.salesReport(params);
    const expenses = await this.expenseModel.find({
      isDeleted: { $ne: true },
      ...inRangeFilter(from, to, "expenseDate"),
    });
    const operatingExpenses = expenses.filter((exp) => !isInventoryLinkedExpense(exp));
    const cashExpensesTotal = operatingExpenses.reduce((sum, e) => sum + safeNumber(e.amount), 0);
    const payables = await this.payableModel.find({
      ...inRangeFilter(from, to, "purchaseDate"),
    });
    const openPayablesTotal = payables.reduce((sum, p) => {
      const status = typeof p.status === "string" ? p.status.toUpperCase() : "OPEN";
      return status === "PAID" ? sum : sum + safeNumber(p.amount);
    }, 0);
    const creditPurchasesTotal = openPayablesTotal;
    // Operating expenses only; inventory purchases are tracked via payables/inventory and hit COGS on sale.
    const expensesTotal = cashExpensesTotal;

    // CRITICAL FIX: Only count COGS from transactions linked to CLOSED invoices
    // Get invoice IDs from closed invoices only
    // Calculate COGS only for items in closed invoices
    // COGS = Cost of Goods Sold = Sum(costAtTime × quantity) for PART, SERVICE and OTHER line items
    // LABOR line items are NOT part of COGS calculation
    // - LABOR costs are already factored into the selling price (revenue)
    // - OTHER/CHARGE costs are additional charges, not inventory costs
    const cogs = sales.invoices.reduce((sum, invoice) => {
      return (
        sum +
        (invoice.lineItems || []).reduce((lineSum: number, lineItem) => {
          // Only process cost-bearing lines
          if (
            lineItem.type !== "PART" &&
            lineItem.type !== "SERVICE" &&
            lineItem.type !== "OTHER"
          ) {
            return lineSum;
          }
          const itemCost = safeNumber(lineItem.costAtTime);
          const qty = Number(lineItem.quantity) || 0;
          // Only count if cost is a valid positive number
          if (!Number.isFinite(itemCost) || itemCost <= 0) {
            return lineSum;
          }
          const lineCost = qty * itemCost;
          return lineSum + lineCost;
        }, 0)
      );
    }, 0);
    const revenue = safeNumber(sales.revenue);
    const grossProfit = revenue - cogs;
    const netProfit = grossProfit - expensesTotal;
    return {
      revenue,
      cogs,
      grossProfit: safeNumber(grossProfit),
      expenses: expensesTotal,
      cashExpenses: cashExpensesTotal,
      creditPurchases: creditPurchasesTotal,
      openPayables: openPayablesTotal,
      netProfit: safeNumber(netProfit),
      invoices: sales.invoices,
      expensesBreakdown: operatingExpenses,
      payablesBreakdown: payables,
    };
  }

  async inventoryReport() {
    const transactions = await this.trxModel
      .find()
      .sort({ createdAt: -1 })
      .limit(200);
    return { transactions };
  }
}

function isInventoryLinkedExpense(expense: Expense) {
  const category = String(expense.category || "").toLowerCase();
  if (category !== "supplies") return false;
  const note = String(expense.note || "");
  return note.includes("Part: ") || note.startsWith("Payable paid");
}
