import { Module, OnModuleInit } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { User, UserSchema, RoleEntity, RoleSchema } from "../../schemas";
import { UsersService } from "./users.service";
import { UsersController } from "./users.controller";

@Module({
  imports: [MongooseModule.forFeature([{ name: User.name, schema: UserSchema }, { name: RoleEntity.name, schema: RoleSchema }])],
  providers: [UsersService],
  controllers: [UsersController],
  exports: [UsersService]
})
export class UsersModule implements OnModuleInit {
  constructor(private readonly usersService: UsersService) {}
  async onModuleInit() {
    await this.usersService.ensureRoleSeeds();
    await this.usersService.ensureDefaultAdmin();
    await this.usersService.ensurePermissionForRoles("INVENTORY_PRICE_UPDATE", ["OWNER_ADMIN", "OPS_MANAGER"]);
    await this.usersService.ensurePermissionForRoles("WORKORDERS_BILLING_EDIT", ["OWNER_ADMIN", "OPS_MANAGER", "SERVICE_ADVISOR"]);
    await this.usersService.ensurePermissionForRoles("WORKORDERS_CREATE", ["SERVICE_ADVISOR"]);
    await this.usersService.ensurePermissionForRoles("WORKORDERS_UPDATE_STATUS", ["SERVICE_ADVISOR"]);
    await this.usersService.ensurePermissionForRoles("WORKORDERS_ASSIGN_EMPLOYEE", ["SERVICE_ADVISOR"]);
    await this.usersService.ensurePermissionForRoles("WORKORDERS_ADD_NOTES", ["SERVICE_ADVISOR"]);
    await this.usersService.ensurePermissionForRoles("TIMELOGS_CREATE_SELF", ["SERVICE_ADVISOR"]);
    await this.usersService.ensurePermissionForRoles("TIMELOGS_READ_SELF", ["SERVICE_ADVISOR"]);
    await this.usersService.ensurePermissionForRoles("INVENTORY_ISSUE_TO_WORKORDER", ["SERVICE_ADVISOR"]);
    await this.usersService.ensurePermissionForRoles("INVOICES_READ", ["SERVICE_ADVISOR"]);
    await this.usersService.ensurePermissionForRoles("INVOICES_CREATE", ["SERVICE_ADVISOR"]);
    await this.usersService.ensurePermissionForRoles("INVOICES_CLOSE", ["SERVICE_ADVISOR"]);
    await this.usersService.ensurePermissionForRoles("PAYMENTS_CREATE", ["SERVICE_ADVISOR"]);
    await this.usersService.ensurePermissionForRoles("PAYMENTS_READ", ["SERVICE_ADVISOR"]);
    await this.usersService.ensurePermissionForRoles("INVENTORY_COUNTER_SALE", ["INVENTORY_MANAGER"]);
    await this.usersService.ensurePermissionForRoles("INVENTORY_PRICE_UPDATE", ["INVENTORY_MANAGER"]);
    await this.usersService.ensurePermissionForRoles("SERVICES_READ", ["OPS_MANAGER", "SERVICE_ADVISOR", "INVENTORY_MANAGER", "ACCOUNTANT"]);
    await this.usersService.ensurePermissionForRoles("SERVICES_CREATE", ["OPS_MANAGER"]);
    await this.usersService.ensurePermissionForRoles("SERVICES_UPDATE", ["OPS_MANAGER"]);
    await this.usersService.ensurePermissionForRoles("SERVICES_PRICE_UPDATE", ["OPS_MANAGER"]);
  }
}
