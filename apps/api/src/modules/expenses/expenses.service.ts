import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectConnection, InjectModel } from "@nestjs/mongoose";
import { Connection, Model, Types } from "mongoose";
import { Expense, ExpenseDocument } from "../../schemas";
import { AuditService } from "../audit/audit.service";

@Injectable()
export class ExpensesService {
  constructor(
    @InjectModel(Expense.name) private expenseModel: Model<ExpenseDocument>,
    @InjectConnection() private connection: Connection,
    private audit: AuditService
  ) {}

  async list() {
    return this.expenseModel.find({ isDeleted: { $ne: true } }).sort({ expenseDate: -1 }).exec();
  }

  async create(payload: Partial<Expense> & { performedBy?: string }) {
    const session = await this.connection.startSession();
    session.startTransaction();
    try {
      const [exp] = await this.expenseModel.create([payload], { session });
      if (payload.performedBy) {
        await this.audit.record({
          actionType: "EXPENSE_CREATE",
          entityType: "Expense",
          entityId: exp._id.toString(),
          performedByEmployeeId: new Types.ObjectId(payload.performedBy),
          after: exp.toObject()
        });
      }
      await session.commitTransaction();
      return exp;
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      session.endSession();
    }
  }

  async update(id: string, payload: Partial<Expense> & { performedBy?: string }) {
    const session = await this.connection.startSession();
    session.startTransaction();
    try {
      const before = await this.expenseModel.findById(id).session(session);
      const exp = await this.expenseModel.findByIdAndUpdate(id, payload, { new: true, session });
      if (!exp) throw new NotFoundException("Expense not found");
      if (payload.performedBy) {
        await this.audit.record({
          actionType: "EXPENSE_UPDATE",
          entityType: "Expense",
          entityId: id,
          performedByEmployeeId: new Types.ObjectId(payload.performedBy),
          before: before?.toObject(),
          after: exp.toObject()
        });
      }
      await session.commitTransaction();
      return exp;
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      session.endSession();
    }
  }

  async softDelete(id: string, performedBy: string) {
    const exp = await this.expenseModel.findByIdAndUpdate(id, { isDeleted: true }, { new: true });
    if (!exp) throw new NotFoundException("Expense not found");
    await this.audit.record({
      actionType: "EXPENSE_DELETE",
      entityType: "Expense",
      entityId: id,
      performedByEmployeeId: new Types.ObjectId(performedBy)
    });
    return { success: true };
  }
}
