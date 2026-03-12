import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectConnection, InjectModel } from "@nestjs/mongoose";
import { Connection, Model, Types } from "mongoose";
import {
  InvoiceStatus,
  InvoiceType,
  InventoryReferenceType,
  InventoryTransactionType,
  PaymentType,
  WorkOrderStatus,
} from "@signature-auto-care/shared";
import {
  Invoice,
  InvoiceDocument,
  Payment,
  PaymentDocument,
  VendorPaymentDocument,
  WorkOrder,
  WorkOrderDocument,
  Part,
  PartDocument,
  InventoryTransaction,
  InventoryTransactionDocument,
} from "../../schemas";
import { AuditService } from "../audit/audit.service";

@Injectable()
export class InvoicesService {
  constructor(
    @InjectModel(Invoice.name) private invoiceModel: Model<InvoiceDocument>,
    @InjectModel(Payment.name) private paymentModel: Model<PaymentDocument>,
    @InjectModel(WorkOrder.name)
    private workOrderModel: Model<WorkOrderDocument>,
    @InjectModel(Part.name) private partModel: Model<PartDocument>,
    @InjectModel(InventoryTransaction.name)
    private trxModel: Model<InventoryTransactionDocument>,
    @InjectConnection() private connection: Connection,
    private audit: AuditService
  ) {}

  private generateInvoiceNumber() {
    return `INV-${Date.now()}`;
  }

  private decimalFromNumber(val: number) {
    return Types.Decimal128.fromString((val || 0).toString());
  }

  private decimalToNumber(val?: Types.Decimal128 | number | null) {
    if (!val) return 0;
    if (typeof val === "number") return val;
    if (
      typeof val === "object" &&
      val !== null &&
      "$numberDecimal" in (val as unknown as Record<string, unknown>)
    ) {
      const parsed = Number(
        (val as { $numberDecimal?: string }).$numberDecimal || 0
      );
      return Number.isFinite(parsed) ? parsed : 0;
    }
    return parseFloat(val.toString());
  }

  private isResolvedInvoiceStatus(status?: string) {
    return status === InvoiceStatus.PAID || status === InvoiceStatus.VOID;
  }

  private calculateEffectivePaymentTotals(payments: PaymentDocument[]) {
    let totalPaid = 0;
    let refundedAmount = 0;
    for (const payment of payments) {
      if (payment.isVoided) continue;
      const amount = this.decimalToNumber(payment.amount);
      if (payment.paymentType === PaymentType.REFUND) {
        refundedAmount += amount;
      } else {
        totalPaid += amount;
      }
    }
    return {
      totalPaid,
      refundedAmount,
      netCollected: totalPaid - refundedAmount,
    };
  }

  private normalizeInvoiceForList(invoice: any) {
    const lineItems = Array.isArray(invoice.lineItems) ? invoice.lineItems : [];
    const normalizedLineItems = lineItems.map((item: any) => ({
      ...item,
      unitPrice: this.decimalToNumber(item.unitPrice),
      total: this.decimalToNumber(item.total),
      costAtTime: this.decimalToNumber(item.costAtTime),
    }));
    const lineItemsTotal = normalizedLineItems.reduce(
      (sum: number, item: any) => sum + this.decimalToNumber(item.total),
      0
    );
    const tax = this.decimalToNumber(invoice.tax);
    const storedTotal = this.decimalToNumber(invoice.total);
    const effectiveTotal = storedTotal > 0 ? storedTotal : lineItemsTotal + tax;
    return {
      ...invoice,
      subtotal: this.decimalToNumber(invoice.subtotal),
      tax,
      total: effectiveTotal,
      totalPaid: this.decimalToNumber(invoice.totalPaid),
      outstandingAmount:
        storedTotal > 0
          ? this.decimalToNumber(invoice.outstandingAmount)
          : Math.max(effectiveTotal - this.decimalToNumber(invoice.totalPaid), 0),
      dueDate: invoice.dueDate || invoice.issuedAt || invoice.createdAt,
      lineItems: normalizedLineItems,
    };
  }

