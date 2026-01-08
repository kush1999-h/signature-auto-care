import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
  ForbiddenException,
  BadRequestException,
} from "@nestjs/common";
import { WorkOrdersService } from "./work-orders.service";
import { JwtAuthGuard } from "../auth/jwt.guard";
import { PermissionsGuard } from "../../common/guards/permissions.guard";
import { PermissionsRequired } from "../../common/decorators/permissions.decorator";
import { Permissions } from "@signature-auto-care/shared";
import { AuthUser, CurrentUser } from "../../common/decorators/current-user.decorator";
import { PermissionsAny } from "../../common/decorators/permissions-any.decorator";
import { Public } from "../../common/decorators/public.decorator";
import type { WorkOrder } from "../../schemas";

type StatusBody = { status?: string };
type BillingBody = { billableLaborAmount?: number; otherCharges?: { name: string; amount: number }[]; paymentMethod?: string };
type PaymentBody = { method?: string; amount?: number | string };
type AssignBody = { assignedEmployees: { employeeId: string; roleType?: string }[] };
type IssuePartBody = { partId: string; qty: number | string };
type TimeLogBody = { clockInAt?: string; clockOutAt?: string };
type NoteBody = { message?: string };

const normalizeId = (value: unknown) => {
  if (value && typeof value === "object" && "toString" in value) {
    return (value as { toString: () => string }).toString();
  }
  return String(value);
};

const resolveUserId = (user: AuthUser) => {
  const userId = user.userId || user._id || user.sub;
  if (!userId) {
    throw new ForbiddenException("Invalid user id");
  }
  return String(userId);
};

