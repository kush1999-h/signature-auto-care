import mongoose, { Connection } from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { ReportsService } from "../src/modules/reports/reports.service";
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
  InventoryTransactionSchema,
} from "../src/schemas";
import { InvoiceStatus, InvoiceType } from "@signature-auto-care/shared";

jest.setTimeout(120000);

describe("ReportsService revenue coverage", () => {
  let mongo: MongoMemoryReplSet;
  let connection: Connection;
  let service: ReportsService;

  beforeAll(async () => {
    mongo = await MongoMemoryReplSet.create({
      replSet: { storageEngine: "wiredTiger" },
    });
    await mongo.waitUntilRunning();
    const conn = await mongoose.connect(mongo.getUri());
    connection = conn.connection;

    const invoiceModel = connection.model(Invoice.name, InvoiceSchema) as any;
    const paymentModel = connection.model(Payment.name, PaymentSchema) as any;
    const expenseModel = connection.model(Expense.name, ExpenseSchema) as any;
    const payableModel = connection.model(Payable.name, PayableSchema) as any;
    const trxModel = connection.model(
      InventoryTransaction.name,
      InventoryTransactionSchema
    ) as any;

    service = new ReportsService(
      invoiceModel,
      paymentModel,
      expenseModel,
      payableModel,
      trxModel
    );
  });

  beforeEach(async () => {
    await connection.db.dropDatabase();
  });

  afterAll(async () => {
    if (connection) {
      await connection.close();
    }
    if (mongo) {
      await mongo.stop();
    }
  });

  test("counts revenue from closed work order invoices even when invoice.total is stale", async () => {
    const invoiceModel = connection.model(Invoice.name);
    const decimal = mongoose.Types.Decimal128.fromString;

    await invoiceModel.create([
      {
        invoiceNumber: "INV-CS-1",
        type: InvoiceType.COUNTER_SALE,
        status: InvoiceStatus.CLOSED,
        lineItems: [
          {
            type: "PART",
            description: "Advics Front Brake Pad",
            quantity: 1,
            unitPrice: decimal("4200"),
            total: decimal("4200"),
            costAtTime: decimal("3800"),
          },
        ],
        subtotal: decimal("4200"),
        tax: decimal("0"),
        total: decimal("4200"),
      },
      {
        invoiceNumber: "INV-WO-1",
        type: InvoiceType.WORK_ORDER,
        status: InvoiceStatus.CLOSED,
        lineItems: [
          {
            type: "PART",
            description: "Advics Front Brake Pad",
            quantity: 1,
            unitPrice: decimal("4200"),
            total: decimal("4200"),
            costAtTime: decimal("3800"),
          },
          {
            type: "LABOR",
            description: "Brake labor",
            quantity: 1,
            unitPrice: decimal("300"),
            total: decimal("300"),
          },
        ],
        // Intentionally stale totals to mimic missing revenue in prod data
        subtotal: decimal("0"),
        tax: decimal("0"),
        total: decimal("0"),
      },
    ]);

    const report = await service.profitReport({});

    expect(report.revenue).toBeCloseTo(8700);
    expect(report.cogs).toBeCloseTo(7600);
    expect(report.grossProfit).toBeCloseTo(1100);
    expect(report.netProfit).toBeCloseTo(1100);
    expect(report.invoices).toHaveLength(2);
  });
});
