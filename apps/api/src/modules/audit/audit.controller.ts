import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { AuditService } from "./audit.service";
import { JwtAuthGuard } from "../auth/jwt.guard";
import { PermissionsGuard } from "../../common/guards/permissions.guard";
import { PermissionsRequired } from "../../common/decorators/permissions.decorator";
import { Permissions } from "@signature-auto-care/shared";

@Controller("audit-logs")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AuditController {
  constructor(private audit: AuditService) {}

  @Get()
  @PermissionsRequired(Permissions.AUDITLOGS_READ)
  list(
    @Query("entityType") entityType?: string,
    @Query("entityId") entityId?: string,
    @Query("actionType") actionType?: string | string[]
  ) {
    return this.audit.list({ entityType, entityId, actionType });
  }
}
