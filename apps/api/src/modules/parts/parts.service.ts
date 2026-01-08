import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectConnection, InjectModel } from "@nestjs/mongoose";
import { Connection, Model, Types } from "mongoose";
import { InventoryReferenceType, InventoryTransactionType } from "@signature-auto-care/shared";
import { Expense, ExpenseDocument, InventoryTransaction, Part, Payable, PayableDocument } from "../../schemas";
import { AuditService } from "../audit/audit.service";
import { InsufficientStockException } from "../../common/exceptions/insufficient-stock.exception";

type PartPayload = Omit<Part, "purchasePrice" | "sellingPrice" | "avgCost"> & {
  purchasePrice?: number | Types.Decimal128;
  sellingPrice?: number | Types.Decimal128;
  avgCost?: number | Types.Decimal128;
};
type PartAuditMeta = {
  performedByEmployeeId?: string;
  performedByName?: string;
  performedByRole?: string;
};
type PartUpdatePayload = Partial<PartPayload> & PartAuditMeta;

@Injectable()
export class PartsService {
  constructor(
    @InjectModel(Part.name) private partModel: Model<Part>,
    @InjectModel(InventoryTransaction.name) private trxModel: Model<InventoryTransaction>,
    @InjectModel(Expense.name) private expenseModel: Model<ExpenseDocument>,
    @InjectModel(Payable.name) private payableModel: Model<PayableDocument>,
    @InjectConnection() private connection: Connection,
    private audit: AuditService
  ) {}

  private decimalFromNumber(val: number) {
    return Types.Decimal128.fromString((val || 0).toString());
  }

  private decimalToNumber(val?: Types.Decimal128 | number | null) {
    if (!val) return 0;
    if (typeof val === "number") return val;
    return parseFloat(val.toString());
  }

  private async findExistingByIdempotency(key?: string) {
    if (!key) return null;
    return this.trxModel.findOne({ idempotencyKey: key });
  }

  private ensurePositiveInteger(value: number, field = "qty") {
    if (!Number.isInteger(value) || value <= 0) {
      throw new BadRequestException(`${field} must be a positive integer`);
    }
  }

  private normalizePriceFields(data: PartUpdatePayload) {
    const next: PartUpdatePayload = { ...data };
    if (typeof next.purchasePrice === "number") next.purchasePrice = this.decimalFromNumber(next.purchasePrice);
    if (typeof next.sellingPrice === "number") next.sellingPrice = this.decimalFromNumber(next.sellingPrice);
    if (typeof next.avgCost === "number") next.avgCost = this.decimalFromNumber(next.avgCost);
    return next;
  }

  async list(query: { search?: string; page?: number; limit?: number } = {}) {
    const { search = "", page = 1, limit = 200 } = query;
    const safeLimit = Math.min(Math.max(Number(limit) || 0, 1), 500);
    const pageNum = Math.max(Number(page) || 1, 1);
    const filter = search
      ? {
          $or: [
            { partName: { $regex: search, $options: "i" } },
            { sku: { $regex: search, $options: "i" } },
            { barcode: { $regex: search, $options: "i" } }
          ]
        }
      : {};
    const items = await this.partModel
      .find(filter)
      .skip((pageNum - 1) * safeLimit)
      .limit(safeLimit)
      .exec();
    const total = await this.partModel.countDocuments(filter);
    return { items, total, page: pageNum, limit: safeLimit };
  }

  async lowStock() {
    return this.partModel.find({ reorderLevel: { $exists: true, $ne: null }, $expr: { $lt: ["$onHandQty", "$reorderLevel"] } });
  }

  async create(data: PartUpdatePayload) {
    const payload = this.normalizePriceFields(data);
    const part = await this.partModel.create(payload);
    if (data.performedByEmployeeId) {
      await this.audit.record({
        actionType: "PART_CREATED",
        entityType: "Part",
        entityId: part._id.toString(),
        performedByEmployeeId: new Types.ObjectId(String(data.performedByEmployeeId)),
        performedByName: data.performedByName,
        performedByRole: data.performedByRole,
        after: part.toObject()
      });
    }
    return part;
  }

