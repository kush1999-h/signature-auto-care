import { Module, forwardRef } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import {
  WorkOrder,
  WorkOrderSchema,
  TimeLog,
  TimeLogSchema,
  Part,
  PartSchema,
  InventoryTransaction,
  InventoryTransactionSchema,
  Customer,
  CustomerSchema,
  Vehicle,
  VehicleSchema,
  User,
  UserSchema,
  Invoice,
  InvoiceSchema,
  Payment,
  PaymentSchema,
} from "../../schemas";
import { WorkOrdersService } from "./work-orders.service";
import { WorkOrdersController } from "./work-orders.controller";
import { PartsModule } from "../parts/parts.module";
import { AuditModule } from "../audit/audit.module";

@Module({
  imports: [
    AuditModule,
    forwardRef(() => PartsModule),
    MongooseModule.forFeature([
      { name: WorkOrder.name, schema: WorkOrderSchema },
      { name: TimeLog.name, schema: TimeLogSchema },
      { name: Part.name, schema: PartSchema },
      { name: InventoryTransaction.name, schema: InventoryTransactionSchema },
      { name: Customer.name, schema: CustomerSchema },
      { name: Vehicle.name, schema: VehicleSchema },
      { name: User.name, schema: UserSchema },
      { name: Invoice.name, schema: InvoiceSchema },
      { name: Payment.name, schema: PaymentSchema },
    ]),
  ],
  providers: [WorkOrdersService],
  controllers: [WorkOrdersController],
  exports: [WorkOrdersService],
})
export class WorkOrdersModule {}
