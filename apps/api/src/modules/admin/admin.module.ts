import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import {
  AuditLog,
  AuditLogSchema,
  Customer,
  CustomerSchema,
  Expense,
  ExpenseSchema,
  Payable,
  PayableSchema,
  Invoice,
  InvoiceSchema,
  InventoryTransaction,
  InventoryTransactionSchema,
  Payment,
  PaymentSchema,
  Part,
  PartSchema,
  TimeLog,
  TimeLogSchema,
  Vehicle,
  VehicleSchema,
  WorkOrder,
  WorkOrderSchema,
} from "../../schemas";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Customer.name, schema: CustomerSchema },
      { name: Vehicle.name, schema: VehicleSchema },
      { name: WorkOrder.name, schema: WorkOrderSchema },
      { name: TimeLog.name, schema: TimeLogSchema },
      { name: InventoryTransaction.name, schema: InventoryTransactionSchema },
      { name: Invoice.name, schema: InvoiceSchema },
      { name: Payment.name, schema: PaymentSchema },
      { name: Expense.name, schema: ExpenseSchema },
      { name: Payable.name, schema: PayableSchema },
      { name: Part.name, schema: PartSchema },
      { name: AuditLog.name, schema: AuditLogSchema },
    ]),
  ],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
