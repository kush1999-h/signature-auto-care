import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { InvoiceStatus, PaymentType } from "@signature-auto-care/shared";
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
  VendorPayment,
  VendorPaymentDocument,
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
  if (
    typeof val === "object" &&
    val !== null &&
    "$numberDecimal" in (val as Record<string, unknown>)
  ) {
    return Number((val as { $numberDecimal?: string }).$numberDecimal || 0);
  }
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
  outstandingAmount?: unknown;
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
    @InjectModel(VendorPayment.name)
    private vendorPaymentModel: Model<VendorPaymentDocument> = {} as Model<VendorPaymentDocument>,
    @InjectModel(InventoryTransaction.name)
    private trxModel: Model<InventoryTransactionDocument>
  ) {}

  async salesReport(params: { from?: string; to?: string }) {
    const from = params.from ? new Date(params.from) : undefined;
    const to = params.to ? new Date(params.to) : undefined;
    const revenueStatuses = [
      InvoiceStatus.ISSUED,
      InvoiceStatus.PARTIALLY_PAID,
      InvoiceStatus.PAID,
    ];
    const closedInvoices = (await this.invoiceModel
      .find({ status: { $in: revenueStatuses } })
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
        outstandingAmount: safeNumber(invoice.outstandingAmount),
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
    const payments = await this.paymentModel.find({
      ...inRangeFilter(from, to, "paidAt"),
    });
    const openPayablesTotal = payables.reduce((sum, p) => {
      const status = typeof p.status === "string" ? p.status.toUpperCase() : "OPEN";
      return status === "PAID" ? sum : sum + safeNumber(p.amount);
    }, 0);
    const receivables = sales.invoices.reduce((sum, invoice) => {
      const due = safeNumber((invoice as InvoiceLean & { outstandingAmount?: unknown }).outstandingAmount);
      return sum + due;
    }, 0);
    const cashCollected = payments.reduce((sum, payment) => {
      if (payment.isVoided) return sum;
      const method = String(payment.method || "").toUpperCase();
      const multiplier = payment.paymentType === PaymentType.REFUND ? -1 : 1;
      return method === "CASH" ? sum + safeNumber(payment.amount) * multiplier : sum;
    }, 0);
    const bankCollected = payments.reduce((sum, payment) => {
      if (payment.isVoided) return sum;
      const method = String(payment.method || "").toUpperCase();
      const multiplier = payment.paymentType === PaymentType.REFUND ? -1 : 1;
      return method === "CARD" || method === "BANK_TRANSFER"
        ? sum + safeNumber(payment.amount) * multiplier
        : sum;
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
      cashCollected,
      bankCollected,
      receivables,
      creditPurchases: creditPurchasesTotal,
      openPayables: openPayablesTotal,
      netProfit: safeNumber(netProfit),
      invoices: sales.invoices,
      expensesBreakdown: operatingExpenses,
      payablesBreakdown: payables,
    };
  }

  async receivablesAgingReport(params: { from?: string; to?: string }) {
    const from = params.from ? new Date(params.from) : undefined;
    const to = params.to ? new Date(params.to) : undefined;
    const invoices = await this.invoiceModel
      .find({
        status: { $in: [InvoiceStatus.ISSUED, InvoiceStatus.PARTIALLY_PAID] },
      })
      .lean()
      .exec();
    const rows = invoices
      .map((invoice: any) => {
        const due = safeNumber(invoice.outstandingAmount);
        const anchor = invoice.dueDate || invoice.issuedAt || invoice.createdAt;
        const dueDate = anchor ? new Date(anchor) : null;
        if (!dueDate || due <= 0) return null;
        if (from && dueDate < from) return null;
        if (to && dueDate > to) return null;
        const daysOverdue = Math.max(
          Math.floor((Date.now() - dueDate.getTime()) / (1000 * 60 * 60 * 24)),
          0
        );
        const bucket =
          daysOverdue <= 0
            ? "CURRENT"
            : daysOverdue <= 30
              ? "1_30"
              : daysOverdue <= 60
                ? "31_60"
                : daysOverdue <= 90
                  ? "61_90"
                  : "90_PLUS";
        return {
          ...invoice,
          total: safeNumber(invoice.total),
          totalPaid: safeNumber(invoice.totalPaid),
          outstandingAmount: due,
          dueDate,
          daysOverdue,
          bucket,
        };
      })
      .filter(Boolean) as any[];
    const buckets = rows.reduce(
      (acc, row) => {
        acc.total += row.outstandingAmount;
        acc[row.bucket] += row.outstandingAmount;
        return acc;
      },
      { total: 0, CURRENT: 0, "1_30": 0, "31_60": 0, "61_90": 0, "90_PLUS": 0 } as Record<string, number>
    );
    return { totals: buckets, rows };
  }

  async payablesAgingReport(params: { from?: string; to?: string }) {
    const from = params.from ? new Date(params.from) : undefined;
    const to = params.to ? new Date(params.to) : undefined;
    const payables = await this.payableModel
      .find({ status: { $ne: "PAID" } })
      .lean()
      .exec();
    const rows = payables
      .map((payable: any) => {
        const anchor = payable.dueDate || payable.purchaseDate;
        const dueDate = anchor ? new Date(anchor) : null;
        if (!dueDate) return null;
        if (from && dueDate < from) return null;
        if (to && dueDate > to) return null;
        const amount = safeNumber(payable.amount);
        const daysOverdue = Math.max(
          Math.floor((Date.now() - dueDate.getTime()) / (1000 * 60 * 60 * 24)),
          0
        );
        const bucket =
          daysOverdue <= 0
            ? "CURRENT"
            : daysOverdue <= 30
              ? "1_30"
              : daysOverdue <= 60
                ? "31_60"
                : daysOverdue <= 90
                  ? "61_90"
                  : "90_PLUS";
        return {
          ...payable,
          amount,
          unitCost: safeNumber(payable.unitCost),
          dueDate,
          daysOverdue,
          bucket,
        };
      })
      .filter(Boolean) as any[];
    const buckets = rows.reduce(
      (acc, row) => {
        acc.total += row.amount;
        acc[row.bucket] += row.amount;
        return acc;
      },
      { total: 0, CURRENT: 0, "1_30": 0, "31_60": 0, "61_90": 0, "90_PLUS": 0 } as Record<string, number>
    );
    return { totals: buckets, rows };
  }

  async financeActivityReport(params: { from?: string; to?: string; limit?: number }) {
    const from = params.from ? new Date(params.from) : undefined;
    const to = params.to ? new Date(params.to) : undefined;
    const limit = Math.min(Math.max(params.limit || 30, 1), 100);

    const [invoices, payments, vendorPayments] = await Promise.all([
      this.invoiceModel
        .find({
          issuedAt: { $exists: true },
          ...inRangeFilter(from, to, "issuedAt"),
        })
        .sort({ issuedAt: -1 })
        .limit(limit)
        .lean()
        .exec(),
      this.paymentModel
        .find({
          ...inRangeFilter(from, to, "paidAt"),
        })
        .sort({ paidAt: -1, createdAt: -1 })
        .limit(limit)
        .lean()
        .exec(),
      this.vendorPaymentModel
        .find({
          ...inRangeFilter(from, to, "paidAt"),
        })
        .sort({ paidAt: -1, createdAt: -1 })
        .limit(limit)
        .lean()
        .exec(),
    ]);

    const invoiceRows = invoices.map((invoice: any) => ({
      id: invoice._id.toString(),
      type: "INVOICE_ISSUED",
      date: invoice.issuedAt || invoice.createdAt,
      amount: safeNumber(invoice.total),
      invoiceId: invoice._id.toString(),
      invoiceNumber: invoice.invoiceNumber,
      customerId: invoice.customerId?.toString?.() || invoice.customerId,
      workOrderId: invoice.workOrderId?.toString?.() || invoice.workOrderId,
    }));

    const paymentRows = payments.map((payment: any) => ({
      id: payment._id.toString(),
      type: payment.isVoided
        ? "PAYMENT_VOID"
        : payment.paymentType === PaymentType.REFUND
          ? "REFUND"
          : "PAYMENT",
      date: payment.paidAt || payment.createdAt,
      amount: safeNumber(payment.amount),
      method: payment.method,
      invoiceId: payment.invoiceId?.toString?.() || payment.invoiceId,
      note: payment.note,
      isVoided: Boolean(payment.isVoided),
      voidReason: payment.voidReason,
    }));

    const vendorRows = vendorPayments.map((payment: any) => ({
      id: payment._id.toString(),
      type: "VENDOR_PAYMENT",
      date: payment.paidAt || payment.createdAt,
      amount: safeNumber(payment.amount),
      method: payment.method,
      payableId: payment.payableId?.toString?.() || payment.payableId,
      vendorName: payment.vendorName,
      note: payment.note,
    }));

    const rows = [...invoiceRows, ...paymentRows, ...vendorRows]
      .sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime())
      .slice(0, limit);

    return { rows };
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
