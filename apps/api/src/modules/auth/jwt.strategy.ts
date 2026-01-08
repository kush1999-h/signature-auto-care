import { Injectable } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { DefaultRolePermissions } from "@signature-auto-care/shared";

type JwtPayload = {
  sub: string;
  email: string;
  role: string;
  permissions?: string[];
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    const secret = process.env.JWT_SECRET;
    if (!secret && process.env.NODE_ENV === "production") {
      throw new Error("JWT_SECRET is required");
    }
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret || "dev-secret"
    });
  }

  async validate(payload: JwtPayload) {
    const roleKey = payload.role as keyof typeof DefaultRolePermissions;
    const rolePermissions = DefaultRolePermissions[roleKey] || [];
    const mergedPerms = Array.from(
      new Set([...(payload.permissions || []), ...rolePermissions])
    );
    return {
      userId: payload.sub,
      email: payload.email,
      role: payload.role,
      permissions: mergedPerms
    };
  }
}