  async update(id: string, data: PartUpdatePayload) {
    const payload = this.normalizePriceFields(data);
    const before = await this.partModel.findById(id);
    const part = await this.partModel.findByIdAndUpdate(id, payload, { new: true });
    if (!part) throw new NotFoundException("Part not found");
    if (data.performedByEmployeeId) {
      await this.audit.record({
        actionType: "PART_UPDATED",
        entityType: "Part",
        entityId: part._id.toString(),
        performedByEmployeeId: new Types.ObjectId(String(data.performedByEmployeeId)),
        performedByName: data.performedByName,
        performedByRole: data.performedByRole,
        before: before?.toObject(),
        after: part.toObject()
      });
    }
    return part;
  }

  async receiveInventory(payload: {
    partId: string;
    qty: number;
    unitCost: number;
    sellingPrice?: number;
    paymentMethod?: string;
    vendorName?: string;
    notes?: string;
    performedBy: string;
    performedByName?: string;
    performedByRole?: string;
    idempotencyKey?: string;
  }) {
    const existing = await this.findExistingByIdempotency(payload.idempotencyKey);
    if (existing) {
      const part = await this.partModel.findById(existing.partId);
      return { part, transaction: existing };
    }

    this.ensurePositiveInteger(payload.qty);
    const session = await this.connection.startSession();
    session.startTransaction();
    try {
      const part = await this.partModel.findById(payload.partId).session(session);
      if (!part) throw new NotFoundException("Part not found");

      const paymentMethod = payload.paymentMethod?.toUpperCase();
      if (!paymentMethod || !["CASH", "CREDIT"].includes(paymentMethod)) {
        throw new BadRequestException("paymentMethod must be CASH or CREDIT");
      }

      const currentQty = part.onHandQty || 0;
      const currentAvg = this.decimalToNumber(part.avgCost);
      const qty = payload.qty;
      const unitCostNum = Number(payload.unitCost);
      if (!Number.isFinite(unitCostNum) || unitCostNum < 0) {
        throw new BadRequestException("unitCost must be zero or higher");
      }
      const sellingPriceNum =
        payload.sellingPrice !== undefined && payload.sellingPrice !== null
          ? Number(payload.sellingPrice)
          : undefined;
      const newQty = currentQty + qty;
      const newAvg = newQty === 0 ? 0 : (currentAvg * currentQty + unitCostNum * qty) / newQty;

      const updated = await this.partModel.findByIdAndUpdate(
        part._id,
        {
          $inc: { onHandQty: qty },
          $set: {
            avgCost: this.decimalFromNumber(newAvg),
            purchasePrice: this.decimalFromNumber(unitCostNum),
            ...(sellingPriceNum !== undefined
              ? { sellingPrice: this.decimalFromNumber(sellingPriceNum) }
              : {})
          }
        },
        { new: true, session }
      );

      const trx = await this.trxModel.create(
        [
          {
            type: InventoryTransactionType.RECEIVE,
            partId: part._id,
            qtyChange: payload.qty,
            unitCost: this.decimalFromNumber(unitCostNum),
            unitPrice:
              sellingPriceNum !== undefined
                ? this.decimalFromNumber(sellingPriceNum)
                : undefined,
            paymentMethod,
            vendorName: payload.vendorName,
            referenceType: InventoryReferenceType.PURCHASE,
            performedByEmployeeId: new Types.ObjectId(payload.performedBy),
            performedByName: payload.performedByName,
            performedByRole: payload.performedByRole,
            notes: payload.notes,
            idempotencyKey: payload.idempotencyKey
          }
        ],
        { session }
      );

      let expenseId: string | undefined;
      let payableId: string | undefined;
      if (paymentMethod === "CASH") {
        const totalCost = unitCostNum * qty;
        const noteParts = [
          `Part: ${part.partName}`,
          `SKU: ${part.sku}`,
          `Qty: ${qty}`,
          `Unit: ${unitCostNum.toFixed(2)}`,
          payload.vendorName ? `Vendor: ${payload.vendorName}` : null,
          payload.performedByName
            ? `Purchased by: ${payload.performedByName}${payload.performedByRole ? ` (${payload.performedByRole})` : ""}`
            : null
        ].filter(Boolean);
        const [expense] = await this.expenseModel.create(
          [
            {
              category: "Supplies",
              amount: this.decimalFromNumber(totalCost),
              expenseDate: new Date(),
              note: noteParts.join(" | ")
            }
          ],
          { session }
        );
        expenseId = expense._id.toString();
        await this.audit.record({
          actionType: "EXPENSE_CREATE",
          entityType: "Expense",
          entityId: expenseId,
          performedByEmployeeId: new Types.ObjectId(payload.performedBy),
          performedByName: payload.performedByName,
          performedByRole: payload.performedByRole,
          after: expense.toObject()
        });
      }

      if (paymentMethod === "CREDIT") {
        const totalCost = unitCostNum * qty;
        const noteParts = [
          `Part: ${part.partName}`,
          `SKU: ${part.sku}`,
          `Qty: ${qty}`,
          `Unit: ${unitCostNum.toFixed(2)}`,
          payload.vendorName ? `Vendor: ${payload.vendorName}` : null,
          payload.performedByName
            ? `Purchased by: ${payload.performedByName}${payload.performedByRole ? ` (${payload.performedByRole})` : ""}`
            : null
        ].filter(Boolean);
        const [payable] = await this.payableModel.create(
          [
            {
              category: "Supplies",
              amount: this.decimalFromNumber(totalCost),
              purchaseDate: new Date(),
              status: "OPEN",
              partId: part._id,
              transactionId: trx[0]._id,
              vendorName: payload.vendorName,
              qty,
              unitCost: this.decimalFromNumber(unitCostNum),
              createdByEmployeeId: new Types.ObjectId(payload.performedBy),
              createdByName: payload.performedByName,
              createdByRole: payload.performedByRole,
              note: noteParts.join(" | ")
            }
          ],
          { session }
        );
        payableId = payable._id.toString();
        await this.audit.record({
          actionType: "PAYABLE_CREATE",
          entityType: "Payable",
          entityId: payableId,
          performedByEmployeeId: new Types.ObjectId(payload.performedBy),
          performedByName: payload.performedByName,
          performedByRole: payload.performedByRole,
          after: payable.toObject()
        });
      }

      await this.audit.record({
        actionType: "INVENTORY_RECEIVE",
        entityType: "Part",
        entityId: part._id.toString(),
        performedByEmployeeId: new Types.ObjectId(payload.performedBy),
        performedByName: payload.performedByName,
        performedByRole: payload.performedByRole,
        after: {
          qty: payload.qty,
          unitCost: payload.unitCost,
          paymentMethod,
          vendorName: payload.vendorName,
          expenseId,
          payableId,
          ...(sellingPriceNum !== undefined ? { sellingPrice: sellingPriceNum } : {})
        }
      });

      await session.commitTransaction();
      return { part: updated, transaction: trx[0] };
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      session.endSession();
    }
  }

