import { SetMetadata } from "@nestjs/common";
import { Permission } from "@signature-auto-care/shared";

export const PERMISSIONS_KEY = "permissions";
export const PermissionsRequired = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