  private async syncInvoiceTotals(invoice: InvoiceDocument, advanceApplied = 0, session?: any) {
    const payments = await this.paymentModel.find({ invoiceId: invoice._id }).session(session || null);
    const { totalPaid, netCollected } = this.calculateEffectivePaymentTotals(payments);
    const outstandingAmount = Math.max(
      this.decimalToNumber(invoice.total) - advanceApplied - netCollected,
      0
    );

    invoice.totalPaid = this.decimalFromNumber(netCollected);
    invoice.outstandingAmount = this.decimalFromNumber(outstandingAmount);
    if (invoice.status !== InvoiceStatus.VOID) {
      if (outstandingAmount <= 0 && this.decimalToNumber(invoice.total) > 0) {
        invoice.status = InvoiceStatus.PAID;
      } else if (totalPaid > 0 || advanceApplied > 0) {
        invoice.status = InvoiceStatus.PARTIALLY_PAID;
      } else if (invoice.status !== InvoiceStatus.DRAFT) {
        invoice.status = InvoiceStatus.ISSUED;
      }
      if (
        (invoice.status === InvoiceStatus.ISSUED ||
          invoice.status === InvoiceStatus.PARTIALLY_PAID ||
          invoice.status === InvoiceStatus.PAID) &&
        !invoice.issuedAt
      ) {
        invoice.issuedAt = new Date();
      }
      if (!invoice.dueDate) {
        invoice.dueDate = invoice.issuedAt || new Date();
      }
    }
    await invoice.save(session ? { session } : undefined);
    return { totalPaid, netCollected, outstandingAmount };
  }

  async list() {
    const invoices = await this.invoiceModel.find().sort({ createdAt: -1 }).lean().exec();
    const workOrderIds = invoices.map((invoice) => invoice.workOrderId).filter(Boolean);
    const workOrders = workOrderIds.length
      ? await this.workOrderModel
          .find({ _id: { $in: workOrderIds } })
          .select("_id workOrderNumber")
          .lean()
          .exec()
      : [];
    const workOrderMap = new Map(
      workOrders.map((workOrder) => [workOrder._id.toString(), workOrder.workOrderNumber])
    );
    return invoices.map((invoice) => ({
      ...this.normalizeInvoiceForList(invoice),
      workOrderNumber: invoice.workOrderId
        ? workOrderMap.get(invoice.workOrderId.toString())
        : undefined,
    }));
  }

  async create(payload: Partial<Invoice>) {
    const invoiceNumber = payload.invoiceNumber || this.generateInvoiceNumber();
    return this.invoiceModel.create({
      ...payload,
      invoiceNumber,
      dueDate: payload.dueDate || payload.issuedAt,
    });
  }

  async closeInvoice(params: {
    invoiceId: string;
    payment: { method: string; amount: number };
    performedBy: string;
  }) {
    const session = await this.connection.startSession();
    session.startTransaction();
    try {
      const invoice = await this.invoiceModel
        .findById(params.invoiceId)
        .session(session);
      if (!invoice) throw new NotFoundException("Invoice not found");
      if (invoice.status === InvoiceStatus.VOID) {
        throw new BadRequestException("Cannot pay a void invoice");
      }
      if (invoice.status === InvoiceStatus.DRAFT) {
        invoice.status = InvoiceStatus.ISSUED;
        invoice.issuedAt = invoice.issuedAt || new Date();
        invoice.dueDate = invoice.dueDate || invoice.issuedAt;
        await invoice.save({ session });
      }

      const payment = await this.paymentModel.create(
        [
          {
            invoiceId: invoice._id,
            paymentType: PaymentType.INVOICE_PAYMENT,
            method: params.payment.method,
            amount: this.decimalFromNumber(params.payment.amount),
          },
        ],
        { session }
      );
      const settlement = await this.syncInvoiceTotals(invoice, 0, session);

      await this.audit.record({
        actionType: "INVOICE_PAYMENT",
        entityType: "Invoice",
        entityId: invoice._id.toString(),
        performedByEmployeeId: new Types.ObjectId(params.performedBy),
        after: { payment: payment[0].toObject(), outstandingAmount: settlement.outstandingAmount },
      });

      if (invoice.workOrderId) {
        const wo = await this.workOrderModel.findByIdAndUpdate(
          invoice.workOrderId,
          { $set: { status: WorkOrderStatus.CLOSED, deliveredAt: new Date() } },
          { new: true, session }
        );
        if (wo) {
          await this.audit.record({
            actionType: "WORK_ORDER_STATUS_UPDATE",
            entityType: "WorkOrder",
            entityId: wo._id.toString(),
            performedByEmployeeId: new Types.ObjectId(params.performedBy),
            after: { status: WorkOrderStatus.CLOSED, reason: "Invoice paid" },
          });
        }
      }

      await session.commitTransaction();
      return { invoice, payment: payment[0], settlement };
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      session.endSession();
    }
  }

