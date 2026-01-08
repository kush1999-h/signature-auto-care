import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import {
  Expense,
  ExpenseSchema,
  Part,
  PartSchema,
  InventoryTransaction,
  InventoryTransactionSchema,
  Payable,
  PayableSchema
} from "../../schemas";
import { PartsService } from "./parts.service";
import { PartsController } from "./parts.controller";
import { AuditModule } from "../audit/audit.module";

@Module({
  imports: [
    AuditModule,
    MongooseModule.forFeature([
      { name: Part.name, schema: PartSchema },
      { name: InventoryTransaction.name, schema: InventoryTransactionSchema },
      { name: Expense.name, schema: ExpenseSchema },
      { name: Payable.name, schema: PayableSchema }
    ])
  ],
  providers: [PartsService],
  controllers: [PartsController],
  exports: [PartsService]
})
export class PartsModule {}
