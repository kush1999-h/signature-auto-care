import { Body, Controller, Get, Post, UseGuards, NotFoundException, ForbiddenException } from "@nestjs/common";
import { IsEmail, IsString } from "class-validator";
import { AuthService } from "./auth.service";
import { AuthUser, CurrentUser } from "../../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "./jwt.guard";
import { PermissionsGuard } from "../../common/guards/permissions.guard";

class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  password!: string;
}

class RefreshDto {
  @IsString()
  refreshToken!: string;
}

@Controller("auth")
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post("login")
  async login(@Body() body: LoginDto) {
    return this.authService.login(body.email, body.password);
  }

  @Post("refresh")
  async refresh(@Body() body: RefreshDto) {
    return this.authService.refresh(body.refreshToken);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Post("logout")
  async logout(@CurrentUser() user: AuthUser) {
    const id = user.userId || user.sub;
    if (!id) throw new NotFoundException("User ID not found in token");
    return this.authService.logout(id);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Get("me")
  async me(@CurrentUser() user: AuthUser) {
    const id = user.userId || user.sub;
    if (!id) throw new NotFoundException("User ID not found in token");
    const fresh = await this.authService.buildFreshUser(id);
    if (!fresh) {
      throw new NotFoundException("User not found");
    }
    return fresh;
  }

  // Bootstrap login without password using a shared secret (for recovery/first login)
  @Post("bootstrap-login")
  async bootstrapLogin(@Body() body: { email: string; secret: string }) {
    const secret = process.env.BOOTSTRAP_SECRET;
    if (!secret || body.secret !== secret) {
      throw new ForbiddenException("Forbidden");
    }
    return this.authService.bootstrapLogin(body.email);
  }
}
