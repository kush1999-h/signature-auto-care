import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcrypt";
import { UsersService } from "../users/users.service";
import { UserDocument } from "../../schemas";
import { DefaultRolePermissions } from "@signature-auto-care/shared";

interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  permissions: string[];
}

@Injectable()
export class AuthService {
  constructor(private usersService: UsersService, private jwtService: JwtService) {}

    private getSecret(name: string, fallback: string) {
    const value = process.env[name];
    if (!value && process.env.NODE_ENV === "production") {
      throw new UnauthorizedException(`${name} is required`);
    }
    return value || fallback;
  }

private mergePermissions(user: UserDocument) {
    const roleKey = user.role as keyof typeof DefaultRolePermissions;
    const rolePermissions = DefaultRolePermissions[roleKey] || [];
    return Array.from(
      new Set([...(user.permissions || []), ...rolePermissions])
    );
  }

  private buildSafeUser(user: UserDocument) {
    const mergedPerms = this.mergePermissions(user);
    return { ...this.usersService.toSafe(user), permissions: mergedPerms };
  }

  async validateUser(email: string, pass: string): Promise<UserDocument> {
    const normalizedEmail = email?.trim().toLowerCase();
    const user = await this.usersService.findByEmail(normalizedEmail);
    if (!user || !user.isActive) {
      throw new UnauthorizedException("Invalid credentials");
    }
    const match = await bcrypt.compare(pass, user.passwordHash);
    if (!match) {
      throw new UnauthorizedException("Invalid credentials");
    }
    return user;
  }

  async login(email: string, password: string) {
    const user = await this.validateUser(email, password);
    return this.buildTokens(user);
  }

  async refresh(token: string) {
    try {
      const decoded = await this.jwtService.verifyAsync<JwtPayload>(token, {
        secret: this.getSecret("JWT_REFRESH_SECRET", "dev-refresh")
      });
      const user = await this.usersService.findById(decoded.sub);
      if (!user || !user.refreshTokenHash) {
        throw new UnauthorizedException("Invalid refresh");
      }
      const valid = await bcrypt.compare(token, user.refreshTokenHash);
      if (!valid) {
        throw new UnauthorizedException("Invalid refresh");
      }
      return this.buildTokens(user);
    } catch {
      throw new UnauthorizedException("Invalid refresh token");
    }
  }

  async logout(userId: string) {
    await this.usersService.clearRefreshToken(userId);
    return { success: true };
  }

  async bootstrapLogin(email: string) {
    const user = await this.usersService.findByEmail(email);
    if (!user) {
      throw new UnauthorizedException("User not found");
    }
    return this.buildTokensFromUser(user);
  }

  private async buildTokens(user: UserDocument) {
    const mergedPerms = this.mergePermissions(user);
    const payload: JwtPayload = {
      sub: user._id.toString(),
      email: user.email,
      role: user.role,
      permissions: mergedPerms
    };
    const accessToken = await this.jwtService.signAsync(payload, {
      secret: this.getSecret("JWT_SECRET", "dev-secret"),
      expiresIn: process.env.JWT_EXPIRES || "1h"
    });
    const refreshToken = await this.jwtService.signAsync(payload, {
      secret: this.getSecret("JWT_REFRESH_SECRET", "dev-refresh"),
      expiresIn: process.env.JWT_REFRESH_EXPIRES || "7d"
    });
    const refreshTokenHash = await bcrypt.hash(refreshToken, 10);
    await this.usersService.storeRefreshToken(user._id.toString(), refreshTokenHash);
    return {
      accessToken,
      refreshToken,
      user: this.buildSafeUser(user)
    };
  }

  private async buildTokensFromUser(user: UserDocument) {
    const mergedPerms = this.mergePermissions(user);
    const payload: JwtPayload = {
      sub: user._id.toString(),
      email: user.email,
      role: user.role,
      permissions: mergedPerms
    };
    const accessToken = await this.jwtService.signAsync(payload, {
      secret: this.getSecret("JWT_SECRET", "dev-secret"),
      expiresIn: process.env.JWT_EXPIRES || "1h"
    });
    const refreshToken = await this.jwtService.signAsync(payload, {
      secret: this.getSecret("JWT_REFRESH_SECRET", "dev-refresh"),
      expiresIn: process.env.JWT_REFRESH_EXPIRES || "7d"
    });
    const refreshTokenHash = await bcrypt.hash(refreshToken, 10);
    await this.usersService.storeRefreshToken(user._id.toString(), refreshTokenHash);
    return {
      accessToken,
      refreshToken,
      user: this.buildSafeUser(user)
    };
  }

  async buildFreshUser(userId: string) {
    const user = await this.usersService.findById(userId);
    if (!user) return null;
    return this.buildSafeUser(user);
  }
}
