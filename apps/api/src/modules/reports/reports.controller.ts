import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { ReportsService } from "./reports.service";
import { JwtAuthGuard } from "../auth/jwt.guard";
import { PermissionsGuard } from "../../common/guards/permissions.guard";
import { PermissionsRequired } from "../../common/decorators/permissions.decorator";
import { Permissions } from "@signature-auto-care/shared";

@Controller("reports")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ReportsController {
  constructor(private reports: ReportsService) {}

  @Get("sales")
  @PermissionsRequired(Permissions.REPORTS_READ_SALES)
  sales(@Query("from") from?: string, @Query("to") to?: string) {
    return this.reports.salesReport({ from, to });
  }

  @Get("profit")
  @PermissionsRequired(Permissions.REPORTS_READ_PROFIT)
  profit(@Query("from") from?: string, @Query("to") to?: string) {
    return this.reports.profitReport({ from, to });
  }

  @Get("inventory")
  @PermissionsRequired(Permissions.REPORTS_READ_INVENTORY)
  inventory() {
    return this.reports.inventoryReport();
  }
}
