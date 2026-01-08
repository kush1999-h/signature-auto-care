import { Controller, Post, UseGuards } from "@nestjs/common";
import { AdminService } from "./admin.service";
import { JwtAuthGuard } from "../auth/jwt.guard";
import { PermissionsGuard } from "../../common/guards/permissions.guard";
import { AuthUser, CurrentUser } from "../../common/decorators/current-user.decorator";

@Controller("admin")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AdminController {
  constructor(private admin: AdminService) {}

  @Post("purge")
  async purge(@CurrentUser() user: AuthUser) {
    return this.admin.purge(user);
  }
}
