import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectConnection, InjectModel } from "@nestjs/mongoose";
import { Connection, Model, Types } from "mongoose";
import { Expense, ExpenseDocument, Payable, PayableDocument } from "../../schemas";
import { AuditService } from "../audit/audit.service";

type PayableUpdatePayload = Partial<Payable> & {
  performedBy?: string;
  performedByName?: string;
  performedByRole?: string;
};

@Injectable()
export class PayablesService {
  constructor(
    @InjectModel(Payable.name) private payableModel: Model<PayableDocument>,
    @InjectModel(Expense.name) private expenseModel: Model<ExpenseDocument>,
    @InjectConnection() private connection: Connection,
    private audit: AuditService
  ) {}

  private decimalFromNumber(val: number) {
    return Types.Decimal128.fromString((val || 0).toString());
  }

  async list(params: {
    status?: string;
    vendor?: string;
    partId?: string;
    from?: string;
    to?: string;
    limit?: number;
  } = {}) {
    const filter: Record<string, unknown> = {};
    if (params.status) filter.status = params.status.toUpperCase();
    if (params.vendor) filter.vendorName = { $regex: params.vendor, $options: "i" };
    if (params.partId) filter.partId = params.partId;
    if (params.from || params.to) {
      const range: Record<string, Date> = {};
      if (params.from) range.$gte = new Date(params.from);
      if (params.to) range.$lte = new Date(params.to);
      filter.purchaseDate = range;
    }
    const limit = Math.min(Math.max(params.limit || 200, 1), 1000);
    return this.payableModel.find(filter).sort({ purchaseDate: -1 }).limit(limit).exec();
  }

  async update(id: string, payload: PayableUpdatePayload) {
    const session = await this.connection.startSession();
    session.startTransaction();
    try {
      const before = await this.payableModel.findById(id).session(session);
      if (!before) throw new NotFoundException("Payable not found");
      const next: Partial<Payable> = { ...payload };
      if (typeof payload.amount === "number") next.amount = this.decimalFromNumber(payload.amount);
      if (typeof payload.unitCost === "number") next.unitCost = this.decimalFromNumber(payload.unitCost);
      if (payload.status) next.status = payload.status.toUpperCase();
      const previousStatus = typeof before.status === "string" ? before.status.toUpperCase() : "OPEN";
      const nextStatus = typeof next.status === "string" ? next.status.toUpperCase() : previousStatus;
      if (nextStatus === "PAID" && previousStatus !== "PAID") {
        next.paidAt = payload.paidAt ? new Date(payload.paidAt) : new Date();
      }
      const updated = await this.payableModel.findByIdAndUpdate(id, next, { new: true, session });
      if (!updated) throw new NotFoundException("Payable not found");

      let expenseId: string | undefined;
      if (nextStatus === "PAID" && previousStatus !== "PAID") {
        const amount = Number(updated.amount?.toString() || 0);
        const noteParts = [
          "Payable paid",
          updated.vendorName ? `Vendor: ${updated.vendorName}` : null,
          updated.note ? `Note: ${updated.note}` : null,
          `Payable: ${updated._id.toString()}`
        ].filter(Boolean);
        const [expense] = await this.expenseModel.create(
          [
            {
              category: updated.category || "Supplies",
              amount: this.decimalFromNumber(amount),
              expenseDate: updated.paidAt || new Date(),
              note: noteParts.join(" | ")
            }
          ],
          { session }
        );
        expenseId = expense._id.toString();
        if (payload.performedBy) {
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
      }

      if (payload.performedBy) {
        await this.audit.record({
          actionType: "PAYABLE_UPDATE",
          entityType: "Payable",
          entityId: id,
          performedByEmployeeId: new Types.ObjectId(payload.performedBy),
          performedByName: payload.performedByName,
          performedByRole: payload.performedByRole,
          before: before.toObject(),
          after: {
            ...updated.toObject(),
            ...(expenseId ? { expenseId } : {})
          }
        });
      }

      await session.commitTransaction();
      return updated;
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      session.endSession();
    }
  }
}