  async adjustInventory(payload: {
    partId: string;
    qtyChange: number;
    reason: string;
    performedBy: string;
    performedByName?: string;
    performedByRole?: string;
    idempotencyKey?: string;
  }) {
    if (!Number.isInteger(payload.qtyChange) || payload.qtyChange === 0) {
      throw new BadRequestException("qtyChange must be a non-zero integer");
    }
    const existing = await this.findExistingByIdempotency(payload.idempotencyKey);
    if (existing) {
      const part = await this.partModel.findById(existing.partId);
      return { part, transaction: existing };
    }
    const session = await this.connection.startSession();
    session.startTransaction();
    try {
      const part = await this.partModel
        .findOneAndUpdate(
          payload.qtyChange < 0
            ? { _id: payload.partId, $expr: { $gte: [{ $ifNull: ["$onHandQty", 0] }, Math.abs(payload.qtyChange)] } } // guard against missing onHand
            : { _id: payload.partId },
          { $inc: { onHandQty: payload.qtyChange } },
          { new: true, session }
        )
        .session(session);
      if (!part) throw new InsufficientStockException();

      const unitCost = this.decimalToNumber(part.avgCost);
      const trx = await this.trxModel.create(
        [
          {
            type: InventoryTransactionType.ADJUSTMENT,
            partId: part._id,
            qtyChange: payload.qtyChange,
            unitCost: this.decimalFromNumber(unitCost),
            referenceType: InventoryReferenceType.ADJUSTMENT,
            performedByEmployeeId: new Types.ObjectId(payload.performedBy),
            notes: payload.reason,
            idempotencyKey: payload.idempotencyKey
          }
        ],
        { session }
      );

      await this.audit.record({
        actionType: "INVENTORY_ADJUST",
        entityType: "Part",
        entityId: part._id.toString(),
        performedByEmployeeId: new Types.ObjectId(payload.performedBy),
        performedByName: payload.performedByName,
        performedByRole: payload.performedByRole,
        after: { qtyChange: payload.qtyChange, reason: payload.reason }
      });

      await session.commitTransaction();
      return { part, transaction: trx[0] };
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      session.endSession();
    }
  }

