import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectConnection, InjectModel } from "@nestjs/mongoose";
import { ClientSession, Connection, Model, Types } from "mongoose";
import {
  WorkOrderStatus,
  Permissions,
  InventoryReferenceType,
  InventoryTransactionType,
  InvoiceType,
  InvoiceStatus,
  WorkOrderStatusType,
  PaymentType,
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
  workOrderNumber?: string;
  historicalBillAmount?: number;
  historicalCostAmount?: number;
  historicalPaidAmount?: number;
  historicalInvoiceStatus?: string;
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
    if (
      typeof val === "object" &&
      val !== null &&
      "$numberDecimal" in (val as unknown as Record<string, unknown>)
    ) {
      const parsed = Number(
        (val as unknown as { $numberDecimal?: string }).$numberDecimal || 0
      );
      return Number.isFinite(parsed) ? parsed : 0;
    }
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
    const { labor, partsTotal, servicesTotal, otherTotal, subtotal, tax, total } =
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
      servicesTotal,
      otherTotal,
      subtotal,
      tax,
      total,
    };
  }

  private isOwnerAdmin(user?: AuthUser) {
    return String(user?.role || "") === Roles.OWNER_ADMIN;
  }

  private isFinalizedInvoiceStatus(status?: string) {
    return (
      status === InvoiceStatus.PARTIALLY_PAID ||
      status === InvoiceStatus.PAID ||
      status === InvoiceStatus.VOID
    );
  }

  private normalizeWorkOrderNumber(value?: string) {
    return (value || "").trim();
  }

  private async generateWorkOrderNumber(candidate?: string, excludeId?: string) {
    const requested = this.normalizeWorkOrderNumber(candidate);
    if (requested) {
      const existing = await this.workOrderModel.findOne({
        workOrderNumber: requested,
        ...(excludeId ? { _id: { $ne: excludeId } } : {}),
      });
      if (existing) {
        throw new BadRequestException("Work order number already exists");
      }
      return requested;
    }

    for (let attempt = 0; attempt < 20; attempt++) {
      const generated = `WO-${Date.now().toString().slice(-8)}-${Math.floor(
        100 + Math.random() * 900
      )}`;
      const exists = await this.workOrderModel.findOne({
        workOrderNumber: generated,
      });
      if (!exists) {
        return generated;
      }
    }

    throw new BadRequestException("Unable to generate unique work order number");
  }

  private async sumInvoicePayments(invoiceId: Types.ObjectId, session?: ClientSession) {
    const payments = await this.paymentModel
      .find({ invoiceId })
      .session(session || null)
      .sort({ paidAt: -1, createdAt: -1 })
      .exec();
    const totalPaid = payments.reduce((sum, payment: any) => {
      if (payment.isVoided) return sum;
      const amount = this.decimalToNumber(payment.amount);
      return payment.paymentType === PaymentType.REFUND ? sum - amount : sum + amount;
    }, 0);
    return { payments, totalPaid };
  }

  private async syncInvoiceBalances(
    invoice: any,
    wo: WorkOrder,
    session?: ClientSession,
    opts?: { forceStatus?: string }
  ) {
    const { totalPaid } = await this.sumInvoicePayments(
      invoice._id as Types.ObjectId,
      session
    );
    const financials = this.computeFinancials(wo);
    const effectivePaid = financials.advanceApplied + totalPaid;
    const outstandingAmount = Math.max(financials.total - effectivePaid, 0);

    invoice.totalPaid = this.decimalFromNumber(totalPaid);
    invoice.outstandingAmount = this.decimalFromNumber(outstandingAmount);

    if (opts?.forceStatus) {
      invoice.status = opts.forceStatus;
      if (opts.forceStatus === InvoiceStatus.ISSUED && !invoice.issuedAt) {
        invoice.issuedAt = new Date();
      }
    } else if (invoice.status !== InvoiceStatus.VOID) {
      if (outstandingAmount <= 0 && financials.total > 0) {
        invoice.status = InvoiceStatus.PAID;
      } else if (invoice.status !== InvoiceStatus.DRAFT) {
        invoice.status = totalPaid > 0 || financials.advanceApplied > 0
          ? InvoiceStatus.PARTIALLY_PAID
          : InvoiceStatus.ISSUED;
      }
      if (
        (invoice.status === InvoiceStatus.ISSUED ||
          invoice.status === InvoiceStatus.PARTIALLY_PAID ||
          invoice.status === InvoiceStatus.PAID) &&
        !invoice.issuedAt
      ) {
        invoice.issuedAt = new Date();
      }
      if (!invoice.dueDate && (invoice.issuedAt || invoice.createdAt)) {
        invoice.dueDate = invoice.issuedAt || invoice.createdAt;
      }
    }

    await (invoice as unknown as { save: (args?: { session?: ClientSession }) => Promise<unknown> }).save(
      session ? { session } : undefined
    );

    return {
      totalPaid,
      outstandingAmount,
      overpayment: Math.max(effectivePaid - financials.total, 0),
      advanceApplied: financials.advanceApplied,
    };
  }

  private async upsertInvoiceForWorkOrder(
    wo: any,
    session?: ClientSession,
    opts?: { issue?: boolean }
  ) {
    const invoiceData = this.buildInvoicePayload(wo);
    if (invoiceData.lineItems.length === 0) {
      throw new BadRequestException("Cannot create invoice without billable items");
    }

    let invoice = await this.invoiceModel
      .findOne({ workOrderId: wo._id })
      .session(session || null);

    if (invoice) {
      invoice.lineItems = invoiceData.lineItems;
      invoice.subtotal = this.decimalFromNumber(invoiceData.subtotal);
      invoice.tax = this.decimalFromNumber(invoiceData.tax);
      invoice.total = this.decimalFromNumber(invoiceData.total);
      invoice.customerId = wo.customerId;
      invoice.vehicleId = wo.vehicleId;
      if (opts?.issue && invoice.status === InvoiceStatus.DRAFT) {
        invoice.status = InvoiceStatus.ISSUED;
        invoice.issuedAt = invoice.issuedAt || new Date();
      }
      await (invoice as unknown as { save: (args?: { session?: ClientSession }) => Promise<unknown> }).save(
        session ? { session } : undefined
      );
    } else {
      invoice = await this.invoiceModel.create(
        [
          {
            invoiceNumber: `INV-${Date.now()}`,
            type: InvoiceType.WORK_ORDER,
            customerId: wo.customerId,
            vehicleId: wo.vehicleId,
            workOrderId: wo._id,
            lineItems: invoiceData.lineItems,
            subtotal: this.decimalFromNumber(invoiceData.subtotal),
            tax: this.decimalFromNumber(invoiceData.tax),
            total: this.decimalFromNumber(invoiceData.total),
            status: opts?.issue ? InvoiceStatus.ISSUED : InvoiceStatus.DRAFT,
            issuedAt: opts?.issue ? new Date() : undefined,
          },
        ],
        session ? { session } : undefined
      ).then((docs) => docs[0]);
    }

    const settlement = await this.syncInvoiceBalances(
      invoice,
      wo,
      session,
      opts?.issue && invoice && invoice.status === InvoiceStatus.DRAFT
        ? { forceStatus: InvoiceStatus.ISSUED }
        : undefined
    );

    return { invoice, invoiceData, settlement };
  }

  private async createPaymentForInvoice(
    invoice: any,
    wo: WorkOrder,
    payment: { amount: number; method: string; note?: string; paymentType?: string },
    session?: ClientSession
  ) {
    const amount = Number(payment.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException("Payment amount must be greater than zero");
    }

    const paymentRecord = await this.paymentModel.create(
      [
        {
          invoiceId: invoice._id,
          paymentType: payment.paymentType || PaymentType.INVOICE_PAYMENT,
          method: payment.method,
          amount: this.decimalFromNumber(amount),
          paidAt: new Date(),
          note: payment.note,
        },
      ],
      session ? { session } : undefined
    ).then((docs) => docs[0]);

    const settlement = await this.syncInvoiceBalances(
      invoice,
      wo,
      session
    );

    return { payment: paymentRecord, settlement };
  }

  async list(user: AuthUser, query: { status?: string } = {}) {
    const userId = resolveUserId(user);
    const userObjectId = toObjectId(userId);
    const baseFilter: Record<string, unknown> = {};
    if (query.status) baseFilter.status = query.status;
    let items: any[] = [];

    // Check for READ_ALL permission first
    if (user.permissions?.includes(Permissions.WORKORDERS_READ_ALL)) {
      items = await this.workOrderModel.find(baseFilter).sort({ createdAt: -1 }).lean().exec();
    }
    else if (user.permissions?.includes(Permissions.WORKORDERS_READ_ASSIGNED)) {
      if (!userObjectId) {
        throw new ForbiddenException("Invalid user id");
      }

      // If no status filter, default to excluding closed/canceled
      if (!query.status) {
        items = await this.workOrderModel
          .find({
            "assignedEmployees.employeeId": userObjectId,
            status: { $nin: [WorkOrderStatus.CLOSED, WorkOrderStatus.CANCELED] },
          })
          .sort({ createdAt: -1 })
          .lean()
          .exec();
      }
      else {
        items = await this.workOrderModel
        .find({
          "assignedEmployees.employeeId": userObjectId,
          status: query.status,
        })
        .sort({ createdAt: -1 })
        .lean()
        .exec();
      }
    } else {
      throw new ForbiddenException("No access to work orders");
    }

    const customerIds = Array.from(
      new Set(items.map((item) => item.customerId?.toString()).filter(Boolean))
    );
    const vehicleIds = Array.from(
      new Set(items.map((item) => item.vehicleId?.toString()).filter(Boolean))
    );
    const workOrderIds = items.map((item) => item._id);

    const [customers, vehicles, invoices] = await Promise.all([
      customerIds.length
        ? this.customerModel.find({ _id: { $in: customerIds } }).select("name phone").lean().exec()
        : Promise.resolve([]),
      vehicleIds.length
        ? this.vehicleModel.find({ _id: { $in: vehicleIds } }).select("make model plate").lean().exec()
        : Promise.resolve([]),
      workOrderIds.length
        ? this.invoiceModel
            .find({ workOrderId: { $in: workOrderIds } })
            .select("workOrderId invoiceNumber status total totalPaid outstandingAmount")
            .lean()
            .exec()
        : Promise.resolve([]),
    ]);

    const customerMap = new Map(customers.map((customer: any) => [customer._id.toString(), customer]));
    const vehicleMap = new Map(vehicles.map((vehicle: any) => [vehicle._id.toString(), vehicle]));
    const invoiceMap = new Map(
      invoices.map((invoice: any) => [
        invoice.workOrderId.toString(),
        {
          invoiceNumber: invoice.invoiceNumber,
          status: invoice.status,
          total: this.decimalToNumber(invoice.total),
          totalPaid: this.decimalToNumber(invoice.totalPaid),
          outstandingAmount: this.decimalToNumber(invoice.outstandingAmount),
        },
      ])
    );

    return items.map((item) => ({
      ...item,
      customer: item.customerId ? customerMap.get(item.customerId.toString()) : undefined,
      vehicle: item.vehicleId ? vehicleMap.get(item.vehicleId.toString()) : undefined,
      invoice: invoiceMap.get(item._id.toString()),
    }));
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
    const relatedVisits = await this.workOrderModel
      .find({
        $or: [{ customerId: wo.customerId }, { vehicleId: wo.vehicleId }],
      })
      .select("customerId vehicleId deliveredAt dateIn createdAt")
      .lean();
    const visitAnchor = (entry: {
      deliveredAt?: Date | string | null;
      dateIn?: Date | string | null;
      createdAt?: Date | string | null;
    }) => entry.deliveredAt || entry.dateIn || entry.createdAt || null;
    const vehicleVisits = relatedVisits.filter(
      (entry) => normalizeId(entry.vehicleId) === normalizeId(wo.vehicleId)
    );
    const customerVisits = relatedVisits.filter(
      (entry) => normalizeId(entry.customerId) === normalizeId(wo.customerId)
    );
    const vehicleDates = vehicleVisits
      .map((entry) => visitAnchor(entry))
      .filter(Boolean)
      .map((entry) => new Date(entry as Date | string))
      .sort((a, b) => a.getTime() - b.getTime());
    const customerVehicleIds = new Set(
      customerVisits.map((entry) => normalizeId(entry.vehicleId)).filter(Boolean)
    );

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
      .lean();
    const payments = invoice
      ? await this.paymentModel.find({ invoiceId: invoice._id }).sort({ paidAt: -1, createdAt: -1 }).lean()
      : [];

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
      payments,
      isAssigned,
      audit: {
        createdBy: toAuditActor(createdEntry),
        billedBy: toAuditActor(billingSubmitEntry),
        billingUpdatedBy: toAuditActor(billingUpdateEntry)
      },
      auditTrail,
      visitSummary: {
        vehicleVisitCount: vehicleVisits.length,
        vehicleFirstVisit: vehicleDates[0]?.toISOString(),
        vehicleLastVisit: vehicleDates[vehicleDates.length - 1]?.toISOString(),
        customerVisitCount: customerVisits.length,
        customerDistinctVehicles: customerVehicleIds.size,
      },
      financials: {
        ...this.computeFinancials(wo as WorkOrder),
        totalPaid: invoice ? this.decimalToNumber((invoice as { totalPaid?: Types.Decimal128 }).totalPaid || 0) : 0,
        outstandingAmount: invoice
          ? this.decimalToNumber((invoice as { outstandingAmount?: Types.Decimal128 }).outstandingAmount || 0)
          : this.computeFinancials(wo as WorkOrder).amountDue,
        overpayment: invoice
          ? Math.max(
              this.computeFinancials(wo as WorkOrder).advanceApplied +
                payments.reduce((sum, payment) => sum + this.decimalToNumber((payment as { amount?: Types.Decimal128 }).amount || 0), 0) -
                this.computeFinancials(wo as WorkOrder).total,
              0
            )
          : 0,
      },
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
    const historicalPaidAmountRaw = payload.historicalPaidAmount;
    const historicalInvoiceStatusRaw = payload.historicalInvoiceStatus;
    const historicalBillAmount =
      historicalBillAmountRaw === undefined || historicalBillAmountRaw === null
        ? null
        : Number(historicalBillAmountRaw);
    const historicalCostAmount =
      historicalCostAmountRaw === undefined || historicalCostAmountRaw === null
        ? null
        : Number(historicalCostAmountRaw);
    const historicalPaidAmount =
      historicalPaidAmountRaw === undefined || historicalPaidAmountRaw === null
        ? null
        : Number(historicalPaidAmountRaw);
    if (historicalBillAmount !== null && (!Number.isFinite(historicalBillAmount) || historicalBillAmount < 0)) {
      throw new BadRequestException("Historical bill amount must be a non-negative number");
    }
    if (historicalCostAmount !== null && (!Number.isFinite(historicalCostAmount) || historicalCostAmount < 0)) {
      throw new BadRequestException("Historical cost amount must be a non-negative number");
    }
    if ((historicalCostAmount || 0) > 0 && (historicalBillAmount || 0) <= 0) {
      throw new BadRequestException("Historical bill amount is required when cost is provided");
    }
    if (historicalPaidAmount !== null && (!Number.isFinite(historicalPaidAmount) || historicalPaidAmount < 0)) {
      throw new BadRequestException("Historical paid amount must be a non-negative number");
    }
    if (historicalPaidAmount !== null && historicalBillAmount !== null && historicalPaidAmount > historicalBillAmount) {
      throw new BadRequestException("Historical paid amount cannot exceed bill amount");
    }

    const historicalInvoiceStatus = typeof historicalInvoiceStatusRaw === "string"
      ? historicalInvoiceStatusRaw.trim().toUpperCase()
      : "";
    if (
      historicalInvoiceStatus &&
      !(
        [
          InvoiceStatus.DRAFT,
          InvoiceStatus.ISSUED,
          InvoiceStatus.PARTIALLY_PAID,
          InvoiceStatus.PAID,
          InvoiceStatus.VOID,
        ] as string[]
      ).includes(historicalInvoiceStatus)
    ) {
      throw new BadRequestException("Invalid historical invoice status");
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
      workOrderNumber: await this.generateWorkOrderNumber(payload.workOrderNumber),
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

    if (
      user &&
      (requestedStatus === WorkOrderStatus.CLOSED ||
        historicalBillAmount !== null ||
        historicalPaidAmount !== null)
    ) {
      const shouldIssue =
        historicalInvoiceStatus === InvoiceStatus.ISSUED ||
        historicalInvoiceStatus === InvoiceStatus.PARTIALLY_PAID ||
        historicalInvoiceStatus === InvoiceStatus.PAID ||
        requestedStatus === WorkOrderStatus.CLOSED;

      await this.updateBilling(
        wo._id.toString(),
        {
          paymentMethod: payload.paymentMethod || "CASH",
          issueInvoice: shouldIssue,
          closeWorkOrder: requestedStatus === WorkOrderStatus.CLOSED,
          paymentAmount:
            historicalPaidAmount ??
            (requestedStatus === WorkOrderStatus.CLOSED &&
            historicalBillAmount !== null &&
            !historicalInvoiceStatus
              ? historicalBillAmount
              : undefined),
        },
        user
      );

      if (historicalInvoiceStatus) {
        const invoice = await this.invoiceModel.findOne({ workOrderId: wo._id });
        if (invoice) {
          invoice.status = historicalInvoiceStatus;
          if (historicalInvoiceStatus === InvoiceStatus.VOID) {
            invoice.voidedAt = dateOut || new Date();
          }
          await invoice.save();
        }
      }

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

    // Closing a work order requires the invoice to be fully settled.
    if (status === WorkOrderStatus.CLOSED) {
      const { lineItems } = this.buildInvoicePayload(wo);
      if (lineItems.length === 0) {
        throw new BadRequestException("Cannot close work order without billable items");
      }
      const { settlement } = await this.upsertInvoiceForWorkOrder(wo, undefined, { issue: true });
      if (Number(settlement.outstandingAmount || 0) > 0) {
        throw new BadRequestException("Full payment is required before closing this work order");
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
      paymentAmount?: number;
      issueInvoice?: boolean;
      closeWorkOrder?: boolean;
    },
    user: AuthUser
  ) {
    const wo = await this.workOrderModel.findById(id);
    if (!wo) throw new NotFoundException("Work order not found");
    const canEditBilling = user.permissions?.includes(Permissions.WORKORDERS_BILLING_EDIT);
    if (!canEditBilling) {
      throw new ForbiddenException("No permission to edit billing");
    }

    const existingInvoice = await this.invoiceModel.findOne({ workOrderId: wo._id });
    const invoiceLocked =
      wo.status === WorkOrderStatus.CLOSED ||
      this.isFinalizedInvoiceStatus(existingInvoice?.status);
    if (invoiceLocked && !this.isOwnerAdmin(user)) {
      throw new ForbiddenException("Only owner admin can edit finalized billing");
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

    let invoice: any = null;
    let settlement = {
      totalPaid: 0,
      outstandingAmount: financials.amountDue,
      overpayment: 0,
      advanceApplied: financials.advanceApplied,
    };
    let paymentRecord: any = null;
    if (wo.status !== WorkOrderStatus.CANCELED) {
      const upserted = await this.upsertInvoiceForWorkOrder(wo, undefined, {
        issue: Boolean(payload.issueInvoice || payload.paymentAmount || payload.closeWorkOrder),
      });
      invoice = upserted.invoice;
      settlement = upserted.settlement;

      if (payload.paymentAmount && payload.paymentAmount > 0) {
        const paymentResult = await this.createPaymentForInvoice(
          invoice,
          wo,
          {
            amount: Number(payload.paymentAmount),
            method: payload.paymentMethod?.toUpperCase() || "CASH",
          }
        );
        paymentRecord = paymentResult.payment;
        settlement = paymentResult.settlement;
      }

      if (payload.closeWorkOrder && Number(settlement.outstandingAmount || 0) > 0) {
        throw new BadRequestException("Full payment is required before closing this work order");
      }

      if (payload.closeWorkOrder && wo.status !== WorkOrderStatus.CLOSED) {
        wo.status = WorkOrderStatus.CLOSED;
        wo.deliveredAt = new Date();
        await wo.save();
      }

      if (performerObjectId && (payload.issueInvoice || payload.closeWorkOrder || paymentRecord)) {
        await this.audit.record({
          actionType: "WORK_ORDER_BILLING_SUBMIT",
          entityType: "WorkOrder",
          entityId: wo._id.toString(),
          performedByEmployeeId: performerObjectId,
          after: {
            status: wo.status,
            invoiceId: invoice._id.toString(),
            paymentId: paymentRecord?._id?.toString(),
            invoiceStatus: invoice.status,
            totalPaid: settlement.totalPaid,
            outstandingAmount: settlement.outstandingAmount,
          },
        });
      }
    }

    return {
      workOrder: wo.toJSON(),
      financials: {
        ...financials,
        totalPaid: settlement.totalPaid,
        outstandingAmount: settlement.outstandingAmount,
        overpayment: settlement.overpayment,
      },
      invoice: invoice?.toJSON?.() || invoice,
      payment: paymentRecord?.toJSON?.() || paymentRecord,
    };
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

  async issueInvoice(id: string, user: AuthUser) {
    const wo = await this.workOrderModel.findById(id);
    if (!wo) throw new NotFoundException("Work order not found");
    if (wo.status === WorkOrderStatus.CANCELED) {
      throw new BadRequestException("Cannot issue invoice for canceled work order");
    }
    const { invoice, settlement } = await this.upsertInvoiceForWorkOrder(wo, undefined, {
      issue: true,
    });
    const performerId = resolveUserId(user);
    const performerObjectId = toObjectId(performerId);
    if (performerObjectId) {
      await this.audit.record({
        actionType: "INVOICE_ISSUED",
        entityType: "Invoice",
        entityId: invoice!._id.toString(),
        performedByEmployeeId: performerObjectId,
        after: {
          invoiceStatus: invoice!.status,
          outstandingAmount: settlement.outstandingAmount,
        },
      });
    }
    return { invoice, settlement };
  }

  async updateMeta(id: string, payload: { workOrderNumber?: string }, user?: AuthUser) {
    if (!this.isOwnerAdmin(user)) {
      throw new ForbiddenException("Only owner admin can edit work order number");
    }
    const wo = await this.workOrderModel.findById(id);
    if (!wo) throw new NotFoundException("Work order not found");
    if (payload.workOrderNumber !== undefined) {
      wo.workOrderNumber = await this.generateWorkOrderNumber(
        payload.workOrderNumber,
        wo._id.toString()
      );
    }
    await wo.save();
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
            isArchived: { $ne: true },
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

    const invoice = await this.invoiceModel.findOne({ workOrderId: wo._id });
    if (!invoice) {
      throw new NotFoundException("No invoice found for this work order");
    }

    if (invoice.status === InvoiceStatus.VOID) {
      throw new BadRequestException("Cannot take payment for void invoice");
    }

    const session = await this.connection.startSession();
    session.startTransaction();
    try {
      if (invoice.status === InvoiceStatus.DRAFT) {
        invoice.status = InvoiceStatus.ISSUED;
        invoice.issuedAt = invoice.issuedAt || new Date();
        await invoice.save({ session });
      }

      const paymentResult = await this.createPaymentForInvoice(
        invoice,
        wo,
        {
          amount: Number(payment.amount),
          method: payment.method,
        },
        session
      );

      const performerId = resolveUserId(user);
      const performerObjectId = toObjectId(performerId);
      if (performerObjectId) {
        await this.audit.record({
          actionType: "WORK_ORDER_PAYMENT",
          entityType: "WorkOrder",
          entityId: wo._id.toString(),
          performedByEmployeeId: performerObjectId,
          after: {
            payment: paymentResult.payment.toObject(),
            invoiceStatus: invoice.status,
            outstandingAmount: paymentResult.settlement.outstandingAmount,
          },
        });
      }

      await session.commitTransaction();
      return {
        workOrder: wo,
        invoice,
        payment: paymentResult.payment,
        settlement: paymentResult.settlement,
      };
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      session.endSession();
    }
  }
}
