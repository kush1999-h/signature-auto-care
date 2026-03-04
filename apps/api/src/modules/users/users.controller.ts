import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards, ForbiddenException } from "@nestjs/common";
import { IsArray, IsEmail, IsOptional, IsString } from "class-validator";
import { UsersService } from "./users.service";
import { JwtAuthGuard } from "../auth/jwt.guard";
import { PermissionsGuard } from "../../common/guards/permissions.guard";
import { PermissionsRequired } from "../../common/decorators/permissions.decorator";
import { Permissions, Role, Permission } from "@signature-auto-care/shared";
import { AuthUser, CurrentUser } from "../../common/decorators/current-user.decorator";
import { Public } from "../../common/decorators/public.decorator";

class CreateUserDto {
  @IsEmail()
  email!: string;

  @IsString()
  password!: string;

  @IsString()
  name!: string;

  @IsString()
  role!: Role; // role is required; permissions are hardcoded from role defaults
}

class UpdateUserDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  password?: string;

  @IsOptional()
  @IsString()
  role?: Role; // when role changes, permissions will be refreshed from defaults

  @IsOptional()
  @IsArray()
  permissions?: Permission[];
}

class BootstrapSeedDto extends CreateUserDto {
  @IsOptional()
  @IsString()
  secret?: string;
}

class VerifyOtpDto {
  @IsEmail()
  email!: string;

  @IsString()
  otp!: string;
}

@Controller("users")
export class UsersController {
  constructor(private usersService: UsersService) {}

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Get()
  @PermissionsRequired(Permissions.USERS_READ)
  async list() {
    return this.usersService.list();
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Post()
  @PermissionsRequired(Permissions.USERS_CREATE)
  async create(@Body() body: CreateUserDto) {
    return this.usersService.create(body);
  }

  @Public()
  @Post("verify-email-otp")
  async verifyEmailOtp(@Body() body: VerifyOtpDto) {
    return this.usersService.verifyEmailOtp(body.email, body.otp);
  }

  // temporary bootstrap endpoint to seed first admin when no users exist
  @Post("seed-initial-admin")
  async seedInitial(@Body() body: BootstrapSeedDto) {
    const secret = process.env.BOOTSTRAP_SECRET;
    if (!secret || body.secret !== secret) {
      throw new ForbiddenException("Invalid bootstrap secret");
    }
    const count = await this.usersService.count();
    if (count > 0) {
      throw new ForbiddenException("Seed endpoint disabled after first user");
    }
    return this.usersService.create({ ...body, role: "OWNER_ADMIN" });
  }

  // temporary bootstrap password reset (requires secret)
  @Post("bootstrap-reset-password")
  async bootstrapReset(@Body() body: { email: string; newPassword: string; secret?: string }) {
    const secret = process.env.BOOTSTRAP_SECRET;
    if (!secret || body.secret !== secret) {
      throw new ForbiddenException("Invalid bootstrap secret");
    }
    return this.usersService.setPasswordByEmail(body.email, body.newPassword);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Patch(":id")
  @PermissionsRequired(Permissions.USERS_UPDATE)
  async update(@Param("id") id: string, @Body() body: UpdateUserDto, @CurrentUser() user: AuthUser) {
    return this.usersService.update(id, body, {
      role: user.role,
      permissions: user.permissions
    });
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Post(":id/disable")
  @PermissionsRequired(Permissions.USERS_DISABLE)
  async disable(@Param("id") id: string) {
    return this.usersService.disable(id);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Post(":id/resend-otp")
  @PermissionsRequired(Permissions.USERS_CREATE)
  async resendOtp(@Param("id") id: string) {
    return this.usersService.resendVerificationOtp(id);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Delete(":id")
  @PermissionsRequired(Permissions.USERS_DISABLE)
  async deleteUser(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    const actorId = user.userId || user._id || user.sub;
    return this.usersService.delete(id, actorId);
  }
}
