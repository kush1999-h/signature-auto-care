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
  WorkOrderStatus,
} from "@signature-auto-care/shared";
import {
  Invoice,
  InvoiceDocument,
  Payment,
  PaymentDocument,
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
    return parseFloat(val.toString());
  }

  async list() {
    return this.invoiceModel.find().sort({ createdAt: -1 }).exec();
  }

  async create(payload: Partial<Invoice>) {
    const invoiceNumber = payload.invoiceNumber || this.generateInvoiceNumber();
    return this.invoiceModel.create({ ...payload, invoiceNumber });
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
      if (invoice.status === InvoiceStatus.CLOSED) {
        throw new BadRequestException("Already closed");
      }
      invoice.status = InvoiceStatus.CLOSED;
      await invoice.save({ session });

      const payment = await this.paymentModel.create(
        [
          {
            invoiceId: invoice._id,
            method: params.payment.method,
            amount: this.decimalFromNumber(params.payment.amount),
          },
        ],
        { session }
      );

      await this.audit.record({
        actionType: "INVOICE_CLOSED",
        entityType: "Invoice",
        entityId: invoice._id.toString(),
        performedByEmployeeId: new Types.ObjectId(params.performedBy),
        after: { payment: payment[0].toObject() },
      });

      if (invoice.workOrderId) {
        const wo = await this.workOrderModel.findByIdAndUpdate(
          invoice.workOrderId,
          { status: WorkOrderStatus.CLOSED },
          { new: true, session }
        );
        if (wo) {
          await this.audit.record({
            actionType: "WORK_ORDER_STATUS_UPDATE",
            entityType: "WorkOrder",
            entityId: wo._id.toString(),
            performedByEmployeeId: new Types.ObjectId(params.performedBy),
            after: { status: WorkOrderStatus.CLOSED, reason: "Invoice closed" },
          });
        }
      }

      await session.commitTransaction();
      return { invoice, payment: payment[0] };
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
            status: InvoiceStatus.CLOSED,
            idempotencyKey: payload.idempotencyKey,
          },
        ],
        { session }
      );
      const payment = await this.paymentModel.create(
        [
          {
            invoiceId: invoice[0]._id,
            method: payload.payment.method,
            amount: this.decimalFromNumber(payload.payment.amount),
          },
        ],
        { session }
      );
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
}
