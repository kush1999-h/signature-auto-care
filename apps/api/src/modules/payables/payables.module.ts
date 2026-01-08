import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { Expense, ExpenseSchema, Payable, PayableSchema } from "../../schemas";
import { AuditModule } from "../audit/audit.module";
import { PayablesController } from "./payables.controller";
import { PayablesService } from "./payables.service";

@Module({
  imports: [
    AuditModule,
    MongooseModule.forFeature([
      { name: Payable.name, schema: PayableSchema },
      { name: Expense.name, schema: ExpenseSchema }
    ])
  ],
  controllers: [PayablesController],
  providers: [PayablesService],
  exports: [PayablesService]
})
export class PayablesModule {}
