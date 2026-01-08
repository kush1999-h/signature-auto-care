"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const mongodb_memory_server_1 = require("mongodb-memory-server");
const shared_1 = require("@signature-auto-care/shared");
const permissions_guard_1 = require("../src/common/guards/permissions.guard");
const permissions_any_decorator_1 = require("../src/common/decorators/permissions-any.decorator");
const permissions_decorator_1 = require("../src/common/decorators/permissions.decorator");
const common_1 = require("@nestjs/common");
const work_orders_service_1 = require("../src/modules/work-orders/work-orders.service");
const schemas_1 = require("../src/schemas");
const audit_log_schema_1 = require("../src/schemas/audit-log.schema");
const audit_service_1 = require("../src/modules/audit/audit.service");
describe("RBAC protections", () => {
    let mongo;
    let connection;
    let workOrdersService;
    beforeAll(async () => {
        mongo = await mongodb_memory_server_1.MongoMemoryServer.create();
        connection = await mongoose_1.default.createConnection(mongo.getUri());
        const workOrderModel = connection.model(schemas_1.WorkOrder.name, schemas_1.WorkOrderSchema);
        const timeLogModel = connection.model(schemas_1.TimeLog.name, schemas_1.TimeLogSchema);
        const partModel = connection.model(schemas_1.Part.name, schemas_1.PartSchema);
        const trxModel = connection.model(schemas_1.InventoryTransaction.name, schemas_1.InventoryTransactionSchema);
        const customerModel = connection.model(schemas_1.Customer.name, schemas_1.CustomerSchema);
        const vehicleModel = connection.model(schemas_1.Vehicle.name, schemas_1.VehicleSchema);
        const userModel = connection.model(schemas_1.User.name, schemas_1.UserSchema);
        const invoiceModel = connection.model(schemas_1.Invoice.name, schemas_1.InvoiceSchema);
        const auditService = new audit_service_1.AuditService(connection.model(audit_log_schema_1.AuditLog.name, audit_log_schema_1.AuditLogSchema));
        workOrdersService = new work_orders_service_1.WorkOrdersService(workOrderModel, timeLogModel, partModel, trxModel, customerModel, vehicleModel, userModel, invoiceModel, connection, auditService);
    });
    afterAll(async () => {
        await connection.close();
        await mongo.stop();
    });
    test("guard denies work orders list without any read permission", () => {
        const reflector = {
            getAllAndOverride: (key) => {
                if (key === permissions_any_decorator_1.PERMISSIONS_ANY_KEY)
                    return [shared_1.Permissions.WORKORDERS_READ_ALL, shared_1.Permissions.WORKORDERS_READ_ASSIGNED];
                if (key === permissions_decorator_1.PERMISSIONS_KEY)
                    return undefined;
                return undefined;
            }
        };
        const guard = new permissions_guard_1.PermissionsGuard(reflector);
        const context = {
            getHandler: () => ({}),
            getClass: () => ({}),
            switchToHttp: () => ({
                getRequest: () => ({ user: { permissions: [] } })
            })
        };
        expect(() => guard.canActivate(context)).toThrow(common_1.ForbiddenException);
    });
    test("read-assigned user only sees their assigned work orders by default", async () => {
        const userA = new mongoose_1.default.Types.ObjectId().toString();
        const userB = new mongoose_1.default.Types.ObjectId().toString();
        const woModel = connection.model(schemas_1.WorkOrder.name);
        await woModel.create({
            customerId: new mongoose_1.default.Types.ObjectId(),
            vehicleId: new mongoose_1.default.Types.ObjectId(),
            status: "Scheduled",
            assignedEmployees: [{ employeeId: new mongoose_1.default.Types.ObjectId(userA), roleType: "TECHNICIAN" }]
        });
        await woModel.create({
            customerId: new mongoose_1.default.Types.ObjectId(),
            vehicleId: new mongoose_1.default.Types.ObjectId(),
            status: "Scheduled",
            assignedEmployees: [{ employeeId: new mongoose_1.default.Types.ObjectId(userB), roleType: "TECHNICIAN" }]
        });
        await woModel.create({
            customerId: new mongoose_1.default.Types.ObjectId(),
            vehicleId: new mongoose_1.default.Types.ObjectId(),
            status: "Scheduled",
            assignedEmployees: []
        });
        const result = await workOrdersService.list({ userId: userA, role: "INVENTORY_MANAGER", permissions: [shared_1.Permissions.WORKORDERS_READ_ASSIGNED] }, {});
        expect(result).toHaveLength(1);
        expect(result[0].assignedEmployees[0].employeeId.toString()).toBe(userA);
    });
    test("tech with scheduled-pool permission sees unassigned scheduled plus own assigned", async () => {
        const techId = new mongoose_1.default.Types.ObjectId().toString();
        const woModel = connection.model(schemas_1.WorkOrder.name);
        await woModel.create({
            customerId: new mongoose_1.default.Types.ObjectId(),
            vehicleId: new mongoose_1.default.Types.ObjectId(),
            status: "Scheduled",
            assignedEmployees: [{ employeeId: new mongoose_1.default.Types.ObjectId(techId), roleType: "TECHNICIAN" }]
        });
        await woModel.create({
            customerId: new mongoose_1.default.Types.ObjectId(),
            vehicleId: new mongoose_1.default.Types.ObjectId(),
            status: "Scheduled",
            assignedEmployees: []
        });
        const result = await workOrdersService.list({
            userId: techId,
            role: "TECHNICIAN",
            permissions: [shared_1.Permissions.WORKORDERS_READ_ASSIGNED, shared_1.Permissions.WORKORDERS_READ_SCHEDULED_POOL]
        }, {});
        expect(result).toHaveLength(2);
    });
    test("technician cannot set work order status back to Scheduled", async () => {
        const techId = new mongoose_1.default.Types.ObjectId().toString();
        const wo = await connection.model(schemas_1.WorkOrder.name).create({
            customerId: new mongoose_1.default.Types.ObjectId(),
            vehicleId: new mongoose_1.default.Types.ObjectId(),
            status: "In Progress",
            assignedEmployees: [{ employeeId: new mongoose_1.default.Types.ObjectId(techId), roleType: "TECHNICIAN" }]
        });
        await expect(workOrdersService.updateStatus(wo._id.toString(), "Scheduled", { userId: techId, role: "TECHNICIAN" })).rejects.toBeInstanceOf(common_1.ForbiddenException);
    });
});
//# sourceMappingURL=rbac.spec.js.map