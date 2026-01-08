import { Body, Controller, Get, Param, Patch, Query, UseGuards } from "@nestjs/common";
import { Permissions } from "@signature-auto-care/shared";
import { JwtAuthGuard } from "../auth/jwt.guard";
import { PermissionsGuard } from "../../common/guards/permissions.guard";
import { PermissionsRequired } from "../../common/decorators/permissions.decorator";
import { AuthUser, CurrentUser } from "../../common/decorators/current-user.decorator";
import type { Payable } from "../../schemas";
import { PayablesService } from "./payables.service";

@Controller("payables")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PayablesController {
  constructor(private payables: PayablesService) {}

  @Get()
  @PermissionsRequired(Permissions.PAYABLES_READ)
  list(
    @Query("status") status?: string,
    @Query("vendor") vendor?: string,
    @Query("partId") partId?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("limit") limit?: number
  ) {
    return this.payables.list({
      status,
      vendor,
      partId,
      from,
      to,
      limit: limit ? Number(limit) : undefined
    });
  }

  @Patch(":id")
  @PermissionsRequired(Permissions.PAYABLES_UPDATE)
  update(
    @Param("id") id: string,
    @Body() body: Partial<Payable>,
    @CurrentUser() user: AuthUser
  ) {
    return this.payables.update(id, {
      ...body,
      performedBy: user.userId,
      performedByName: user.name,
      performedByRole: user.role
    });
  }
}
