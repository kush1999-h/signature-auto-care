import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectConnection, InjectModel } from "@nestjs/mongoose";
import { Connection, Model, Types } from "mongoose";
import {
  WorkOrderStatus,
  Permissions,
  InventoryReferenceType,
  InventoryTransactionType,
  InvoiceType,
  InvoiceStatus,
  WorkOrderStatusType,
  Role,
  Roles,
} from "@signature-auto-care/shared";
import {
  WorkOrder,
  TimeLog,
  Part,
  Service,
  InventoryTransaction,
  Customer,
  Vehicle,
  User,
  Invoice,
  Payment,
} from "../../schemas";
import { AuditService } from "../audit/audit.service";
import { InsufficientStockException } from "../../common/exceptions/insufficient-stock.exception";
import { AuthUser } from "../../common/decorators/current-user.decorator";

type InvoiceLineItem = {
  type: "LABOR" | "PART" | "SERVICE" | "OTHER";
  description: string;
  quantity: number;
  unitPrice: Types.Decimal128;
  total: Types.Decimal128;
  costAtTime?: Types.Decimal128;
};

type BillingServiceLineInput = {
  serviceId: string;
  qty?: number;
  unitPriceAtTime?: number;
  unitCostAtTime?: number;
  nameAtTime?: string;
};

type CreateWorkOrderInput = Partial<WorkOrder> & {
  createdBy?: string;
  isHistorical?: boolean;
  dateIn?: string | Date;
  dateOut?: string | Date;
  historicalBillAmount?: number;
  historicalCostAmount?: number;
  historicalSource?: string;
  paymentMethod?: string;
};

const normalizeId = (value: unknown) => {
  if (value && typeof value === "object" && "toString" in value) {
    return (value as { toString: () => string }).toString();
  }
  return String(value);
};

const resolveUserId = (user: AuthUser) =>
  normalizeId(user.userId || (user as { _id?: string })._id || (user as { sub?: string }).sub);

const toObjectId = (value: string) =>
  Types.ObjectId.isValid(value) ? new Types.ObjectId(value) : null;

@Injectable()
export class WorkOrdersService {
  constructor(
    @InjectModel(WorkOrder.name)
    private workOrderModel: Model<WorkOrder>,
    @InjectModel(TimeLog.name) private timeLogModel: Model<TimeLog>,
    @InjectModel(Part.name) private partModel: Model<Part>,
    @InjectModel(Service.name) private serviceModel: Model<Service>,
    @InjectModel(InventoryTransaction.name)
    private trxModel: Model<InventoryTransaction>,
    @InjectModel(Customer.name) private customerModel: Model<Customer>,
    @InjectModel(Vehicle.name) private vehicleModel: Model<Vehicle>,
    @InjectModel(User.name) private userModel: Model<User>,
    @InjectModel(Invoice.name) private invoiceModel: Model<Invoice>,
    @InjectModel(Payment.name) private paymentModel: Model<Payment>,
    @InjectConnection() private connection: Connection,
    private audit: AuditService
  ) {}

  private decimalFromNumber(val: number) {
    return Types.Decimal128.fromString((val || 0).toString());
  }

  private decimalToNumber(val?: Types.Decimal128 | number | null) {
    if (!val) return 0;
    if (typeof val === "number") return val;
    return parseFloat(val.toString());
  }

  private computeFinancials(wo: WorkOrder) {
    const labor = this.decimalToNumber(wo.billableLaborAmount || 0);
    const partsTotal = (wo.partsUsed || []).reduce((sum, part) => {
      const qty = Number(part.qty) || 0;
      const priceEach = this.decimalToNumber(part.sellingPriceAtTime || 0);
      return sum + qty * priceEach;
    }, 0);
    const servicesTotal = (wo.servicesUsed || []).reduce((sum, service) => {
      const qty = Number(service.qty) || 0;
      const priceEach = this.decimalToNumber(service.unitPriceAtTime || 0);
      return sum + qty * priceEach;
    }, 0);
    const otherTotal = (wo.otherCharges || []).reduce((sum, charge) => {
      return sum + this.decimalToNumber(charge?.amount || 0);
    }, 0);
    const subtotal = labor + partsTotal + servicesTotal + otherTotal;
    const tax = 0;
    const total = subtotal + tax;
    const advanceReceived = Math.max(
      0,
      this.decimalToNumber((wo as WorkOrder & { advanceAmount?: Types.Decimal128 }).advanceAmount || 0)
    );
    const storedAdvanceApplied = Math.max(
      0,
      this.decimalToNumber(
        (wo as WorkOrder & { advanceAppliedAmount?: Types.Decimal128 }).advanceAppliedAmount || 0
      )
    );
    const advanceApplied = Math.min(storedAdvanceApplied, advanceReceived, total);
    const amountDue = Math.max(total - advanceApplied, 0);
    return {
      labor,
      partsTotal,
      servicesTotal,
      otherTotal,
      subtotal,
      tax,
      total,
      advanceReceived,
      advanceApplied,
      amountDue,
    };
  }

  private buildInvoicePayload(wo: WorkOrder) {
    const { labor, partsTotal, otherTotal, subtotal, tax, total } =
      this.computeFinancials(wo);
    const lineItems: InvoiceLineItem[] = [];

    if (labor > 0) {
      lineItems.push({
        type: "LABOR",
        description: "Billable Labor",
        quantity: 1,
        unitPrice: this.decimalFromNumber(labor),
        total: this.decimalFromNumber(labor),
      });
    }

    for (const part of wo.partsUsed || []) {
      const qty = Number(part.qty) || 0;
      const priceEach = this.decimalToNumber(part.sellingPriceAtTime || 0);
      const totalPrice = priceEach * qty;
      if (totalPrice > 0) {
        lineItems.push({
          type: "PART",
          description: `Part (${part.partId})`,
          quantity: qty,
          unitPrice: this.decimalFromNumber(priceEach),
          total: this.decimalFromNumber(totalPrice),
          costAtTime: part.costAtTime,
        });
      }
    }

    for (const charge of wo.otherCharges || []) {
      const amount = this.decimalToNumber(charge.amount || 0);
      if (amount > 0) {
        lineItems.push({
          type: "OTHER",
          description: charge.name || "Additional Charge",
          quantity: 1,
          unitPrice: this.decimalFromNumber(amount),
          total: this.decimalFromNumber(amount),
          costAtTime: this.decimalFromNumber(
            this.decimalToNumber((charge as { costAtTime?: Types.Decimal128 }).costAtTime || 0)
          ),
        });
      }
    }

    for (const service of wo.servicesUsed || []) {
      const qty = Number(service.qty) || 0;
      const priceEach = this.decimalToNumber(service.unitPriceAtTime || 0);
      const totalPrice = priceEach * qty;
      if (qty > 0 && totalPrice >= 0) {
        lineItems.push({
          type: "SERVICE",
          description: service.nameAtTime || `Service (${service.serviceId})`,
          quantity: qty,
          unitPrice: this.decimalFromNumber(priceEach),
          total: this.decimalFromNumber(totalPrice),
          costAtTime: this.decimalFromNumber(this.decimalToNumber(service.unitCostAtTime || 0)),
        });
      }
    }

    return {
      lineItems,
      labor,
      partsTotal,
      otherTotal,
      subtotal,
      tax,
      total,
    };
  }

