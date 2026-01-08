"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const mongodb_memory_server_1 = require("mongodb-memory-server");
const parts_service_1 = require("../src/modules/parts/parts.service");
const work_orders_service_1 = require("../src/modules/work-orders/work-orders.service");
const audit_service_1 = require("../src/modules/audit/audit.service");
const schemas_1 = require("../src/schemas");
const insufficient_stock_exception_1 = require("../src/common/exceptions/insufficient-stock.exception");
const audit_log_schema_1 = require("../src/schemas/audit-log.schema");
describe("Inventory safety", () => {
    let mongo;
    let connection;
    let partsService;
    let workOrdersService;
    beforeAll(async () => {
        mongo = await mongodb_memory_server_1.MongoMemoryServer.create();
        connection = await mongoose_1.default.createConnection(mongo.getUri());
        const partModel = connection.model(schemas_1.Part.name, schemas_1.PartSchema);
        const trxModel = connection.model(schemas_1.InventoryTransaction.name, schemas_1.InventoryTransactionSchema);
        const workOrderModel = connection.model(schemas_1.WorkOrder.name, schemas_1.WorkOrderSchema);
        const timeLogModel = connection.model(schemas_1.TimeLog.name, schemas_1.TimeLogSchema);
        const customerModel = connection.model(schemas_1.Customer.name, schemas_1.CustomerSchema);
        const vehicleModel = connection.model(schemas_1.Vehicle.name, schemas_1.VehicleSchema);
        const userModel = connection.model(schemas_1.User.name, schemas_1.UserSchema);
        const invoiceModel = connection.model(schemas_1.Invoice.name, schemas_1.InvoiceSchema);
        const auditService = new audit_service_1.AuditService(connection.model(audit_log_schema_1.AuditLog.name, audit_log_schema_1.AuditLogSchema));
        partsService = new parts_service_1.PartsService(partModel, trxModel, connection, auditService);
        workOrdersService = new work_orders_service_1.WorkOrdersService(workOrderModel, timeLogModel, partModel, trxModel, customerModel, vehicleModel, userModel, invoiceModel, connection, auditService);
    });
    afterAll(async () => {
        await connection.close();
        await mongo.stop();
    });
    test("concurrent issue only decrements once", async () => {
        const part = await partsService.create({ partName: "Oil Filter", sku: "OF-1", purchasePrice: 5, sellingPrice: 10 });
        await partsService.receiveInventory({
            partId: part._id.toString(),
            qty: 5,
            unitCost: 5,
            performedBy: new mongoose_1.default.Types.ObjectId().toString()
        });
        const wo = await connection.model(schemas_1.WorkOrder.name).create({ customerId: new mongoose_1.default.Types.ObjectId(), vehicleId: new mongoose_1.default.Types.ObjectId(), status: "Scheduled" });
        const attempt1 = workOrdersService.issuePart({ workOrderId: wo._id.toString(), partId: part._id.toString(), qty: 5, performedBy: new mongoose_1.default.Types.ObjectId().toString() });
        const attempt2 = workOrdersService.issuePart({ workOrderId: wo._id.toString(), partId: part._id.toString(), qty: 5, performedBy: new mongoose_1.default.Types.ObjectId().toString() });
        const results = await Promise.allSettled([attempt1, attempt2]);
        const fulfilled = results.filter((r) => r.status === "fulfilled");
        const rejected = results.filter((r) => r.status === "rejected");
        expect(fulfilled).toHaveLength(1);
        expect(rejected).toHaveLength(1);
        expect(rejected[0].reason).toBeInstanceOf(insufficient_stock_exception_1.InsufficientStockException);
        const updatedPart = await connection.model(schemas_1.Part.name).findById(part._id);
        expect(updatedPart?.onHandQty).toBe(0);
    });
    test("idempotent receive does not double apply", async () => {
        const part = await partsService.create({ partName: "Brake Pad", sku: "BP-1", purchasePrice: 20, sellingPrice: 40 });
        const key = "receive-key";
        const first = await partsService.receiveInventory({
            partId: part._id.toString(),
            qty: 10,
            unitCost: 20,
            performedBy: new mongoose_1.default.Types.ObjectId().toString(),
            idempotencyKey: key
        });
        const second = await partsService.receiveInventory({
            partId: part._id.toString(),
            qty: 10,
            unitCost: 20,
            performedBy: new mongoose_1.default.Types.ObjectId().toString(),
            idempotencyKey: key
        });
        expect(second.transaction._id.toString()).toEqual(first.transaction._id.toString());
        const updated = await connection.model(schemas_1.Part.name).findById(part._id);
        expect(updated?.onHandQty).toBe(10);
    });
    test("reversal restores stock and links transactions", async () => {
        const part = await partsService.create({ partName: "Coolant", sku: "CL-1", purchasePrice: 8, sellingPrice: 16 });
        const receive = await partsService.receiveInventory({
            partId: part._id.toString(),
            qty: 5,
            unitCost: 8,
            performedBy: new mongoose_1.default.Types.ObjectId().toString()
        });
        const issue = await workOrdersService.issuePart({
            workOrderId: (await connection.model(schemas_1.WorkOrder.name).create({ customerId: new mongoose_1.default.Types.ObjectId(), vehicleId: new mongoose_1.default.Types.ObjectId(), status: "Scheduled" }))._id.toString(),
            partId: part._id.toString(),
            qty: 2,
            performedBy: new mongoose_1.default.Types.ObjectId().toString()
        });
        const reversal = await partsService.reverseTransaction({
            transactionId: issue.transaction._id.toString(),
            performedBy: new mongoose_1.default.Types.ObjectId().toString()
        });
        expect(reversal.transaction.reversesTransactionId?.toString()).toEqual(issue.transaction._id.toString());
        const updated = await connection.model(schemas_1.Part.name).findById(part._id);
        expect(updated?.onHandQty).toBe(5); // back to post-receive level
        expect(receive.transaction).toBeDefined();
    });
});
//# sourceMappingURL=inventory.spec.js.map