@Controller()
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class WorkOrdersController {
  constructor(private workOrders: WorkOrdersService) {}

  @Get("work-orders")
  @PermissionsAny(
    Permissions.WORKORDERS_READ_ALL,
    Permissions.WORKORDERS_READ_ASSIGNED
  )
  async list(@CurrentUser() user: AuthUser, @Query("status") status?: string) {
    return this.workOrders.list(user, { status });
  }

  @Get("work-orders/assignable-employees")
  @PermissionsRequired(Permissions.WORKORDERS_ASSIGN_EMPLOYEE)
  async assignableEmployees() {
    return this.workOrders.listAssignableEmployees();
  }

  @Get("work-orders/:id/detail")
  @PermissionsAny(
    Permissions.WORKORDERS_READ_ALL,
    Permissions.WORKORDERS_READ_ASSIGNED
  )
  async detail(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.workOrders.detail(user, id);
  }

  @Post("work-orders")
  @PermissionsRequired(Permissions.WORKORDERS_CREATE)
  async create(@Body() body: Partial<WorkOrder>, @CurrentUser() user: AuthUser) {
    return this.workOrders.create({ ...body, createdBy: resolveUserId(user) }, user);
  }

  @Patch("work-orders/:id/status")
  @PermissionsRequired(Permissions.WORKORDERS_UPDATE_STATUS)
  async updateStatus(
    @Param("id") id: string,
    @Body() body: StatusBody,
    @CurrentUser() user: AuthUser
  ) {
    if (!body.status) {
      throw new BadRequestException("status is required");
    }
    return this.workOrders.updateStatus(id, body.status, user);
  }

  @Patch("work-orders/:id/billing")
  @PermissionsRequired(Permissions.WORKORDERS_UPDATE_STATUS)
  async updateBilling(
    @Param("id") id: string,
    @Body() body: BillingBody,
    @CurrentUser() user: AuthUser
  ) {
    return this.workOrders.updateBilling(
      id,
      {
        billableLaborAmount: body.billableLaborAmount,
        otherCharges: body.otherCharges,
        paymentMethod: body.paymentMethod,
      },
      user
    );
  }

  @Post("work-orders/:id/take-payment")
  @PermissionsRequired(Permissions.INVOICES_CLOSE)
  async takePayment(
    @Param("id") id: string,
    @Body() body: PaymentBody,
    @CurrentUser() user: AuthUser
  ) {
    return this.workOrders.takePayment(
      id,
      {
        method: body.method || "CASH",
        amount: Number(body.amount),
      },
      user
    );
  }

  @Post("work-orders/:id/assign")
  @PermissionsRequired(Permissions.WORKORDERS_ASSIGN_EMPLOYEE)
  async assign(
    @Param("id") id: string,
    @Body() body: AssignBody,
    @CurrentUser() user: AuthUser
  ) {
    const employees = (body.assignedEmployees || []).map((emp) => ({
      employeeId: emp.employeeId,
      roleType: emp.roleType || "TECHNICIAN"
    }));
    return this.workOrders.assign(id, employees, resolveUserId(user));
  }

  @Post("work-orders/:id/issue-part")
  @PermissionsRequired(Permissions.INVENTORY_ISSUE_TO_WORKORDER)
  async issuePart(
    @Param("id") id: string,
    @Body() body: IssuePartBody,
    @CurrentUser() user: AuthUser,
    @Headers("idempotency-key") idempotencyKey?: string
  ) {
    const wo = await this.workOrders.findById(id);
    if (!wo) throw new ForbiddenException("Work order not found");
    const assignedIds =
      wo.assignedEmployees?.map((a) => normalizeId(a.employeeId)) || [];
    const isTechOrPainter = user.role && ["TECHNICIAN", "PAINTER"].includes(user.role);
    if (isTechOrPainter) {
      throw new ForbiddenException("Technicians and painters cannot issue parts");
    }
    const normalizedUserId = resolveUserId(user);

    // Technicians/painters must be assigned to issue parts for the work order
    if (isTechOrPainter && !assignedIds.includes(normalizedUserId)) {
      throw new ForbiddenException("You must be assigned to this work order to issue parts");
    }
    return this.workOrders.issuePart({
      workOrderId: id,
      partId: body.partId,
      qty: Number(body.qty),
      performedBy: normalizedUserId,
      idempotencyKey,
    });
  }

  @Post("work-orders/:id/time-logs")
  async createTimeLog(
    @Param("id") id: string,
    @Body() body: TimeLogBody,
    @CurrentUser() user: AuthUser
  ) {
    const hasSelf = user.permissions?.includes(
      Permissions.TIMELOGS_CREATE_SELF
    );
    const hasAll = user.permissions?.includes(Permissions.TIMELOGS_READ_ALL);
    if (!hasSelf && !hasAll) {
      throw new ForbiddenException("No permission");
    }
    const wo = await this.workOrders.findById(id);
    if (!wo) throw new ForbiddenException("Work order not found");
    const assignedIds =
      wo.assignedEmployees?.map((a) => normalizeId(a.employeeId)) || [];
    const performerId = resolveUserId(user);
    if (hasSelf && !hasAll && !assignedIds.includes(performerId)) {
      throw new ForbiddenException("Not assigned to this work order");
    }
    return this.workOrders.createTimeLog({
      workOrderId: id,
      employeeId: performerId,
      clockInAt: body.clockInAt || new Date().toISOString(),
      clockOutAt: body.clockOutAt,
    });
  }

  @Get("work-orders/:id/time-logs")
  async listLogs(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    const hasAll = user.permissions?.includes(Permissions.TIMELOGS_READ_ALL);
    const hasSelf = user.permissions?.includes(Permissions.TIMELOGS_READ_SELF);
    if (!hasAll && !hasSelf) throw new ForbiddenException("No permission");
    if (hasSelf && !hasAll) {
      const logs = await this.workOrders.listTimeLogs(id);
      const userId = normalizeId(user.userId || (user as { _id?: string })._id || (user as { sub?: string }).sub);
      return logs.filter((l) => normalizeId(l.employeeId) === userId);
    }
    return this.workOrders.listTimeLogs(id);
  }

  @Post("work-orders/:id/time-logs/clock-in")
  @PermissionsAny(
    Permissions.TIMELOGS_CREATE_SELF,
    Permissions.TIMELOGS_READ_ALL
  )
  async clockIn(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.workOrders.clockIn(id, user);
  }

  @Post("work-orders/:id/time-logs/clock-out")
  @PermissionsAny(
    Permissions.TIMELOGS_CREATE_SELF,
    Permissions.TIMELOGS_READ_ALL
  )
  async clockOut(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.workOrders.clockOut(id, user);
  }

  @Post("work-orders/:id/notes")
  @PermissionsRequired(Permissions.WORKORDERS_ADD_NOTES)
  async addNote(
    @Param("id") id: string,
    @Body() body: NoteBody,
    @CurrentUser() user: AuthUser
  ) {
    if (!body.message || !body.message.trim()) {
      throw new BadRequestException("message is required");
    }
    return this.workOrders.addNote({
      workOrderId: id,
      message: body.message,
      authorId: resolveUserId(user),
    });
  }

  // Bootstrap endpoint to create test work orders for development
  @Post("work-orders/bootstrap/create-test-data")
  @Public()
  async bootstrapTestData() {
    return { message: "Bootstrap endpoint - check server logs for details" };
  }
}
