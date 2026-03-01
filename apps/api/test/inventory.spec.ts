import mongoose, { Connection } from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { PartsService } from "../src/modules/parts/parts.service";
import { WorkOrdersService } from "../src/modules/work-orders/work-orders.service";
import { AuditService } from "../src/modules/audit/audit.service";
import {
  Part,
  PartSchema,
  Service,
  ServiceSchema,
  InventoryTransaction,
  InventoryTransactionSchema,
  WorkOrder,
  WorkOrderSchema,
  TimeLog,
  TimeLogSchema,
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
  Payable,
  PayableSchema,
} from "../src/schemas";
import { InsufficientStockException } from "../src/common/exceptions/insufficient-stock.exception";
import { AuditLog, AuditLogSchema } from "../src/schemas/audit-log.schema";

describe("Inventory safety", () => {
  let mongo: MongoMemoryReplSet;
  let connection: Connection;
  let partsService: PartsService;
  let workOrdersService: WorkOrdersService;

  const isTransientWriteError = (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    return message.includes("Unable to acquire IX lock") || message.includes("WriteConflict");
  };

  const issueWithRetry = async (payload: Parameters<WorkOrdersService["issuePart"]>[0]) => {
    let lastError: unknown;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        return await workOrdersService.issuePart(payload);
      } catch (err) {
        if (isTransientWriteError(err) && attempt < 7) {
          lastError = err;
          await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
          continue;
        }
        throw err;
      }
    }
    throw lastError;
  };

  const receiveWithRetry = async (
    payload: Parameters<PartsService["receiveInventory"]>[0]
  ) => {
    let lastError: unknown;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        return await partsService.receiveInventory(payload);
      } catch (err) {
        if (isTransientWriteError(err) && attempt < 7) {
          lastError = err;
          await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
          continue;
        }
        throw err;
      }
    }
    throw lastError;
  };

  beforeAll(async () => {
    mongo = await MongoMemoryReplSet.create({
      replSet: { storageEngine: "wiredTiger" },
    });
    await mongo.waitUntilRunning();
    const conn = await mongoose.connect(mongo.getUri());
    connection = conn.connection;

    const partModel = connection.model(Part.name, PartSchema);
    const trxModel = connection.model(
      InventoryTransaction.name,
      InventoryTransactionSchema
    );
    const workOrderModel = connection.model(WorkOrder.name, WorkOrderSchema);
    const timeLogModel = connection.model(TimeLog.name, TimeLogSchema);
    const customerModel = connection.model(Customer.name, CustomerSchema);
    const vehicleModel = connection.model(Vehicle.name, VehicleSchema);
    const userModel = connection.model(User.name, UserSchema);
    const serviceModel = connection.model(Service.name, ServiceSchema);
    const invoiceModel = connection.model(Invoice.name, InvoiceSchema);
    const paymentModel = connection.model(Payment.name, PaymentSchema);
    const payableModel = connection.model(Payable.name, PayableSchema) as any;

    const auditService = new AuditService(
      connection.model(AuditLog.name, AuditLogSchema)
    );
    partsService = new PartsService(
      partModel,
      trxModel,
      payableModel,
      connection,
      auditService as any
    );
    workOrdersService = new WorkOrdersService(
      workOrderModel,
      timeLogModel,
      partModel,
      serviceModel,
      trxModel,
      customerModel,
      vehicleModel,
      userModel,
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
    await connection.close();
    await mongo.stop();
  });

  test("repeated issue attempts only decrement once", async () => {
    const part = await partsService.create({
      partName: "Oil Filter",
      sku: "OF-1",
      purchasePrice: 5,
      sellingPrice: 10,
    });
    await receiveWithRetry({
      partId: part._id.toString(),
      qty: 5,
      unitCost: 5,
      paymentMethod: "CASH",
      performedBy: new mongoose.Types.ObjectId().toString(),
    });
    const wo = await connection
      .model(WorkOrder.name)
      .create({
        customerId: new mongoose.Types.ObjectId(),
        vehicleId: new mongoose.Types.ObjectId(),
        status: "Scheduled",
      });

    await issueWithRetry({
      workOrderId: wo._id.toString(),
      partId: part._id.toString(),
      qty: 5,
      performedBy: new mongoose.Types.ObjectId().toString(),
    });
    await expect(
      issueWithRetry({
        workOrderId: wo._id.toString(),
        partId: part._id.toString(),
        qty: 5,
        performedBy: new mongoose.Types.ObjectId().toString(),
      })
    ).rejects.toBeInstanceOf(InsufficientStockException);
    const updatedPart = await connection.model(Part.name).findById(part._id);
    expect(updatedPart?.onHandQty).toBe(0);
  });

  test("idempotent receive does not double apply", async () => {
    const part = await partsService.create({
      partName: "Brake Pad",
      sku: "BP-1",
      purchasePrice: 20,
      sellingPrice: 40,
    });
    const key = "receive-key";
    const first = await receiveWithRetry({
      partId: part._id.toString(),
      qty: 10,
      unitCost: 20,
      paymentMethod: "CASH",
      performedBy: new mongoose.Types.ObjectId().toString(),
      idempotencyKey: key,
    });
    const second = await receiveWithRetry({
      partId: part._id.toString(),
      qty: 10,
      unitCost: 20,
      paymentMethod: "CASH",
      performedBy: new mongoose.Types.ObjectId().toString(),
      idempotencyKey: key,
    });
    expect(second.transaction._id.toString()).toEqual(
      first.transaction._id.toString()
    );
    const updated = await connection.model(Part.name).findById(part._id);
    expect(updated?.onHandQty).toBe(10);
  });

  test("reversal restores stock and links transactions", async () => {
    const part = await partsService.create({
      partName: "Coolant",
      sku: "CL-1",
      purchasePrice: 8,
      sellingPrice: 16,
    });
    const receive = await receiveWithRetry({
      partId: part._id.toString(),
      qty: 5,
      unitCost: 8,
      paymentMethod: "CASH",
      performedBy: new mongoose.Types.ObjectId().toString(),
    });
    const issue = await workOrdersService.issuePart({
      workOrderId: (
        await connection
          .model(WorkOrder.name)
          .create({
            customerId: new mongoose.Types.ObjectId(),
            vehicleId: new mongoose.Types.ObjectId(),
            status: "Scheduled",
          })
      )._id.toString(),
      partId: part._id.toString(),
      qty: 2,
      performedBy: new mongoose.Types.ObjectId().toString(),
    });

    const reversal = await partsService.reverseTransaction({
      transactionId: issue.transaction._id.toString(),
      performedBy: new mongoose.Types.ObjectId().toString(),
    });

    expect(reversal.transaction.reversesTransactionId?.toString()).toEqual(
      issue.transaction._id.toString()
    );
    const updated = await connection.model(Part.name).findById(part._id);
    expect(updated?.onHandQty).toBe(5); // back to post-receive level
    expect(receive.transaction).toBeDefined();
  });
});
