import { createParamDecorator, ExecutionContext } from "@nestjs/common";

export type AuthUser = {
  userId?: string;
  sub?: string; // Added for JWT compatibility
  _id?: string;
  email?: string;
  name?: string;
  role?: string;
  permissions?: string[];
};

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest();
  return request.user;
});
