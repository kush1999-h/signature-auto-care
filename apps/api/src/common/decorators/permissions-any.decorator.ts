import { SetMetadata } from "@nestjs/common";
import { Permission } from "@signature-auto-care/shared";

export const PERMISSIONS_ANY_KEY = "permissions_any";
export const PermissionsAny = (...permissions: Permission[]) => SetMetadata(PERMISSIONS_ANY_KEY, permissions);
