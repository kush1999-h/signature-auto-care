import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { Expense, ExpenseSchema } from "../../schemas";
import { ExpensesService } from "./expenses.service";
import { ExpensesController } from "./expenses.controller";
import { AuditModule } from "../audit/audit.module";

@Module({
  imports: [AuditModule, MongooseModule.forFeature([{ name: Expense.name, schema: ExpenseSchema }])],
  providers: [ExpensesService],
  controllers: [ExpensesController],
  exports: [ExpensesService]
})
export class ExpensesModule {}