  async list(user: AuthUser, query: { status?: string } = {}) {
    const userId = resolveUserId(user);
    const userObjectId = toObjectId(userId);

    // Check for READ_ALL permission first
    if (user.permissions?.includes(Permissions.WORKORDERS_READ_ALL)) {
      const filter: Record<string, unknown> = {};
      if (query.status) filter.status = query.status;
      return this.workOrderModel.find(filter).sort({ createdAt: -1 }).exec();
    }

    // Check for READ_ASSIGNED permission
    if (user.permissions?.includes(Permissions.WORKORDERS_READ_ASSIGNED)) {
      if (!userObjectId) {
        throw new ForbiddenException("Invalid user id");
      }

      // If no status filter, default to excluding closed/canceled
      if (!query.status) {
        const assigned = this.workOrderModel
          .find({
            "assignedEmployees.employeeId": userObjectId,
            status: { $nin: [WorkOrderStatus.CLOSED, WorkOrderStatus.CANCELED] },
          })
          .sort({ createdAt: -1 });

        return assigned.exec();
      }

      // With explicit status filter, respect it
      const assigned = this.workOrderModel
        .find({
          "assignedEmployees.employeeId": userObjectId,
          status: query.status,
        })
        .sort({ createdAt: -1 });

      return assigned.exec();
    }

    throw new ForbiddenException("No access to work orders");
  }

  async findById(id: string) {
    return this.workOrderModel.findById(id);
  }

