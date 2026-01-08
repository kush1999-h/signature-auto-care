import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import {
  Invoice,
  InvoiceSchema,
  Payment,
  PaymentSchema,
  Expense,
  ExpenseSchema,
  Payable,
  PayableSchema,
  InventoryTransaction,
  InventoryTransactionSchema
} from "../../schemas";
import { ReportsService } from "./reports.service";
import { ReportsController } from "./reports.controller";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Invoice.name, schema: InvoiceSchema },
      { name: Payment.name, schema: PaymentSchema },
      { name: Expense.name, schema: ExpenseSchema },
      { name: Payable.name, schema: PayableSchema },
      { name: InventoryTransaction.name, schema: InventoryTransactionSchema }
    ])
  ],
  providers: [ReportsService],
  controllers: [ReportsController]
})
export class ReportsModule {}
