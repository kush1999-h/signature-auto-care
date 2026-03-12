import mongoose, { Connection } from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { Permissions } from "@signature-auto-care/shared";
import { WorkOrdersService } from "../src/modules/work-orders/work-orders.service";
import { AuditService } from "../src/modules/audit/audit.service";
import {
  WorkOrder,
  WorkOrderSchema,
  Part,
  PartSchema,
  Service,
  ServiceSchema,
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

describe("Work order invoice lifecycle", () => {
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
      connection.model(Service.name, ServiceSchema),
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

  test("closing a work order issues an invoice and keeps due open without auto payment", async () => {
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

    const closedWorkOrder = await connection.model(WorkOrder.name).findById(wo._id);
    expect(closedWorkOrder?.deliveredAt).toBeTruthy();

    const invoice = await connection
      .model(Invoice.name)
      .findOne({ workOrderId: wo._id });
    const payment = await connection.model(Payment.name).findOne({ invoiceId: invoice?._id });
    expect(invoice).toBeTruthy();
    expect(invoice?.customerId?.toString()).toBe(customerId.toString());
    expect(invoice?.vehicleId?.toString()).toBe(vehicleId.toString());

    const totals = invoice ? Number(invoice.total.toString()) : 0;
    expect(totals).toBeCloseTo(150 + 2 * 80 + 15);
    expect(invoice?.lineItems).toHaveLength(3); // labor + part + shop fee
    expect(invoice?.status).toBe("ISSUED");
    expect(Number(invoice?.outstandingAmount?.toString() || 0)).toBeCloseTo(totals);
    expect(payment).toBeNull();
  });

  test("owner admin can edit closed billing and refresh invoice totals", async () => {
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
      {
        userId,
        role: "OWNER_ADMIN",
        permissions: [Permissions.WORKORDERS_BILLING_EDIT],
      }
    );
    await service.updateStatus(wo._id.toString(), "Closed", {
      userId,
      role: "SERVICE_ADVISOR",
    });

    const closedWorkOrder = await connection.model(WorkOrder.name).findById(wo._id);
    expect(closedWorkOrder?.deliveredAt).toBeTruthy();

    const invoices = await connection
      .model(Invoice.name)
      .find({ workOrderId: wo._id });
    expect(invoices).toHaveLength(1);
    const totals = Number(invoices[0].total.toString());
    expect(totals).toBeCloseTo(200 + 2 * 60 + 50);
    expect(invoices[0].status).toBe("ISSUED");
  });

  test("advance reduces outstanding due without reducing invoice revenue total", async () => {
    const customerId = new mongoose.Types.ObjectId();
    const vehicleId = new mongoose.Types.ObjectId();
    const userId = new mongoose.Types.ObjectId().toString();

    const wo = await connection.model(WorkOrder.name).create({
      customerId,
      vehicleId,
      status: "In Progress",
      billableLaborAmount: mongoose.Types.Decimal128.fromString("500"),
      advanceAmount: mongoose.Types.Decimal128.fromString("200"),
    });

    await service.updateBilling(
      wo._id.toString(),
      {
        billableLaborAmount: 500,
        otherCharges: [{ name: "Extra", amount: 100 }],
      },
      {
        userId,
        role: "OPS_MANAGER",
        permissions: [Permissions.WORKORDERS_BILLING_EDIT],
      }
    );

    const invoice = await connection.model(Invoice.name).findOne({ workOrderId: wo._id });
    const payment = await connection.model(Payment.name).findOne({ invoiceId: invoice?._id });
    const refreshed = await connection.model(WorkOrder.name).findById(wo._id);

    expect(invoice).toBeTruthy();
    expect(Number(invoice?.total?.toString() || 0)).toBeCloseTo(600);
    expect(payment).toBeNull();
    expect(invoice?.status).toBe("DRAFT");
    expect(Number(invoice?.outstandingAmount?.toString() || 0)).toBeCloseTo(400);
    expect(Number(refreshed?.advanceAppliedAmount?.toString() || 0)).toBeCloseTo(200);
  });

  test("billing can issue invoice, take partial payment, and close with remaining due", async () => {
    const customerId = new mongoose.Types.ObjectId();
    const vehicleId = new mongoose.Types.ObjectId();
    const userId = new mongoose.Types.ObjectId().toString();

    const wo = await connection.model(WorkOrder.name).create({
      customerId,
      vehicleId,
      status: "In Progress",
      billableLaborAmount: mongoose.Types.Decimal128.fromString("500"),
      advanceAmount: mongoose.Types.Decimal128.fromString("100"),
    });

    await service.updateBilling(
      wo._id.toString(),
      {
        billableLaborAmount: 500,
        otherCharges: [{ name: "Extra", amount: 100 }],
        issueInvoice: true,
        paymentAmount: 200,
        paymentMethod: "CASH",
        closeWorkOrder: true,
      },
      {
        userId,
        role: "SERVICE_ADVISOR",
        permissions: [Permissions.WORKORDERS_BILLING_EDIT],
      }
    );

    const invoice = await connection.model(Invoice.name).findOne({ workOrderId: wo._id });
    const payments = await connection.model(Payment.name).find({ invoiceId: invoice?._id });
    const refreshed = await connection.model(WorkOrder.name).findById(wo._id);

    expect(refreshed?.status).toBe("Closed");
    expect(refreshed?.deliveredAt).toBeTruthy();
    expect(invoice?.status).toBe("PARTIALLY_PAID");
    expect(Number(invoice?.total?.toString() || 0)).toBeCloseTo(600);
    expect(Number(invoice?.totalPaid?.toString() || 0)).toBeCloseTo(200);
    expect(Number(invoice?.outstandingAmount?.toString() || 0)).toBeCloseTo(300);
    expect(payments).toHaveLength(1);
  });

  test("historical backfill can create paid closed invoice with optional cost affecting cogs inputs", async () => {
    const customerId = new mongoose.Types.ObjectId();
    const vehicleId = new mongoose.Types.ObjectId();
    const userId = new mongoose.Types.ObjectId().toString();

    const dateIn = "2026-01-05T00:00:00.000Z";
    const dateOut = "2026-01-06T00:00:00.000Z";

    const wo = await service.create(
      {
        customerId,
        vehicleId,
        complaint: "Legacy entry from paper register",
        isHistorical: true,
        dateIn,
        dateOut,
        status: "Closed",
        workOrderNumber: "LEGACY-001",
        historicalBillAmount: 5000,
        historicalCostAmount: 3200,
        historicalPaidAmount: 5000,
      } as any,
      {
        userId,
        role: "SERVICE_ADVISOR",
        permissions: [
          Permissions.WORKORDERS_CREATE,
          Permissions.WORKORDERS_CREATE_HISTORICAL,
          Permissions.WORKORDERS_BILLING_EDIT,
        ],
      } as any
    );

    const invoice = await connection.model(Invoice.name).findOne({ workOrderId: wo._id });
    const payment = await connection.model(Payment.name).findOne({ invoiceId: invoice?._id });
    const refreshed = await connection.model(WorkOrder.name).findById(wo._id);

    expect(refreshed?.status).toBe("Closed");
    expect(refreshed?.workOrderNumber).toBe("LEGACY-001");
    expect(refreshed?.isHistorical).toBe(true);
    expect(refreshed?.deliveredAt?.toISOString()).toBe(dateOut);
    expect(invoice).toBeTruthy();
    expect(Number(invoice?.total?.toString() || 0)).toBeCloseTo(5000);
    expect(Number(payment?.amount?.toString() || 0)).toBeCloseTo(5000);
    expect(invoice?.status).toBe("PAID");
    const otherLine = (invoice?.lineItems || []).find((li: any) => li.type === "OTHER");
    expect(otherLine).toBeTruthy();
    expect(Number(otherLine?.costAtTime?.toString() || 0)).toBeCloseTo(3200);
  });

  test("duplicate work order number is rejected", async () => {
    const customerId = new mongoose.Types.ObjectId();
    const vehicleId = new mongoose.Types.ObjectId();
    const userId = new mongoose.Types.ObjectId().toString();

    await service.create(
      {
        customerId,
        vehicleId,
        complaint: "First",
        workOrderNumber: "WO-MANUAL-1",
      } as any,
      {
        userId,
        role: "SERVICE_ADVISOR",
        permissions: [Permissions.WORKORDERS_CREATE],
      } as any
    );

    await expect(
      service.create(
        {
          customerId,
          vehicleId,
          complaint: "Second",
          workOrderNumber: "WO-MANUAL-1",
        } as any,
        {
          userId,
          role: "SERVICE_ADVISOR",
          permissions: [Permissions.WORKORDERS_CREATE],
        } as any
      )
    ).rejects.toThrow("Work order number already exists");
  });

  test("reopening a closed work order clears deliveredAt", async () => {
    const customerId = new mongoose.Types.ObjectId();
    const vehicleId = new mongoose.Types.ObjectId();
    const userId = new mongoose.Types.ObjectId().toString();

    const part = await connection.model(Part.name).create({
      partName: "Seal",
      sku: "SEA-1",
      purchasePrice: 10,
      sellingPrice: 20,
      avgCost: 12,
    });

    const wo = await connection.model(WorkOrder.name).create({
      customerId,
      vehicleId,
      status: "In Progress",
      billableLaborAmount: mongoose.Types.Decimal128.fromString("50"),
      partsUsed: [
        {
          partId: part._id,
          qty: 1,
          sellingPriceAtTime: part.sellingPrice,
          costAtTime: part.avgCost,
        },
      ],
    });

    await service.updateStatus(wo._id.toString(), "Closed", {
      userId,
      role: "SERVICE_ADVISOR",
    });

    let closedWorkOrder = await connection.model(WorkOrder.name).findById(wo._id);
    expect(closedWorkOrder?.deliveredAt).toBeTruthy();

    await service.updateStatus(wo._id.toString(), "In Progress", {
      userId,
      role: "SERVICE_ADVISOR",
    });

    closedWorkOrder = await connection.model(WorkOrder.name).findById(wo._id);
    expect(closedWorkOrder?.deliveredAt).toBeNull();
  });
});