  async reserveStock(payload: {
    partId: string;
    workOrderId: string;
    qty: number;
    performedBy: string;
  }) {
    this.ensurePositiveInteger(payload.qty);
    const part = await this.partModel.findOneAndUpdate(
      {
        _id: payload.partId,
        $expr: {
          $gte: [
            {
              $subtract: [{ $ifNull: ["$onHandQty", 0] }, { $ifNull: ["$reservedQty", 0] }]
            },
            payload.qty
          ]
        }
      },
      { $inc: { reservedQty: payload.qty } },
      { new: true }
    );
    if (!part) throw new InsufficientStockException();
    await this.audit.record({
      actionType: "INVENTORY_RESERVE",
      entityType: "Part",
      entityId: part._id.toString(),
      performedByEmployeeId: new Types.ObjectId(payload.performedBy),
      after: { workOrderId: payload.workOrderId, qty: payload.qty }
    });
    return part;
  }

  async releaseReserved(payload: { partId: string; workOrderId: string; qty: number; performedBy: string }) {
    this.ensurePositiveInteger(payload.qty);
    const part = await this.partModel.findOneAndUpdate(
      {
        _id: payload.partId,
        $expr: {
          $gte: [{ $ifNull: ["$reservedQty", 0] }, payload.qty]
        }
      },
      { $inc: { reservedQty: -payload.qty } },
      { new: true }
    );
    if (!part) throw new InsufficientStockException("Insufficient reserved stock to release");
    await this.audit.record({
      actionType: "INVENTORY_RELEASE",
      entityType: "Part",
      entityId: part._id.toString(),
      performedByEmployeeId: new Types.ObjectId(payload.performedBy),
      after: { workOrderId: payload.workOrderId, qty: payload.qty }
    });
    return part;
  }

  async reverseTransaction(params: { transactionId: string; performedBy: string; idempotencyKey?: string }) {
    const existing = await this.findExistingByIdempotency(params.idempotencyKey);
    if (existing) {
      const part = await this.partModel.findById(existing.partId);
      return { part, transaction: existing };
    }
    const session = await this.connection.startSession();
    session.startTransaction();
    try {
      const original = await this.trxModel.findById(params.transactionId).session(session);
      if (!original) throw new NotFoundException("Transaction not found");

      const reverseQty = -original.qtyChange;
      const filter =
        reverseQty < 0
          ? { _id: original.partId, onHandQty: { $gte: Math.abs(reverseQty) } }
          : { _id: original.partId };
      const part = await this.partModel.findOneAndUpdate(filter, { $inc: { onHandQty: reverseQty } }, { new: true, session });
      if (!part) throw new InsufficientStockException();

      const reversal = await this.trxModel.create(
        [
          {
            type: InventoryTransactionType.RETURN,
            partId: original.partId,
            qtyChange: reverseQty,
            unitCost: original.unitCost,
            unitPrice: original.unitPrice,
            referenceType: original.referenceType,
            referenceId: original.referenceId,
            performedByEmployeeId: new Types.ObjectId(params.performedBy),
            reversesTransactionId: original._id,
            idempotencyKey: params.idempotencyKey,
            notes: `Reversal of ${original._id.toString()}`
          }
        ],
        { session }
      );

      await this.audit.record({
        actionType: "INVENTORY_REVERSAL",
        entityType: "Part",
        entityId: part._id.toString(),
        performedByEmployeeId: new Types.ObjectId(params.performedBy),
        after: { reverses: original._id.toString(), qtyChange: reverseQty }
      });

      await session.commitTransaction();
      return { part, transaction: reversal[0] };
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      session.endSession();
    }
  }

  async listTransactions(
    params: {
      partId?: string;
      type?: string;
      paymentMethod?: string;
      from?: string;
      to?: string;
      limit?: number;
    } = {}
  ) {
    const filter: Record<string, unknown> = {};
    if (params.partId) filter.partId = params.partId;
    if (params.type) filter.type = params.type;
    if (params.paymentMethod) filter.paymentMethod = params.paymentMethod.toUpperCase();
    if (params.from || params.to) {
      const range: Record<string, Date> = {};
      if (params.from) range.$gte = new Date(params.from);
      if (params.to) range.$lte = new Date(params.to);
      filter.createdAt = range;
    }
    const limit = params.limit || 100;
    return this.trxModel.find(filter).sort({ createdAt: -1 }).limit(limit).exec();
  }

  async findById(partId: string) {
    return this.partModel.findById(partId);
  }
}