  async detail(user: AuthUser, id: string) {
    const wo = await this.workOrderModel.findById(id).lean();
    if (!wo) throw new NotFoundException("Work order not found");

    const userId = resolveUserId(user);
    const assignedIds =
      wo.assignedEmployees?.map((a) => normalizeId(a.employeeId)) || [];

    const canAll = user.permissions?.includes(Permissions.WORKORDERS_READ_ALL);
    const canAssigned = user.permissions?.includes(
      Permissions.WORKORDERS_READ_ASSIGNED
    );
    if (!canAll && !canAssigned) {
      throw new ForbiddenException("No access to this work order");
    }

    if (!canAll && canAssigned) {
      if (!assignedIds.includes(userId)) {
        throw new ForbiddenException("No access to this work order");
      }
    }

    const [customer, vehicle] = await Promise.all([
      this.customerModel.findById(wo.customerId).lean(),
      this.vehicleModel.findById(wo.vehicleId).lean(),
    ]);

    const users = assignedIds.length
      ? await this.userModel
          .find({ _id: { $in: assignedIds } })
          .select("name role email")
          .lean()
      : [];
    const partsMap: Record<
      string,
      {
        partName?: string;
        sku?: string;
        barcode?: string;
        sellingPrice?: number;
        purchasePrice?: number;
        avgCost?: number;
      }
    > = {};
    const partIds = (wo.partsUsed || []).map((p) => p.partId).filter(Boolean);
    if (partIds.length) {
      const parts = await this.partModel.find({ _id: { $in: partIds } }).lean();
      parts.forEach((p) => {
        const normalized = {
          ...p,
          sellingPrice: this.decimalToNumber(p.sellingPrice),
          purchasePrice: this.decimalToNumber(p.purchasePrice),
          avgCost: this.decimalToNumber(p.avgCost)
        };
        partsMap[p._id.toString()] = normalized;
      });
    }

    const canReadAllLogs = user.permissions?.includes(
      Permissions.TIMELOGS_READ_ALL
    );
    let timeLogs: TimeLog[] = [];
    if (canReadAllLogs) {
      timeLogs = await this.timeLogModel.find({ workOrderId: wo._id }).lean();
    } else {
      // Always include the current user's logs so techs can see their own clock-ins
      const userObjectId = toObjectId(userId);
      timeLogs = userObjectId
        ? await this.timeLogModel
            .find({ workOrderId: wo._id, employeeId: userObjectId })
            .lean()
        : [];
    }
    const activeLog = timeLogs.find(
      (l) => !l.clockOutAt && userId && normalizeId(l.employeeId) === userId
    );
    const now = Date.now();
    const totalMinutes = (timeLogs || []).reduce(
      (sum, l) => sum + (l.durationMinutes || 0),
      0
    );
    const runningMinutes = activeLog
      ? Math.max(
          0,
          Math.round((now - new Date(activeLog.clockInAt).getTime()) / 60000)
        )
      : 0;

    const invoice = await this.invoiceModel
      .findOne({ workOrderId: wo._id })
      .select("_id invoiceNumber status total")
      .lean();

    const auditEntries = await this.audit.list({
      entityType: "WorkOrder",
      entityId: wo._id.toString(),
      actionType: [
        "WORK_ORDER_CREATED",
        "WORK_ORDER_BILLING_SUBMIT",
        "WORK_ORDER_BILLING_UPDATE",
        "WORK_ORDER_ASSIGN",
        "WORK_ORDER_CANCELLED"
      ],
      limit: 100
    });
    const createdEntry = [...auditEntries].reverse().find((entry) => entry.actionType === "WORK_ORDER_CREATED");
    const billingSubmitEntry = auditEntries.find((entry) => entry.actionType === "WORK_ORDER_BILLING_SUBMIT");
    const billingUpdateEntry = auditEntries.find((entry) => entry.actionType === "WORK_ORDER_BILLING_UPDATE");
    const toAuditActor = (entry?: { performedByName?: string; performedByRole?: string; timestamp?: Date }) =>
      entry
        ? {
            name: entry.performedByName,
            role: entry.performedByRole,
            at: entry.timestamp ? entry.timestamp.toISOString() : undefined
          }
        : undefined;
    const assignmentEntries = auditEntries.filter((entry) => entry.actionType === "WORK_ORDER_ASSIGN");
    const assignmentIds = new Set<string>();
    assignmentEntries.forEach((entry) => {
      const after = entry.after as { assignedEmployees?: { employeeId?: unknown; roleType?: string }[] } | undefined;
      (after?.assignedEmployees || []).forEach((emp) => {
        const empId = normalizeId(emp.employeeId);
        if (empId) assignmentIds.add(empId);
      });
    });
    const auditUserIds = new Set<string>([...assignedIds, ...assignmentIds]);
    const auditUsers = auditUserIds.size
      ? await this.userModel
          .find({ _id: { $in: Array.from(auditUserIds) } })
          .select("name role email")
          .lean()
      : [];
    const auditUserMap = new Map(auditUsers.map((u) => [u._id.toString(), u]));
    const toUserSummary = (id: string, roleType?: string) => {
      const user = auditUserMap.get(id);
      return {
        id,
        name: user?.name || user?.email || id,
        role: user?.role as Role | undefined,
        roleType
      };
    };
    const auditTrail = auditEntries.map((entry) => {
      const actor = toAuditActor(entry);
      if (entry.actionType === "WORK_ORDER_ASSIGN") {
        const after = entry.after as
          | { assignedEmployees?: { employeeId?: unknown; roleType?: string }[]; autoAssigned?: boolean; role?: string }
          | undefined;
        const autoAssigned = Boolean(after?.autoAssigned);
        const explicitAssignees = after?.assignedEmployees || [];
        const fallbackAssignees =
          autoAssigned && entry.performedByEmployeeId
            ? [{ employeeId: entry.performedByEmployeeId, roleType: after?.role }]
            : [];
        const assignees = (explicitAssignees.length ? explicitAssignees : fallbackAssignees)
          .map((emp) => {
            const empId = normalizeId(emp.employeeId);
            return empId ? toUserSummary(empId, emp.roleType) : null;
          })
          .filter(Boolean) as { id: string; name: string; role?: Role; roleType?: string }[];
        return { actionType: entry.actionType, by: actor, assignees, autoAssigned };
      }
      return { actionType: entry.actionType, by: actor };
    });

    const partsUsed = (wo.partsUsed || []).map((p) => {
      const detail = partsMap[p.partId?.toString() || ""] || {};
      return {
        ...p,
        qty: Number(p.qty || 0),
        sellingPriceAtTime: this.decimalToNumber((p as { sellingPriceAtTime?: Types.Decimal128 }).sellingPriceAtTime || 0),
        costAtTime: this.decimalToNumber((p as { costAtTime?: Types.Decimal128 }).costAtTime || 0),
        partName: detail.partName,
        sku: detail.sku,
        barcode: detail.barcode,
      };
    });

    const normalizedServices = (wo.servicesUsed || []).map((s) => ({
      ...s,
      qty: Number(s.qty || 0),
      unitPriceAtTime: this.decimalToNumber((s as { unitPriceAtTime?: Types.Decimal128 }).unitPriceAtTime || 0),
      unitCostAtTime: this.decimalToNumber((s as { unitCostAtTime?: Types.Decimal128 }).unitCostAtTime || 0),
    }));

    const normalizedOtherCharges = (wo.otherCharges || []).map((c) => ({
      ...c,
      amount: this.decimalToNumber((c as { amount?: Types.Decimal128 }).amount || 0),
      costAtTime: this.decimalToNumber((c as { costAtTime?: Types.Decimal128 }).costAtTime || 0),
    }));

    const normalizedWorkOrder = {
      ...wo,
      billableLaborAmount: this.decimalToNumber((wo as { billableLaborAmount?: Types.Decimal128 }).billableLaborAmount || 0),
      advanceAmount: this.decimalToNumber((wo as { advanceAmount?: Types.Decimal128 }).advanceAmount || 0),
      advanceAppliedAmount: this.decimalToNumber(
        (wo as { advanceAppliedAmount?: Types.Decimal128 }).advanceAppliedAmount || 0
      ),
      servicesUsed: normalizedServices,
      otherCharges: normalizedOtherCharges,
    };

    const isAssigned = userId ? assignedIds.includes(userId) : false;

    return {
      workOrder: normalizedWorkOrder,
      customer,
      vehicle,
      assignedEmployees: users,
      partsUsed,
      timeLogs,
      totalMinutes,
    runningMinutes,
    activeLog,
      invoice,
      isAssigned,
      audit: {
        createdBy: toAuditActor(createdEntry),
        billedBy: toAuditActor(billingSubmitEntry),
        billingUpdatedBy: toAuditActor(billingUpdateEntry)
      },
      auditTrail,
      financials: this.computeFinancials(wo as WorkOrder),
    };
  }

