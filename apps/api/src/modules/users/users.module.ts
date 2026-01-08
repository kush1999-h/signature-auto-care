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
  }
}