  async counterSaleCheckout(payload: {
    customerId?: string;
    items: { partId: string; qty: number }[];
    payment: { method: string; amount: number };
    performedBy: string;
    idempotencyKey?: string;
  }) {
    if (payload.idempotencyKey) {
      const existingInvoice = await this.invoiceModel.findOne({
        idempotencyKey: payload.idempotencyKey,
      });
      if (existingInvoice) {
        const payment = await this.paymentModel.findOne({
          invoiceId: existingInvoice._id,
        });
        return { invoice: existingInvoice, payment };
      }
      const existingTrx = await this.trxModel.findOne({
        idempotencyKey: payload.idempotencyKey,
      });
      if (existingTrx) {
        const invoice = await this.invoiceModel.findOne({
          _id: existingTrx.referenceId,
        });
        const payment = invoice
          ? await this.paymentModel.findOne({ invoiceId: invoice._id })
          : null;
        return { invoice, payment };
      }
    }

    const session = await this.connection.startSession();
    session.startTransaction();
    try {
      const lineItems: {
        type: "PART";
        description: string;
        quantity: number;
        unitPrice: Types.Decimal128;
        total: Types.Decimal128;
        costAtTime: Types.Decimal128;
      }[] = [];
      let subtotal = 0;
      const invoiceId = new Types.ObjectId();
      const invoiceNumber = this.generateInvoiceNumber();
      for (let idx = 0; idx < payload.items.length; idx++) {
        const item = payload.items[idx];
        if (!Number.isInteger(item.qty) || item.qty <= 0) {
          throw new BadRequestException("Quantity must be a positive integer");
        }
        const part = await this.partModel.findOneAndUpdate(
          {
            _id: item.partId,
            $expr: {
              $gte: [
                {
                  $subtract: [
                    { $ifNull: ["$onHandQty", 0] },
                    { $ifNull: ["$reservedQty", 0] },
                  ],
                },
                item.qty,
              ],
            },
          },
          { $inc: { onHandQty: -Math.abs(item.qty) } },
          { new: true, session }
        );
        if (!part) {
          const latest = await this.partModel.findById(item.partId);
          const available = latest
            ? (latest.onHandQty ?? 0) - (latest.reservedQty ?? 0)
            : 0;
          throw new BadRequestException(
            `Insufficient stock for ${item.partId}. Available ${available}`
          );
        }

        const unitPrice = this.decimalToNumber(part.sellingPrice);
        const unitCost = this.decimalToNumber(part.avgCost);
        const lineTotal = unitPrice * item.qty;
        lineItems.push({
          type: "PART",
          description: part.partName,
          quantity: item.qty,
          unitPrice: this.decimalFromNumber(unitPrice),
          total: this.decimalFromNumber(lineTotal),
          costAtTime: this.decimalFromNumber(unitCost),
        });
        subtotal += lineTotal;

        const trxIdempotencyKey =
          idx === 0 ? payload.idempotencyKey : undefined;
        await this.trxModel.create(
          [
            {
              type: InventoryTransactionType.COUNTER_SALE,
              partId: part._id,
              qtyChange: -Math.abs(item.qty),
              unitCost: this.decimalFromNumber(unitCost),
              unitPrice: this.decimalFromNumber(unitPrice),
              referenceType: InventoryReferenceType.COUNTER_SALE,
              referenceId: invoiceId.toString(),
              performedByEmployeeId: new Types.ObjectId(payload.performedBy),
              idempotencyKey: trxIdempotencyKey,
            },
          ],
          { session }
        );
      }
      const tax = 0;
      const total = subtotal + tax;
      const invoice = await this.invoiceModel.create(
        [
          {
            _id: invoiceId,
            invoiceNumber,
            type: InvoiceType.COUNTER_SALE,
            customerId: payload.customerId
              ? new Types.ObjectId(payload.customerId)
              : undefined,
            lineItems,
            subtotal: this.decimalFromNumber(subtotal),
            tax: this.decimalFromNumber(tax),
            total: this.decimalFromNumber(total),
            status: InvoiceStatus.ISSUED,
            totalPaid: this.decimalFromNumber(0),
            outstandingAmount: this.decimalFromNumber(total),
            issuedAt: new Date(),
            dueDate: new Date(),
            idempotencyKey: payload.idempotencyKey,
          },
        ],
        { session }
      );
      const payment = await this.paymentModel.create(
        [
          {
            invoiceId: invoice[0]._id,
            paymentType: PaymentType.INVOICE_PAYMENT,
            method: payload.payment.method,
            amount: this.decimalFromNumber(payload.payment.amount),
          },
        ],
        { session }
      );
      await this.syncInvoiceTotals(invoice[0], 0, session);
      await this.audit.record({
        actionType: "COUNTER_SALE",
        entityType: "Invoice",
        entityId: invoice[0]._id.toString(),
        performedByEmployeeId: new Types.ObjectId(payload.performedBy),
        after: { total },
      });
      await session.commitTransaction();
      return { invoice: invoice[0], payment: payment[0] };
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      session.endSession();
    }
  }

  async listPayments(invoiceId: string) {
    const invoice = await this.invoiceModel.findById(invoiceId).lean().exec();
    if (!invoice) throw new NotFoundException("Invoice not found");
    const payments = await this.paymentModel
      .find({ invoiceId })
      .sort({ paidAt: -1, createdAt: -1 })
      .lean()
      .exec();
    return {
      invoice: this.normalizeInvoiceForList(invoice),
      payments: payments.map((payment) => ({
        ...payment,
        amount: this.decimalToNumber(payment.amount as any),
      })),
    };
  }