  async create(payload: CreateWorkOrderInput, user?: AuthUser) {
    const referenceRaw = (payload as Partial<WorkOrder> & { reference?: string }).reference;
    const advanceRaw = (payload as Partial<WorkOrder> & { advanceAmount?: unknown }).advanceAmount;
    const reference = typeof referenceRaw === "string" ? referenceRaw.trim() : "";
    if (reference.length > 120) {
      throw new BadRequestException("Reference must be 120 characters or fewer");
    }
    const advanceAmount = advanceRaw === undefined ? 0 : Number(advanceRaw);
    if (!Number.isFinite(advanceAmount) || advanceAmount < 0) {
      throw new BadRequestException("Advance amount must be a non-negative number");
    }

    const allowedStatuses = new Set<WorkOrderStatusType>(Object.values(WorkOrderStatus));
    const requestedStatus = payload.status && allowedStatuses.has(payload.status as WorkOrderStatusType)
      ? (payload.status as WorkOrderStatusType)
      : WorkOrderStatus.SCHEDULED;

    const isHistorical = Boolean(payload.isHistorical);
    const roleName = String(user?.role || "");
    const canBackfill =
      Boolean(user?.permissions?.includes(Permissions.WORKORDERS_CREATE_HISTORICAL)) ||
      roleName === Roles.OWNER_ADMIN ||
      roleName === Roles.OPS_MANAGER ||
      roleName === Roles.SERVICE_ADVISOR;
    if (isHistorical && !canBackfill) {
      throw new ForbiddenException("No permission to create historical work orders");
    }

    const parseOptionalDate = (value?: string | Date) => {
      if (!value) return null;
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    };
    const dateIn = parseOptionalDate(payload.dateIn);
    const dateOut = parseOptionalDate(payload.dateOut);
    if (isHistorical && !dateIn) {
      throw new BadRequestException("dateIn is required for historical entries");
    }
    if (dateIn && dateOut && dateOut.getTime() < dateIn.getTime()) {
      throw new BadRequestException("dateOut must be on or after dateIn");
    }

    const historicalBillAmountRaw = payload.historicalBillAmount;
    const historicalCostAmountRaw = payload.historicalCostAmount;
    const historicalBillAmount =
      historicalBillAmountRaw === undefined || historicalBillAmountRaw === null
        ? null
        : Number(historicalBillAmountRaw);
    const historicalCostAmount =
      historicalCostAmountRaw === undefined || historicalCostAmountRaw === null
        ? null
        : Number(historicalCostAmountRaw);
    if (historicalBillAmount !== null && (!Number.isFinite(historicalBillAmount) || historicalBillAmount < 0)) {
      throw new BadRequestException("Historical bill amount must be a non-negative number");
    }
    if (historicalCostAmount !== null && (!Number.isFinite(historicalCostAmount) || historicalCostAmount < 0)) {
      throw new BadRequestException("Historical cost amount must be a non-negative number");
    }
    if ((historicalCostAmount || 0) > 0 && (historicalBillAmount || 0) <= 0) {
      throw new BadRequestException("Historical bill amount is required when cost is provided");
    }

    const historicalSource =
      typeof payload.historicalSource === "string" ? payload.historicalSource.trim() : "";
    if (historicalSource.length > 200) {
      throw new BadRequestException("Historical source must be 200 characters or fewer");
    }

    const normalizedOtherCharges =
      historicalBillAmount !== null && historicalBillAmount > 0
        ? [
            {
              name: "Historical carried-in bill",
              amount: this.decimalFromNumber(historicalBillAmount),
              costAtTime: this.decimalFromNumber(historicalCostAmount || 0),
            },
          ]
        : payload.otherCharges;

    const createPayload: Partial<WorkOrder> = {
      ...payload,
      status: requestedStatus,
      reference: reference || undefined,
      advanceAmount: this.decimalFromNumber(advanceAmount),
      advanceAppliedAmount: this.decimalFromNumber(0),
      dateIn: dateIn || undefined,
      deliveredAt:
        requestedStatus === WorkOrderStatus.CLOSED ? dateOut || dateIn || new Date() : null,
      isHistorical,
      historicalSource: historicalSource || undefined,
      otherCharges: normalizedOtherCharges,
    };

    let wo = await this.workOrderModel.create(createPayload);
    const performerId = user ? resolveUserId(user) : payload.createdBy;
    const performerObjectId = performerId ? toObjectId(performerId) : null;

    if (isHistorical && dateIn) {
      await this.workOrderModel.collection.updateOne(
        { _id: wo._id },
        { $set: { createdAt: dateIn, updatedAt: dateIn, dateIn } }
      );
      const refreshed = await this.workOrderModel.findById(wo._id);
      if (refreshed) wo = refreshed;
    }

    if (requestedStatus === WorkOrderStatus.CLOSED && user) {
      await this.updateBilling(
        wo._id.toString(),
        { paymentMethod: payload.paymentMethod || "CASH" },
        user
      );
      if (dateOut) {
        await this.workOrderModel.updateOne(
          { _id: wo._id },
          { $set: { deliveredAt: dateOut } }
        );
      }
      const refreshedClosed = await this.workOrderModel.findById(wo._id);
      if (refreshedClosed) wo = refreshedClosed;
    }

    if (performerObjectId) {
      await this.audit.record({
        actionType: "WORK_ORDER_CREATED",
        entityType: "WorkOrder",
        entityId: wo._id.toString(),
        performedByEmployeeId: performerObjectId,
        performedByRole: user?.role,
        after: { status: wo.status, customerId: wo.customerId, vehicleId: wo.vehicleId },
      });
      if (isHistorical) {
        await this.audit.record({
          actionType: "WORK_ORDER_BACKFILLED",
          entityType: "WorkOrder",
          entityId: wo._id.toString(),
          performedByEmployeeId: performerObjectId,
          performedByRole: user?.role,
          after: {
            dateIn: dateIn || undefined,
            dateOut: dateOut || undefined,
            historicalBillAmount: historicalBillAmount ?? undefined,
            historicalCostAmount: historicalCostAmount ?? undefined,
          },
        });
      }
    }
    return wo;
  }

