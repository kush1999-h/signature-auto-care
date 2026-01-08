import mongoose, { Connection } from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { WorkOrdersService } from "../src/modules/work-orders/work-orders.service";
import { AuditService } from "../src/modules/audit/audit.service";
import {
  WorkOrder,
  WorkOrderSchema,
  Part,
  PartSchema,
  Invoice,
  InvoiceSchema,
  TimeLog,
  TimeLogSchema,
  InventoryTransaction,
  InventoryTransactionSchema,
  Customer,
  CustomerSchema,
  Vehicle,
  VehicleSchema,
  User,
  UserSchema,
  Payment,
  PaymentSchema,
} from "../src/schemas";
import { AuditLog, AuditLogSchema } from "../src/schemas/audit-log.schema";

jest.setTimeout(120000);

describe("Work order close -> invoice generation", () => {
  let mongo: MongoMemoryReplSet;
  let connection: Connection;
  let service: WorkOrdersService;

  beforeAll(async () => {
    mongo = await MongoMemoryReplSet.create({
      replSet: { storageEngine: "wiredTiger" },
    });
    await mongo.waitUntilRunning();
    const conn = await mongoose.connect(mongo.getUri());
    connection = conn.connection;

    const workOrderModel = connection.model(WorkOrder.name, WorkOrderSchema);
    const partModel = connection.model(Part.name, PartSchema);
    const invoiceModel = connection.model(Invoice.name, InvoiceSchema);
    const paymentModel = connection.model(Payment.name, PaymentSchema);
    const auditService = new AuditService(
      connection.model(AuditLog.name, AuditLogSchema)
    );

    service = new WorkOrdersService(
      workOrderModel,
      connection.model(TimeLog.name, TimeLogSchema),
      partModel,
      connection.model(InventoryTransaction.name, InventoryTransactionSchema),
      connection.model(Customer.name, CustomerSchema),
      connection.model(Vehicle.name, VehicleSchema),
      connection.model(User.name, UserSchema),
      invoiceModel,
      paymentModel,
      connection,
      auditService as any
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

  test("closing a work order bills labor, parts, and extra charges to an invoice under the customer", async () => {
    const customerId = new mongoose.Types.ObjectId();
    const vehicleId = new mongoose.Types.ObjectId();
    const userId = new mongoose.Types.ObjectId().toString();

    const part = await connection.model(Part.name).create({
      partName: "Rotor",
      sku: "ROT-1",
      purchasePrice: 40,
      sellingPrice: 80,
      avgCost: 45,
    });

    const wo = await connection.model(WorkOrder.name).create({
      customerId,
      vehicleId,
      status: "In Progress",
      billableLaborAmount: mongoose.Types.Decimal128.fromString("150"),
      partsUsed: [
        {
          partId: part._id,
          qty: 2,
          sellingPriceAtTime: part.sellingPrice,
          costAtTime: part.avgCost,
        },
      ],
      otherCharges: [
        {
          name: "Shop Supplies",
          amount: mongoose.Types.Decimal128.fromString("15"),
        },
      ],
    });

    await service.updateStatus(wo._id.toString(), "Closed", {
      userId,
      role: "SERVICE_ADVISOR",
    });

    const invoice = await connection
      .model(Invoice.name)
      .findOne({ workOrderId: wo._id });
    expect(invoice).toBeTruthy();
    expect(invoice?.customerId?.toString()).toBe(customerId.toString());
    expect(invoice?.vehicleId?.toString()).toBe(vehicleId.toString());

    const totals = invoice ? Number(invoice.total.toString()) : 0;
    expect(totals).toBeCloseTo(150 + 2 * 80 + 15);
    expect(invoice?.lineItems).toHaveLength(3); // labor + part + shop fee
  });

  test("closing a work order twice keeps one invoice and refreshes totals", async () => {
    const customerId = new mongoose.Types.ObjectId();
    const vehicleId = new mongoose.Types.ObjectId();
    const userId = new mongoose.Types.ObjectId().toString();

    const part = await connection.model(Part.name).create({
      partName: "Bumper",
      sku: "BMP-1",
      purchasePrice: 25,
      sellingPrice: 60,
      avgCost: 30,
    });

    const wo = await connection.model(WorkOrder.name).create({
      customerId,
      vehicleId,
      status: "In Progress",
      billableLaborAmount: mongoose.Types.Decimal128.fromString("100"),
      partsUsed: [
        {
          partId: part._id,
          qty: 2,
          sellingPriceAtTime: part.sellingPrice,
          costAtTime: part.avgCost,
        },
      ],
    });

    await service.updateStatus(wo._id.toString(), "Closed", {
      userId,
      role: "SERVICE_ADVISOR",
    });
    await service.updateBilling(
      wo._id.toString(),
      {
        billableLaborAmount: 200,
        otherCharges: [{ name: "Blend", amount: 50 }],
      },
      { userId, role: "OPS_MANAGER" }
    );
    await service.updateStatus(wo._id.toString(), "Closed", {
      userId,
      role: "SERVICE_ADVISOR",
    });

    const invoices = await connection
      .model(Invoice.name)
      .find({ workOrderId: wo._id });
    expect(invoices).toHaveLength(1);
    const totals = Number(invoices[0].total.toString());
    expect(totals).toBeCloseTo(200 + 2 * 60 + 50);
  });
});
