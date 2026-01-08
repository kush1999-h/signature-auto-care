import { Injectable, ConflictException, NotFoundException, ForbiddenException } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import * as bcrypt from "bcrypt";
import { DefaultRolePermissions, Role, Permission } from "@signature-auto-care/shared";
import { RoleEntity, User, UserDocument } from "../../schemas";

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(RoleEntity.name) private roleModel: Model<RoleEntity>
  ) {}

  async findByEmail(email: string) {
    return this.userModel.findOne({ email: email?.trim().toLowerCase() }).exec();
  }

  async findById(id: string) {
    return this.userModel.findById(id).exec();
  }

  toSafe(user: UserDocument | User) {
    const obj =
      typeof (user as { toObject?: () => unknown }).toObject === "function"
        ? (user as { toObject: () => unknown }).toObject()
        : user;
    const {
      passwordHash: _passwordHash,
      refreshTokenHash: _refreshTokenHash,
      ...rest
    } = obj as { passwordHash?: unknown; refreshTokenHash?: unknown };
    void _passwordHash;
    void _refreshTokenHash;
    return rest;
  }

  async create(input: { email: string; password: string; name: string; role: Role }) {
    const exists = await this.findByEmail(input.email);
    if (exists) {
      throw new ConflictException("User already exists");
    }
    const hash = await bcrypt.hash(input.password, 10);
    const rolePermissions = DefaultRolePermissions[input.role];
    const user = await this.userModel.create({
      email: input.email,
      passwordHash: hash,
      name: input.name,
      role: input.role,
      permissions: rolePermissions,
      isActive: true
    });
    return this.toSafe(user);
  }

  async list() {
    const users = await this.userModel.find().exec();
    return users.map((u) => this.toSafe(u));
  }

  async update(
    id: string,
    payload: Partial<{
      name: string;
      email: string;
      password: string;
      role: Role;
      permissions: Permission[];
    }>,
    actor: { role?: string }
  ) {
    if (actor?.role !== "OWNER_ADMIN") {
      throw new ForbiddenException("Only OWNER_ADMIN can edit users");
    }

    const update: Partial<User> & { passwordHash?: string; permissions?: Permission[] } = {};

    if (payload.name !== undefined) update.name = payload.name;

    if (payload.email) {
      const existing = await this.userModel.findOne({
        email: payload.email.trim().toLowerCase(),
        _id: { $ne: id }
      });
      if (existing) {
        throw new ConflictException("Email already in use");
      }
      update.email = payload.email.trim().toLowerCase();
    }

    if (payload.password) {
      update.passwordHash = await bcrypt.hash(payload.password, 10);
    }

    if (payload.role) {
      update.role = payload.role;
      // If permissions not explicitly provided, refresh to defaults for the new role
      if (!payload.permissions) {
        update.permissions = DefaultRolePermissions[payload.role as Role];
      }
    }

    if (payload.permissions) {
      update.permissions = payload.permissions;
    }

    const user = await this.userModel.findByIdAndUpdate(id, update, { new: true });
    if (!user) {
      throw new NotFoundException("User not found");
    }
    return this.toSafe(user);
  }

  async disable(id: string) {
    const user = await this.userModel.findByIdAndUpdate(id, { isActive: false }, { new: true });
    if (!user) {
      throw new NotFoundException("User not found");
    }
    return this.toSafe(user);
  }

  async count() {
    return this.userModel.countDocuments();
  }

  async storeRefreshToken(userId: string, refreshTokenHash: string) {
    await this.userModel.findByIdAndUpdate(userId, { refreshTokenHash });
  }

  async clearRefreshToken(userId: string) {
    await this.userModel.findByIdAndUpdate(userId, { refreshTokenHash: null });
  }

  async setPasswordByEmail(email: string, password: string) {
    const hash = await bcrypt.hash(password, 10);
    const user = await this.userModel.findOneAndUpdate({ email }, { passwordHash: hash }, { new: true });
    if (!user) {
      throw new NotFoundException("User not found");
    }
    return this.toSafe(user);
  }

  async ensureRoleSeeds() {
    const entries = Object.entries(DefaultRolePermissions);
    for (const [role, perms] of entries) {
      await this.roleModel.updateOne(
        { name: role },
        { name: role, permissions: perms },
        { upsert: true }
      );
    }
  }

  async ensurePermissionForRoles(permission: string, roles: string[]) {
    await this.userModel.updateMany(
      { role: { $in: roles }, permissions: { $ne: permission } },
      { $push: { permissions: permission } }
    );
  }

  async ensureDefaultAdmin() {
    const email = process.env.ADMIN_SEED_EMAIL;
    const password = process.env.ADMIN_SEED_PASSWORD;
    if (!email || !password) return;
    const existing = await this.findByEmail(email);
    if (existing) return;
    const hash = await bcrypt.hash(password, 10);
    await this.userModel.create({
      email,
      passwordHash: hash,
      name: "Admin",
      role: "OWNER_ADMIN",
      permissions: DefaultRolePermissions["OWNER_ADMIN"],
      isActive: true
    });
  }
}
