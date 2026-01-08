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
import { PartsService } from "./parts.service";
import { JwtAuthGuard } from "../auth/jwt.guard";
import { PermissionsGuard } from "../../common/guards/permissions.guard";
import { PermissionsRequired } from "../../common/decorators/permissions.decorator";
import { Permissions } from "@signature-auto-care/shared";
import { AuthUser, CurrentUser } from "../../common/decorators/current-user.decorator";
import type { Part } from "../../schemas";

type PriceBody = { sellingPrice?: number | string };
type ReceiveBody = {
  partId: string;
  qty: number | string;
  unitCost: number | string;
  sellingPrice?: number | string | null;
  paymentMethod?: string;
  vendorName?: string;
  notes?: string;
};
type AdjustBody = { partId: string; qtyChange: number | string; reason?: string };
type ReserveBody = { partId: string; workOrderId: string; qty: number | string };

const resolveUserId = (user: AuthUser) => {
  const userId = user.userId || user._id || user.sub;
  if (!userId) {
    throw new ForbiddenException("Invalid user id");
  }
  return String(userId);
};

@Controller()
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PartsController {
  constructor(private parts: PartsService) {}

  @Get("parts")
  @PermissionsRequired(Permissions.PARTS_READ)
  list(
    @Query("search") search?: string,
    @Query("page") page?: number,
    @Query("limit") limit?: number
  ) {
    return this.parts.list({
      search,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Post("parts")
  @PermissionsRequired(Permissions.PARTS_CREATE)
  create(@Body() body: Partial<Part>, @CurrentUser() user: AuthUser) {
    return this.parts.create({
      ...body,
      performedByEmployeeId: user.userId,
      performedByName: user?.name,
      performedByRole: user?.role
    });
  }

  @Patch("parts/:id")
  @PermissionsRequired(Permissions.PARTS_UPDATE)
  update(@Param("id") id: string, @Body() body: Partial<Part>, @CurrentUser() user: AuthUser) {
    return this.parts.update(id, {
      ...body,
      performedByEmployeeId: user.userId,
      performedByName: user?.name,
      performedByRole: user?.role
    });
  }

  @Get("parts/:id")
  @PermissionsRequired(Permissions.PARTS_READ)
  async getById(@Param("id") id: string) {
    return this.parts.findById(id);
  }

  @Patch("parts/:id/price")
  @PermissionsRequired(Permissions.INVENTORY_PRICE_UPDATE)
  updatePrice(
    @Param("id") id: string,
    @Body() body: PriceBody,
    @CurrentUser() user: AuthUser
  ) {
    return this.parts.update(id, {
      sellingPrice: Number(body.sellingPrice),
      performedByEmployeeId: user.userId,
    });
  }

  @Post("inventory/receive")
  @PermissionsRequired(Permissions.INVENTORY_RECEIVE)
  receive(
    @Body() body: ReceiveBody,
    @CurrentUser() user: AuthUser,
    @Headers("idempotency-key") idempotencyKey?: string
  ) {
    // Prevent technicians and painters from receiving inventory
    if (user.role && ["TECHNICIAN", "PAINTER"].includes(user.role)) {
      throw new ForbiddenException("Technicians and painters cannot receive inventory");
    }

    return this.parts.receiveInventory({
      partId: body.partId,
      qty: Number(body.qty),
      unitCost: Number(body.unitCost),
      sellingPrice:
        body.sellingPrice !== undefined && body.sellingPrice !== null
          ? Number(body.sellingPrice)
          : undefined,
      paymentMethod: body.paymentMethod,
      vendorName: body.vendorName,
      notes: body.notes,
      performedBy: resolveUserId(user),
      performedByName: user?.name,
      performedByRole: user?.role,
      idempotencyKey,
    });
  }

  @Post("inventory/adjust")
  @PermissionsRequired(Permissions.INVENTORY_ADJUST)
  adjust(
    @Body() body: AdjustBody,
    @CurrentUser() user: AuthUser,
    @Headers("idempotency-key") idempotencyKey?: string
  ) {
    const reason = body.reason?.trim();
    if (!reason) {
      throw new BadRequestException("reason is required");
    }
    return this.parts.adjustInventory({
      partId: body.partId,
      qtyChange: Number(body.qtyChange),
      reason,
      performedBy: resolveUserId(user),
      performedByName: user?.name,
      performedByRole: user?.role,
      idempotencyKey,
    });
  }

  @Post("inventory/reserve")
  @PermissionsRequired(Permissions.INVENTORY_ISSUE_TO_WORKORDER)
  reserve(@Body() body: ReserveBody, @CurrentUser() user: AuthUser) {
    return this.parts.reserveStock({
      partId: body.partId,
      workOrderId: body.workOrderId,
      qty: Number(body.qty),
      performedBy: resolveUserId(user),
    });
  }

  @Post("inventory/release")
  @PermissionsRequired(Permissions.INVENTORY_ISSUE_TO_WORKORDER)
  release(@Body() body: ReserveBody, @CurrentUser() user: AuthUser) {
    return this.parts.releaseReserved({
      partId: body.partId,
      workOrderId: body.workOrderId,
      qty: Number(body.qty),
      performedBy: resolveUserId(user),
    });
  }

  @Post("inventory/reverse/:transactionId")
  @PermissionsRequired(Permissions.INVENTORY_ADJUST)
  reverse(
    @Param("transactionId") transactionId: string,
    @CurrentUser() user: AuthUser,
    @Headers("idempotency-key") idempotencyKey?: string
  ) {
    return this.parts.reverseTransaction({
      transactionId,
      performedBy: resolveUserId(user),
      idempotencyKey,
    });
  }

  @Get("inventory/transactions")
  @PermissionsRequired(Permissions.INVENTORY_REPORTS_READ)
  transactions(
    @Query("partId") partId?: string,
    @Query("type") type?: string,
    @Query("paymentMethod") paymentMethod?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("limit") limit?: number
  ) {
    return this.parts.listTransactions({
      partId,
      type,
      paymentMethod,
      from,
      to,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get("inventory/low-stock")
  @PermissionsRequired(Permissions.INVENTORY_REPORTS_READ)
  lowStock() {
    return this.parts.lowStock();
  }
}
