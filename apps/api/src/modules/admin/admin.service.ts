import { ForbiddenException, Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import {
  AuditLog,
  Customer,
  Expense,
  Payable,
  Invoice,
  InventoryTransaction,
  Payment,
  Part,
  TimeLog,
  Vehicle,
  WorkOrder,
} from "../../schemas";
import { AuthUser } from "../../common/decorators/current-user.decorator";

@Injectable()
export class AdminService {
  constructor(
    @InjectModel(Customer.name) private customerModel: Model<Customer>,
    @InjectModel(Vehicle.name) private vehicleModel: Model<Vehicle>,
    @InjectModel(WorkOrder.name) private workOrderModel: Model<WorkOrder>,
    @InjectModel(TimeLog.name) private timeLogModel: Model<TimeLog>,
    @InjectModel(InventoryTransaction.name)
    private trxModel: Model<InventoryTransaction>,
    @InjectModel(Invoice.name) private invoiceModel: Model<Invoice>,
    @InjectModel(Payment.name) private paymentModel: Model<Payment>,
    @InjectModel(Expense.name) private expenseModel: Model<Expense>,
    @InjectModel(Payable.name) private payableModel: Model<Payable>,
    @InjectModel(Part.name) private partModel: Model<Part>,
    @InjectModel(AuditLog.name) private auditLogModel: Model<AuditLog>
  ) {}

  async purge(user: AuthUser) {
    if (user?.role !== "OWNER_ADMIN") {
      throw new ForbiddenException("Only OWNER_ADMIN can purge data");
    }

    const [customers, vehicles, workOrders, timeLogs, trx, invoices, payments, expenses, payables, parts, audits] =
      await Promise.all([
        this.customerModel.deleteMany({}),
        this.vehicleModel.deleteMany({}),
        this.workOrderModel.deleteMany({}),
        this.timeLogModel.deleteMany({}),
        this.trxModel.deleteMany({}),
        this.invoiceModel.deleteMany({}),
        this.paymentModel.deleteMany({}),
        this.expenseModel.deleteMany({}),
        this.payableModel.deleteMany({}),
        this.partModel.deleteMany({}),
        this.auditLogModel.deleteMany({}),
      ]);

    return {
      message: "Purge completed. Users left intact.",
      deleted: {
        customers: customers.deletedCount || 0,
        vehicles: vehicles.deletedCount || 0,
        workOrders: workOrders.deletedCount || 0,
        timeLogs: timeLogs.deletedCount || 0,
        inventoryTransactions: trx.deletedCount || 0,
        invoices: invoices.deletedCount || 0,
        payments: payments.deletedCount || 0,
        expenses: expenses.deletedCount || 0,
        payables: payables.deletedCount || 0,
        parts: parts.deletedCount || 0,
        auditLogs: audits.deletedCount || 0,
      },
    };
  }
}
