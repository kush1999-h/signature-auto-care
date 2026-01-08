import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { ConfigModule } from "@nestjs/config";
import { AuthModule } from "./modules/auth/auth.module";
import { UsersModule } from "./modules/users/users.module";
import { PartsModule } from "./modules/parts/parts.module";
import { WorkOrdersModule } from "./modules/work-orders/work-orders.module";
import { InvoicesModule } from "./modules/invoices/invoices.module";
import { ExpensesModule } from "./modules/expenses/expenses.module";
import { PayablesModule } from "./modules/payables/payables.module";
import { ReportsModule } from "./modules/reports/reports.module";
import { AuditModule } from "./modules/audit/audit.module";
import { CustomersModule } from "./modules/customers/customers.module";
import { AdminModule } from "./modules/admin/admin.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MongooseModule.forRootAsync({
      useFactory: () => ({
        uri: process.env.MONGO_URI || "mongodb://root:example@mongo:27017",
        dbName: process.env.MONGO_DB || "signature_auto_care",
        authSource: "admin"
      })
    }),
    AuthModule,
    UsersModule,
    CustomersModule,
    PartsModule,
    WorkOrdersModule,
    InvoicesModule,
    ExpensesModule,
    PayablesModule,
    ReportsModule,
    AuditModule,
    AdminModule
  ]
})
export class AppModule {}
