import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import {
  Invoice,
  InvoiceSchema,
  Payment,
  PaymentSchema,
  WorkOrder,
  WorkOrderSchema,
  Part,
  PartSchema,
  InventoryTransaction,
  InventoryTransactionSchema
} from "../../schemas";
import { InvoicesService } from "./invoices.service";
import { InvoicesController } from "./invoices.controller";
import { AuditModule } from "../audit/audit.module";

@Module({
  imports: [
    AuditModule,
    MongooseModule.forFeature([
      { name: Invoice.name, schema: InvoiceSchema },
      { name: Payment.name, schema: PaymentSchema },
      { name: WorkOrder.name, schema: WorkOrderSchema },
      { name: Part.name, schema: PartSchema },
      { name: InventoryTransaction.name, schema: InventoryTransactionSchema }
    ])
  ],
  providers: [InvoicesService],
  controllers: [InvoicesController],
  exports: [InvoicesService]
})
export class InvoicesModule {}