  async voidInvoice(invoiceId: string, reason: string, user: { userId: string; name?: string; role?: string }) {
    if (user.role !== "OWNER_ADMIN") {
      throw new BadRequestException("Only OWNER_ADMIN can void invoices");
    }
    const invoice = await this.invoiceModel.findById(invoiceId);
    if (!invoice) throw new NotFoundException("Invoice not found");
    if (invoice.status === InvoiceStatus.VOID) {
      return invoice;
    }
    const payments = await this.paymentModel.find({ invoiceId: invoice._id });
    const { netCollected } = this.calculateEffectivePaymentTotals(payments);
    if (netCollected > 0) {
      throw new BadRequestException("Cannot void invoice with collected payments. Refund or void payments first.");
    }
    invoice.status = InvoiceStatus.VOID;
    invoice.voidedAt = new Date();
    invoice.outstandingAmount = this.decimalFromNumber(0);
    await invoice.save();
    await this.audit.record({
      actionType: "INVOICE_VOID",
      entityType: "Invoice",
      entityId: invoice._id.toString(),
      performedByEmployeeId: new Types.ObjectId(user.userId),
      performedByName: user.name,
      performedByRole: user.role,
      after: { reason, status: InvoiceStatus.VOID },
    });
    return invoice;
  }

  async refundInvoice(
    invoiceId: string,
    payload: { amount: number; method: string; note?: string },
    user: { userId: string; name?: string; role?: string }
  ) {
    if (user.role !== "OWNER_ADMIN") {
      throw new BadRequestException("Only OWNER_ADMIN can refund invoices");
    }
    const session = await this.connection.startSession();
    session.startTransaction();
    try {
      const invoice = await this.invoiceModel.findById(invoiceId).session(session);
      if (!invoice) throw new NotFoundException("Invoice not found");
      const payments = await this.paymentModel.find({ invoiceId: invoice._id }).session(session);
      const { netCollected } = this.calculateEffectivePaymentTotals(payments);
      const amount = Number(payload.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new BadRequestException("Refund amount must be greater than zero");
      }
      if (amount > netCollected) {
        throw new BadRequestException("Refund amount cannot exceed collected amount");
      }
      const refund = await this.paymentModel.create(
        [
          {
            invoiceId: invoice._id,
            paymentType: PaymentType.REFUND,
            method: payload.method,
            amount: this.decimalFromNumber(amount),
            paidAt: new Date(),
            note: payload.note,
          },
        ],
        { session }
      );
      const settlement = await this.syncInvoiceTotals(invoice, 0, session);
      await this.audit.record({
        actionType: "INVOICE_REFUND",
        entityType: "Invoice",
        entityId: invoice._id.toString(),
        performedByEmployeeId: new Types.ObjectId(user.userId),
        performedByName: user.name,
        performedByRole: user.role,
        after: {
          refund: refund[0].toObject(),
          outstandingAmount: settlement.outstandingAmount,
        },
      });
      await session.commitTransaction();
      return { invoice, refund: refund[0], settlement };
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      session.endSession();
    }
  }

  async voidPayment(
    paymentId: string,
    reason: string,
    user: { userId: string; name?: string; role?: string }
  ) {
    if (user.role !== "OWNER_ADMIN") {
      throw new BadRequestException("Only OWNER_ADMIN can void payments");
    }
    const session = await this.connection.startSession();
    session.startTransaction();
    try {
      const payment = await this.paymentModel.findById(paymentId).session(session);
      if (!payment) throw new NotFoundException("Payment not found");
      if (payment.isVoided) {
        throw new BadRequestException("Payment is already voided");
      }
      payment.isVoided = true;
      payment.voidedAt = new Date();
      payment.voidReason = reason;
      payment.voidedByEmployeeId = new Types.ObjectId(user.userId);
      payment.voidedByName = user.name;
      payment.voidedByRole = user.role;
      await payment.save({ session });

      const invoice = await this.invoiceModel.findById(payment.invoiceId).session(session);
      if (!invoice) throw new NotFoundException("Invoice not found");
      const settlement = await this.syncInvoiceTotals(invoice, 0, session);

      await this.audit.record({
        actionType: "PAYMENT_VOID",
        entityType: "Payment",
        entityId: payment._id.toString(),
        performedByEmployeeId: new Types.ObjectId(user.userId),
        performedByName: user.name,
        performedByRole: user.role,
        after: { reason, invoiceId: invoice._id.toString(), outstandingAmount: settlement.outstandingAmount },
      });

      await session.commitTransaction();
      return { payment, invoice, settlement };
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      session.endSession();
    }
  }
}