  async updateStatus(id: string, status: string, user: AuthUser, note?: string) {
    const allowedStatuses = new Set<WorkOrderStatusType>(Object.values(WorkOrderStatus));
    if (!allowedStatuses.has(status as WorkOrderStatusType)) {
      throw new BadRequestException("Invalid status");
    }

    const wo = await this.workOrderModel.findById(id);
    if (!wo) throw new NotFoundException("Work order not found");
    const previousStatus = wo.status;

    if (status === WorkOrderStatus.CANCELED) {
      if (wo.status === WorkOrderStatus.CLOSED) {
        throw new BadRequestException("Closed work orders cannot be canceled");
      }
      if (wo.status === WorkOrderStatus.CANCELED) {
        return wo;
      }
      const message = (note || "").trim();
      if (!message) {
        throw new BadRequestException("Cancellation note is required");
      }
      const performerId = resolveUserId(user);
      const performerObjectId = toObjectId(performerId);
      if (!performerObjectId) {
        throw new ForbiddenException("Invalid user id");
      }
      const session = await this.connection.startSession();
      session.startTransaction();
      try {
        const refreshed = await this.workOrderModel.findById(id).session(session);
        if (!refreshed) throw new NotFoundException("Work order not found");
        const partsToReturn = refreshed.partsUsed || [];
        for (const part of partsToReturn) {
          const qty = Number(part.qty) || 0;
          if (qty <= 0 || !part.partId) continue;
          const updatedPart = await this.partModel.findByIdAndUpdate(
            part.partId,
            { $inc: { onHandQty: qty } },
            { new: true, session }
          );
          if (!updatedPart) {
            throw new NotFoundException("Part not found");
          }
          const unitCost = this.decimalToNumber(part.costAtTime) || this.decimalToNumber(updatedPart?.avgCost);
          await this.trxModel.create(
            [
              {
                type: InventoryTransactionType.RETURN,
                partId: part.partId,
                qtyChange: qty,
                unitCost: this.decimalFromNumber(unitCost),
                referenceType: InventoryReferenceType.WORK_ORDER,
                referenceId: refreshed._id.toString(),
                performedByEmployeeId: performerObjectId || undefined,
                notes: `Canceled work order: ${message}`
              }
            ],
            { session }
          );
        }

        refreshed.status = WorkOrderStatus.CANCELED;
        refreshed.notes = refreshed.notes || [];
        refreshed.notes.push({
          authorId: performerObjectId,
          message: `Canceled: ${message}`,
          createdAt: new Date()
        });
        await refreshed.save({ session });

        if (performerObjectId) {
          await this.audit.record({
            actionType: "WORK_ORDER_CANCELLED",
            entityType: "WorkOrder",
            entityId: refreshed._id.toString(),
            performedByEmployeeId: performerObjectId,
            after: { status: refreshed.status, note: message }
          });
        }

        await session.commitTransaction();
        return refreshed.toJSON();
      } catch (err) {
        await session.abortTransaction();
        throw err;
      } finally {
        session.endSession();
      }
    }

    // If status is being changed to Closed, close the invoice and record payment
    if (status === WorkOrderStatus.CLOSED) {
      const invoiceData = this.buildInvoicePayload(wo);
      if (invoiceData.lineItems.length === 0) {
        throw new BadRequestException("Cannot close work order without billable items");
      }
      if (invoiceData.lineItems.length > 0) {
        const existingInvoice = await this.invoiceModel.findOne({
          workOrderId: wo._id,
        });
        if (existingInvoice) {
          // Always update invoice details and close it
          existingInvoice.lineItems = invoiceData.lineItems;
          existingInvoice.subtotal = this.decimalFromNumber(
            invoiceData.subtotal
          );
          existingInvoice.tax = this.decimalFromNumber(invoiceData.tax);
          existingInvoice.total = this.decimalFromNumber(invoiceData.total);
          existingInvoice.customerId = wo.customerId;
          existingInvoice.vehicleId = wo.vehicleId;
          existingInvoice.status = InvoiceStatus.CLOSED;
          await existingInvoice.save();
          // Update or create payment for the closed invoice
          const existingPayment = await this.paymentModel.findOne({
            invoiceId: existingInvoice._id,
          });
          const paymentAmount = this.decimalFromNumber(
            this.decimalToNumber(existingInvoice.total)
          );
          if (existingPayment) {
            // Update existing payment with new amount
            existingPayment.amount = paymentAmount;
            await existingPayment.save();
          } else {
            // Create new payment
            await this.paymentModel.create({
              invoiceId: existingInvoice._id,
              method: "CASH",
              amount: paymentAmount,
              paidAt: new Date(),
            });
          }
        } else {
          const invoiceNumber = `INV-${Date.now()}`;
          const invoice = await this.invoiceModel.create({
            invoiceNumber,
            type: InvoiceType.WORK_ORDER,
            customerId: wo.customerId,
            vehicleId: wo.vehicleId,
            workOrderId: wo._id,
            lineItems: invoiceData.lineItems,
            subtotal: this.decimalFromNumber(invoiceData.subtotal),
            tax: this.decimalFromNumber(invoiceData.tax),
            total: this.decimalFromNumber(invoiceData.total),
            status: InvoiceStatus.CLOSED,
          });
          // Record payment for the new closed invoice
          await this.paymentModel.create({
            invoiceId: invoice._id,
            method: "CASH",
            amount: this.decimalFromNumber(invoiceData.total),
            paidAt: new Date(),
          });
        }
      }
    }

    wo.status = status;
    if (status === WorkOrderStatus.CLOSED && previousStatus !== WorkOrderStatus.CLOSED) {
      wo.deliveredAt = new Date();
    } else if (status !== WorkOrderStatus.CLOSED && previousStatus === WorkOrderStatus.CLOSED) {
      wo.deliveredAt = null;
    }
    await wo.save();
    const performerId = resolveUserId(user);
    const performerObjectId = toObjectId(performerId);
    if (performerObjectId) {
      await this.audit.record({
        actionType: "WORK_ORDER_STATUS_UPDATE",
        entityType: "WorkOrder",
        entityId: wo._id.toString(),
        performedByEmployeeId: performerObjectId,
        after: { status, deliveredAt: wo.deliveredAt },
      });
    }
    return wo;
  }

