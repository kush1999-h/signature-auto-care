import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { ExpensesService } from "./expenses.service";
import { JwtAuthGuard } from "../auth/jwt.guard";
import { PermissionsGuard } from "../../common/guards/permissions.guard";
import { PermissionsRequired } from "../../common/decorators/permissions.decorator";
import { Permissions } from "@signature-auto-care/shared";
import { AuthUser, CurrentUser } from "../../common/decorators/current-user.decorator";
import type { Expense } from "../../schemas";

@Controller("expenses")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ExpensesController {
  constructor(private expenses: ExpensesService) {}

  @Get()
  @PermissionsRequired(Permissions.EXPENSES_READ)
  list() {
    return this.expenses.list();
  }

  @Post()
  @PermissionsRequired(Permissions.EXPENSES_CREATE)
  create(@Body() body: Partial<Expense>, @CurrentUser() user: AuthUser) {
    return this.expenses.create({ ...body, performedBy: user.userId });
  }

  @Patch(":id")
  @PermissionsRequired(Permissions.EXPENSES_UPDATE)
  update(@Param("id") id: string, @Body() body: Partial<Expense>, @CurrentUser() user: AuthUser) {
    return this.expenses.update(id, { ...body, performedBy: user.userId });
  }

  @Delete(":id")
  @PermissionsRequired(Permissions.EXPENSES_DELETE)
  remove(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    const performedBy = user.userId || user.sub;
    if (!performedBy) throw new Error("User ID not found");
    return this.expenses.softDelete(id, performedBy);
  }
}
