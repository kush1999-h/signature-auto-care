import mongoose, { Connection } from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { Permissions } from "@signature-auto-care/shared";
import { PermissionsGuard } from "../src/common/guards/permissions.guard";
import { PERMISSIONS_ANY_KEY } from "../src/common/decorators/permissions-any.decorator";
import { PERMISSIONS_KEY } from "../src/common/decorators/permissions.decorator";
import { ForbiddenException } from "@nestjs/common";
import { WorkOrdersService } from "../src/modules/work-orders/work-orders.service";
import {
  WorkOrder,
  WorkOrderSchema,
  TimeLog,
  TimeLogSchema,
  Part,
  PartSchema,
  InventoryTransaction,
  InventoryTransactionSchema,
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
} from "../src/schemas";
import { AuditLog, AuditLogSchema } from "../src/schemas/audit-log.schema";
import { AuditService } from "../src/modules/audit/audit.service";

describe("RBAC protections", () => {
  let mongo: MongoMemoryReplSet;
  let connection: Connection;
  let workOrdersService: WorkOrdersService;

  beforeAll(async () => {
    mongo = await MongoMemoryReplSet.create({
      replSet: { storageEngine: "wiredTiger" },
    });
    await mongo.waitUntilRunning();
    const conn = await mongoose.connect(mongo.getUri());
    connection = conn.connection;

    const workOrderModel = connection.model(WorkOrder.name, WorkOrderSchema);
    const timeLogModel = connection.model(TimeLog.name, TimeLogSchema);
    const partModel = connection.model(Part.name, PartSchema);
    const trxModel = connection.model(
      InventoryTransaction.name,
      InventoryTransactionSchema
    );
    const customerModel = connection.model(Customer.name, CustomerSchema);
    const vehicleModel = connection.model(Vehicle.name, VehicleSchema);
    const userModel = connection.model(User.name, UserSchema);
    const invoiceModel = connection.model(Invoice.name, InvoiceSchema);
    const paymentModel = connection.model(Payment.name, PaymentSchema);
    const auditService = new AuditService(
      connection.model(AuditLog.name, AuditLogSchema)
    );

    workOrdersService = new WorkOrdersService(
      workOrderModel,
      timeLogModel,
      partModel,
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

  test("guard denies work orders list without any read permission", () => {
    const reflector: any = {
      getAllAndOverride: (key: string) => {
        if (key === PERMISSIONS_ANY_KEY)
          return [
            Permissions.WORKORDERS_READ_ALL,
            Permissions.WORKORDERS_READ_ASSIGNED,
          ];
        if (key === PERMISSIONS_KEY) return undefined;
        return undefined;
      },
    };
    const guard = new PermissionsGuard(reflector as any);
    const context: any = {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({ user: { permissions: [] } }),
      }),
    };
    expect(() => guard.canActivate(context as any)).toThrow(ForbiddenException);
  });

  test("read-assigned user only sees their assigned work orders by default", async () => {
    const userA = new mongoose.Types.ObjectId().toString();
    const userB = new mongoose.Types.ObjectId().toString();
    const woModel = connection.model(WorkOrder.name);
    await woModel.create({
      customerId: new mongoose.Types.ObjectId(),
      vehicleId: new mongoose.Types.ObjectId(),
      status: "Scheduled",
      assignedEmployees: [
        {
          employeeId: new mongoose.Types.ObjectId(userA),
          roleType: "TECHNICIAN",
        },
      ],
    });
    await woModel.create({
      customerId: new mongoose.Types.ObjectId(),
      vehicleId: new mongoose.Types.ObjectId(),
      status: "Scheduled",
      assignedEmployees: [
        {
          employeeId: new mongoose.Types.ObjectId(userB),
          roleType: "TECHNICIAN",
        },
      ],
    });
    await woModel.create({
      customerId: new mongoose.Types.ObjectId(),
      vehicleId: new mongoose.Types.ObjectId(),
      status: "Scheduled",
      assignedEmployees: [],
    });

    const result = await workOrdersService.list(
      {
        userId: userA,
        role: "INVENTORY_MANAGER",
        permissions: [Permissions.WORKORDERS_READ_ASSIGNED],
      },
      {}
    );
    expect(result).toHaveLength(1);
    expect(result[0].assignedEmployees[0].employeeId.toString()).toBe(userA);
  });

  test("tech with scheduled-pool permission sees unassigned scheduled plus own assigned", async () => {
    const techId = new mongoose.Types.ObjectId().toString();
    const woModel = connection.model(WorkOrder.name);
    await woModel.create({
      customerId: new mongoose.Types.ObjectId(),
      vehicleId: new mongoose.Types.ObjectId(),
      status: "Scheduled",
      assignedEmployees: [
        {
          employeeId: new mongoose.Types.ObjectId(techId),
          roleType: "TECHNICIAN",
        },
      ],
    });
    await woModel.create({
      customerId: new mongoose.Types.ObjectId(),
      vehicleId: new mongoose.Types.ObjectId(),
      status: "Scheduled",
      assignedEmployees: [],
    });
    const result = await workOrdersService.list(
      {
        userId: techId,
        role: "TECHNICIAN",
        permissions: [
          Permissions.WORKORDERS_READ_ASSIGNED,
          Permissions.WORKORDERS_READ_SCHEDULED_POOL,
        ],
      },
      {}
    );
    expect(result).toHaveLength(2);
  });

  test("technician cannot set work order status back to Scheduled", async () => {
    const techId = new mongoose.Types.ObjectId().toString();
    const wo = await connection.model(WorkOrder.name).create({
      customerId: new mongoose.Types.ObjectId(),
      vehicleId: new mongoose.Types.ObjectId(),
      status: "In Progress",
      assignedEmployees: [
        {
          employeeId: new mongoose.Types.ObjectId(techId),
          roleType: "TECHNICIAN",
        },
      ],
    });
    await expect(
      workOrdersService.updateStatus(wo._id.toString(), "Scheduled", {
        userId: techId,
        role: "TECHNICIAN",
      })
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