  async updateBilling(
    id: string,
    payload: {
      billableLaborAmount?: number;
      otherCharges?: { name: string; amount: number; costAtTime?: number }[];
      servicesUsed?: BillingServiceLineInput[];
      paymentMethod?: string;
    },
    user: AuthUser
  ) {
    const wo = await this.workOrderModel.findById(id);
    if (!wo) throw new NotFoundException("Work order not found");
    const canEditBilling = user.permissions?.includes(Permissions.WORKORDERS_BILLING_EDIT);
    if (!canEditBilling) {
      throw new ForbiddenException("No permission to edit billing");
    }

    if (payload.billableLaborAmount !== undefined) {
      const labor = Number(payload.billableLaborAmount);
      if (!Number.isFinite(labor) || labor < 0) {
        throw new BadRequestException(
          "Billable labor must be a non-negative number"
        );
      }
      wo.billableLaborAmount = this.decimalFromNumber(labor);
    }

    if (payload.otherCharges) {
      const normalized = payload.otherCharges
        .filter(
          (c) =>
            c &&
            (c.name?.trim() || c.amount !== undefined || c.costAtTime !== undefined)
        )
        .map((charge) => {
          const amount = Number(charge.amount);
          const costAtTime = Number(charge.costAtTime ?? 0);
          if (!Number.isFinite(amount) || amount < 0) {
            throw new BadRequestException(
              "Charge amount must be a non-negative number"
            );
          }
          if (!Number.isFinite(costAtTime) || costAtTime < 0) {
            throw new BadRequestException(
              "Charge cost must be a non-negative number"
            );
          }
          return {
            name: charge.name?.trim() || "Charge",
            amount: this.decimalFromNumber(amount),
            costAtTime: this.decimalFromNumber(costAtTime),
          };
        });
      wo.otherCharges = normalized;
    }

    if (payload.servicesUsed) {
      const lines = payload.servicesUsed.filter((line) => line && line.serviceId);
      const serviceIds = lines.map((line) => line.serviceId).filter(Boolean);
      const serviceDocs = serviceIds.length
        ? await this.serviceModel.find({ _id: { $in: serviceIds } }).lean()
        : [];
      const serviceMap = new Map(serviceDocs.map((doc) => [doc._id.toString(), doc]));
      const normalizedServices = lines.map((line) => {
        const serviceId = String(line.serviceId);
        const serviceDoc = serviceMap.get(serviceId);
        if (!serviceDoc) {
          throw new BadRequestException(`Service not found: ${serviceId}`);
        }
        const qty = Number(line.qty ?? 1);
        if (!Number.isFinite(qty) || qty <= 0) {
          throw new BadRequestException("Service qty must be greater than zero");
        }
        const unitPrice = line.unitPriceAtTime !== undefined
          ? Number(line.unitPriceAtTime)
          : this.decimalToNumber(serviceDoc.defaultPrice);
        const unitCost = line.unitCostAtTime !== undefined
          ? Number(line.unitCostAtTime)
          : this.decimalToNumber(serviceDoc.defaultCost);
        if (!Number.isFinite(unitPrice) || unitPrice < 0) {
          throw new BadRequestException("Service unit price must be a non-negative number");
        }
        if (!Number.isFinite(unitCost) || unitCost < 0) {
          throw new BadRequestException("Service unit cost must be a non-negative number");
        }
        return {
          serviceId: new Types.ObjectId(serviceId),
          nameAtTime: line.nameAtTime?.trim() || serviceDoc.name,
          qty,
          unitPriceAtTime: this.decimalFromNumber(unitPrice),
          unitCostAtTime: this.decimalFromNumber(unitCost),
        };
      });
      wo.servicesUsed = normalizedServices;
    }

    const preAdvanceFinancials = this.computeFinancials(wo);
    const advanceReceived = Math.max(
      0,
      this.decimalToNumber((wo as WorkOrder & { advanceAmount?: Types.Decimal128 }).advanceAmount || 0)
    );
    const autoApplied = Math.min(advanceReceived, preAdvanceFinancials.total);
    wo.advanceAppliedAmount = this.decimalFromNumber(autoApplied);

    const hasBillingActivity =
      payload.billableLaborAmount !== undefined ||
      payload.servicesUsed !== undefined ||
      payload.otherCharges !== undefined;
    if (hasBillingActivity && wo.status === WorkOrderStatus.SCHEDULED) {
      wo.status = WorkOrderStatus.IN_PROGRESS;
    }

    await wo.save();
    const financials = this.computeFinancials(wo);
    const performerId = resolveUserId(user);
    const performerObjectId = toObjectId(performerId);
    if (performerObjectId) {
      await this.audit.record({
        actionType: "WORK_ORDER_BILLING_UPDATE",
        entityType: "WorkOrder",
        entityId: wo._id.toString(),
        performedByEmployeeId: performerObjectId,
        after: {
          billableLaborAmount: financials.labor,
          otherCharges: wo.otherCharges,
          advanceAmount: financials.advanceReceived,
          advanceAppliedAmount: financials.advanceApplied,
          amountDue: financials.amountDue,
        },
      });
    }

    // Billing submission closes/updates invoice and marks work order closed.
    if (wo.status !== WorkOrderStatus.CANCELED) {
      const invoiceData = this.buildInvoicePayload(wo);
      if (invoiceData.lineItems.length > 0) {
        // Upsert invoice
        let invoice = await this.invoiceModel.findOne({ workOrderId: wo._id });
        if (invoice) {
          invoice.lineItems = invoiceData.lineItems;
          invoice.subtotal = this.decimalFromNumber(invoiceData.subtotal);
          invoice.tax = this.decimalFromNumber(invoiceData.tax);
          invoice.total = this.decimalFromNumber(invoiceData.total);
          invoice.customerId = wo.customerId;
          invoice.vehicleId = wo.vehicleId;
          invoice.status = InvoiceStatus.CLOSED;
          await invoice.save();
        } else {
          invoice = await this.invoiceModel.create({
            invoiceNumber: `INV-${Date.now()}`,
            type: InvoiceType.WORK_ORDER,
            customerId: wo.customerId,
            vehicleId: wo.vehicleId,
            workOrderId: wo._id,
            lineItems: invoiceData.lineItems,
            subtotal: this.decimalFromNumber(invoiceData.subtotal),
            tax: this.decimalFromNumber(invoiceData.tax),
            total: this.decimalFromNumber(invoiceData.total),
            status: InvoiceStatus.CLOSED,
          });
        }

        // Ensure payment recorded for closed invoice
        const paymentAmount = this.decimalFromNumber(financials.amountDue);
        const paymentMethod = payload.paymentMethod?.toUpperCase() || "CASH";
        let payment = await this.paymentModel.findOne({ invoiceId: invoice._id });
        if (payment) {
          payment.amount = paymentAmount;
          payment.method = paymentMethod;
          payment.paidAt = new Date();
          await payment.save();
        } else {
          payment = await this.paymentModel.create({
            invoiceId: invoice._id,
            method: paymentMethod,
            amount: paymentAmount,
            paidAt: new Date(),
          });
        }

        if (wo.status !== WorkOrderStatus.CLOSED) {
          wo.status = WorkOrderStatus.CLOSED;
          wo.deliveredAt = new Date();
          await wo.save();
          if (performerObjectId) {
            await this.audit.record({
              actionType: "WORK_ORDER_BILLING_SUBMIT",
              entityType: "WorkOrder",
              entityId: wo._id.toString(),
              performedByEmployeeId: performerObjectId,
              after: {
                status: wo.status,
                invoiceId: invoice._id.toString(),
                paymentId: payment._id.toString(),
              },
            });
          }
        }
      }
    }

    return { workOrder: wo.toJSON(), financials };
  }

