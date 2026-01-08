import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PERMISSIONS_KEY } from "../decorators/permissions.decorator";
import { PERMISSIONS_ANY_KEY } from "../decorators/permissions-any.decorator";
import { DefaultRolePermissions, Permission } from "@signature-auto-care/shared";

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredAll = this.reflector.getAllAndOverride<Permission[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()]
    );
    const requiredAny = this.reflector.getAllAndOverride<Permission[]>(
      PERMISSIONS_ANY_KEY,
      [context.getHandler(), context.getClass()]
    );
    // If no permissions required, allow access
    if (
      (!requiredAll || requiredAll.length === 0) &&
      (!requiredAny || requiredAny.length === 0)
    ) {
      return true;
    }
    const { user } = context.switchToHttp().getRequest();
    if (!user) {
      throw new ForbiddenException("Missing user");
    }
    const rolePerms = user?.role
      ? DefaultRolePermissions[user.role as keyof typeof DefaultRolePermissions] || []
      : [];
    const perms: string[] = Array.from(new Set([...(user?.permissions ?? []), ...rolePerms]));

    // Check requiredAll: all permissions must be present
    if (requiredAll && requiredAll.length) {
      const hasAll = requiredAll.every((perm) => perms.includes(perm));
      if (!hasAll) {
        throw new ForbiddenException("Insufficient permissions");
      }
      return true;
    }

    // Check requiredAny: at least one permission must be present
    if (requiredAny && requiredAny.length) {
      const hasAny = requiredAny.some((perm) => perms.includes(perm));
      if (!hasAny) {
        throw new ForbiddenException("Insufficient permissions");
      }
      return true;
    }

    return true;
  }
}