  async assign(
    id: string,
    employees: { employeeId: string; roleType: string }[],
    performedBy: string
  ) {
    const wo = await this.workOrderModel.findById(id);
    if (!wo) throw new NotFoundException("Work order not found");
    wo.assignedEmployees = employees.map((e) => ({
      employeeId: new Types.ObjectId(e.employeeId),
      roleType: e.roleType,
    }));
    if (wo.status === WorkOrderStatus.SCHEDULED && employees.length > 0) {
      wo.status = WorkOrderStatus.IN_PROGRESS;
    }
    await wo.save();
    const performerObjectId = performedBy ? toObjectId(performedBy) : null;
    if (performerObjectId) {
      await this.audit.record({
        actionType: "WORK_ORDER_ASSIGN",
        entityType: "WorkOrder",
        entityId: wo._id.toString(),
        performedByEmployeeId: performerObjectId,
        after: { assignedEmployees: employees, status: wo.status },
      });
    }
    return wo;
  }

  async listAssignableEmployees() {
    const allowedRoles = [
      "SERVICE_ADVISOR",
      "OPS_MANAGER",
      "OWNER_ADMIN",
      "INVENTORY_MANAGER",
    ];
    return this.userModel
      .find({ role: { $in: allowedRoles }, isActive: true })
      .select("_id name email role")
      .lean();
  }

  async issuePart(params: {
    workOrderId: string;
    partId: string;
    qty: number;
    performedBy: string;
    idempotencyKey?: string;
  }) {
    if (!Number.isInteger(params.qty) || params.qty <= 0) {
      throw new BadRequestException("qty must be a positive integer");
    }
    const existing = params.idempotencyKey
      ? await this.trxModel.findOne({ idempotencyKey: params.idempotencyKey })
      : null;
    if (existing) {
      const workOrderExisting = await this.workOrderModel.findById(
        params.workOrderId
      );
      return { workOrder: workOrderExisting, transaction: existing };
    }
    const isTransient = (err: unknown) => {
      const maybe = err as {
        name?: string;
        code?: number;
        errorLabels?: unknown;
        message?: string;
      };
      return (
        maybe?.name === "MongoServerError" ||
        maybe?.code === 112 ||
        (Array.isArray(maybe?.errorLabels) &&
          maybe.errorLabels.includes("TransientTransactionError")) ||
        /lock/i.test(maybe?.message || "")
      );
    };

    const maxAttempts = 8;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const session = await this.connection.startSession();
      session.startTransaction();
      try {
        const wo = await this.workOrderModel
          .findById(params.workOrderId)
          .session(session);
        if (!wo) throw new NotFoundException("Work order not found");
        const part = await this.partModel.findOneAndUpdate(
          {
            _id: params.partId,
            $expr: {
              $gte: [
                {
                  $subtract: [
                    { $ifNull: ["$onHandQty", 0] },
                    { $ifNull: ["$reservedQty", 0] },
                  ],
                },
                params.qty,
              ],
            },
          },
          { $inc: { onHandQty: -Math.abs(params.qty) } },
          { new: true, session }
        );
        if (!part) throw new InsufficientStockException();

        const sellingPriceNum = this.decimalToNumber(part.sellingPrice);
        const avgCostNum = this.decimalToNumber(part.avgCost);

        wo.partsUsed.push({
          partId: part._id,
          qty: params.qty,
          sellingPriceAtTime: this.decimalFromNumber(sellingPriceNum),
          costAtTime: this.decimalFromNumber(avgCostNum),
        });
        if (wo.status === WorkOrderStatus.SCHEDULED) {
          wo.status = WorkOrderStatus.IN_PROGRESS;
        }
        await wo.save({ session });

        const trx = await this.trxModel.create(
          [
            {
              type: InventoryTransactionType.ISSUE_TO_WORK_ORDER,
              partId: part._id,
              qtyChange: -Math.abs(params.qty),
              unitCost: this.decimalFromNumber(avgCostNum),
              unitPrice: this.decimalFromNumber(sellingPriceNum),
              referenceType: InventoryReferenceType.WORK_ORDER,
              referenceId: wo._id.toString(),
              performedByEmployeeId: new Types.ObjectId(params.performedBy),
              idempotencyKey: params.idempotencyKey,
            },
          ],
          { session }
        );

        await this.audit.record({
          actionType: "ISSUE_PART_TO_WORK_ORDER",
          entityType: "WorkOrder",
          entityId: wo._id.toString(),
          performedByEmployeeId: new Types.ObjectId(params.performedBy),
          after: { partId: part._id.toString(), qty: params.qty },
        });

        await session.commitTransaction();
        session.endSession();
        return { workOrder: wo, transaction: trx[0] };
      } catch (err: unknown) {
        await session.abortTransaction();
        session.endSession();
        if (isTransient(err) && attempt < maxAttempts - 1) {
          await new Promise((resolve) => setTimeout(resolve, 20));
          continue;
        }
        throw err;
      }
    }
    throw new InsufficientStockException();
  }

  async createTimeLog(params: {
    workOrderId: string;
    employeeId: string;
    clockInAt: string;
    clockOutAt?: string;
  }) {
    const wo = await this.workOrderModel.findById(params.workOrderId);
    if (!wo) throw new NotFoundException("Work order not found");
    const clockInAt = new Date(params.clockInAt);
    const clockOutAt = params.clockOutAt
      ? new Date(params.clockOutAt)
      : undefined;
    const durationMinutes = clockOutAt
      ? Math.round((clockOutAt.getTime() - clockInAt.getTime()) / 60000)
      : undefined;
    const log = await this.timeLogModel.create({
      workOrderId: wo._id,
      employeeId: new Types.ObjectId(params.employeeId),
      clockInAt,
      clockOutAt,
      durationMinutes,
    });
    if (wo.status === WorkOrderStatus.SCHEDULED) {
      wo.status = WorkOrderStatus.IN_PROGRESS;
      await wo.save();
    }
    await this.audit.record({
      actionType: "TIME_LOG",
      entityType: "WorkOrder",
      entityId: wo._id.toString(),
      performedByEmployeeId: new Types.ObjectId(params.employeeId),
      after: { durationMinutes, workOrderStatus: wo.status },
    });
    return log;
  }

  async clockIn(workOrderId: string, user: AuthUser) {
    const wo = await this.workOrderModel.findById(workOrderId);
    if (!wo) throw new NotFoundException("Work order not found");
    const canCreate =
      user.permissions?.includes(Permissions.TIMELOGS_CREATE_SELF) ||
      user.permissions?.includes(Permissions.TIMELOGS_READ_ALL);
    if (!canCreate) throw new ForbiddenException("No permission to clock in");
    const userId = resolveUserId(user);
    const userObjectId = toObjectId(userId);
    if (!userObjectId) throw new ForbiddenException("Invalid user id");
    const assignedIds =
      wo.assignedEmployees?.map((a) => a.employeeId.toString()) || [];
    if (
      !assignedIds.includes(userId) &&
      !user.permissions?.includes(Permissions.TIMELOGS_READ_ALL)
    ) {
      throw new ForbiddenException("Not assigned");
    }
    const open = await this.timeLogModel.findOne({
      workOrderId: wo._id,
      employeeId: userObjectId,
      $or: [{ clockOutAt: { $exists: false } }, { clockOutAt: null }],
    });
    if (open) throw new ForbiddenException("Already clocked in");
    const log = await this.timeLogModel.create({
      workOrderId: wo._id,
      employeeId: userObjectId,
      clockInAt: new Date(),
    });

    // Auto-update work order status to IN_PROGRESS when clocking in
    if (wo.status === WorkOrderStatus.SCHEDULED) {
      wo.status = WorkOrderStatus.IN_PROGRESS;
      await wo.save();
    }

    await this.audit.record({
      actionType: "TIMELOG_CLOCK_IN",
      entityType: "WorkOrder",
      entityId: wo._id.toString(),
      performedByEmployeeId: userObjectId,
      after: { clockInAt: log.clockInAt, workOrderStatus: wo.status },
    });
    return log;
  }

  async clockOut(workOrderId: string, user: AuthUser) {
    const wo = await this.workOrderModel.findById(workOrderId);
    if (!wo) throw new NotFoundException("Work order not found");
    const canCreate =
      user.permissions?.includes(Permissions.TIMELOGS_CREATE_SELF) ||
      user.permissions?.includes(Permissions.TIMELOGS_READ_ALL);
    if (!canCreate) throw new ForbiddenException("No permission to clock out");
    const userId = resolveUserId(user);
    const userObjectId = toObjectId(userId);
    if (!userObjectId) throw new ForbiddenException("Invalid user id");
    const assignedIds =
      wo.assignedEmployees?.map((a) => a.employeeId.toString()) || [];
    if (
      !assignedIds.includes(userId) &&
      !user.permissions?.includes(Permissions.TIMELOGS_READ_ALL)
    ) {
      throw new ForbiddenException("Not assigned");
    }
    const open = await this.timeLogModel.findOne({
      workOrderId: wo._id,
      employeeId: userObjectId,
      $or: [{ clockOutAt: { $exists: false } }, { clockOutAt: null }],
    });
    if (!open) throw new ForbiddenException("No active clock-in");
    open.clockOutAt = new Date();
    open.durationMinutes = Math.max(
      0,
      Math.round((open.clockOutAt.getTime() - open.clockInAt.getTime()) / 60000)
    );
    await open.save();

    // Keep active work orders in progress while time logging.
    if (
      wo.status === WorkOrderStatus.SCHEDULED
    ) {
      wo.status = WorkOrderStatus.IN_PROGRESS;
      await wo.save();
    }

    await this.audit.record({
      actionType: "TIMELOG_CLOCK_OUT",
      entityType: "WorkOrder",
      entityId: wo._id.toString(),
      performedByEmployeeId: userObjectId,
      after: {
        durationMinutes: open.durationMinutes,
        workOrderStatus: wo.status,
      },
    });
    return open;
  }

  async listTimeLogs(workOrderId: string) {
    return this.timeLogModel.find({ workOrderId }).exec();
  }

  async addNote(params: {
    workOrderId: string;
    authorId: string;
    message: string;
  }) {
    const wo = await this.workOrderModel.findById(params.workOrderId);
    if (!wo) throw new NotFoundException("Work order not found");
    wo.notes = wo.notes || [];
    wo.notes.push({
      authorId: new Types.ObjectId(params.authorId),
      message: params.message,
      createdAt: new Date(),
    });
    if (wo.status === WorkOrderStatus.SCHEDULED) {
      wo.status = WorkOrderStatus.IN_PROGRESS;
    }
    await wo.save();
    await this.audit.record({
      actionType: "NOTE_ADDED",
      entityType: "WorkOrder",
      entityId: wo._id.toString(),
      performedByEmployeeId: new Types.ObjectId(params.authorId),
      after: { message: params.message, workOrderStatus: wo.status },
    });
    return wo.notes;
  }

  async takePayment(
    id: string,
    payment: { method: string; amount: number },
    user: AuthUser
  ) {
    const wo = await this.workOrderModel.findById(id);
    if (!wo) throw new NotFoundException("Work order not found");

    // Only allow payment if work order is CLOSED
    if (wo.status !== WorkOrderStatus.CLOSED) {
      throw new BadRequestException(
        `Work order must be CLOSED to take payment. Current status: ${wo.status}`
      );
    }

    // Get the invoice for this work order
    const invoice = await this.invoiceModel.findOne({ workOrderId: wo._id });
    if (!invoice) {
      throw new NotFoundException("No invoice found for this work order");
    }

    if (invoice.status === InvoiceStatus.CLOSED) {
      throw new BadRequestException("Invoice already closed");
    }

    const session = await this.connection.startSession();
    session.startTransaction();
    try {
      // Close the invoice
      invoice.status = InvoiceStatus.CLOSED;
      await invoice.save({ session });

      // Record the payment
      const paymentAmount = this.decimalFromNumber(payment.amount);
      const paymentRecord = await this.paymentModel.create(
        [
          {
            invoiceId: invoice._id,
            method: payment.method,
            amount: paymentAmount,
            paidAt: new Date(),
          },
        ],
        { session }
      );

      // Audit the payment
      const performerId = resolveUserId(user);
      const performerObjectId = toObjectId(performerId);
      if (performerObjectId) {
        await this.audit.record({
          actionType: "WORK_ORDER_PAYMENT",
          entityType: "WorkOrder",
          entityId: wo._id.toString(),
          performedByEmployeeId: performerObjectId,
          after: {
            payment: paymentRecord[0].toObject(),
            status: WorkOrderStatus.CLOSED,
          },
        });
      }

      await session.commitTransaction();
      return { workOrder: wo, invoice, payment: paymentRecord[0] };
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      session.endSession();
    }
  }
}
