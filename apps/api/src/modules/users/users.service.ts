import { Injectable, ConflictException, NotFoundException, ForbiddenException, InternalServerErrorException } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import * as bcrypt from "bcrypt";
import * as nodemailer from "nodemailer";
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
      emailVerificationOtpHash: _emailVerificationOtpHash,
      emailVerificationOtpExpiresAt: _emailVerificationOtpExpiresAt,
      ...rest
    } = obj as {
      passwordHash?: unknown;
      refreshTokenHash?: unknown;
      emailVerificationOtpHash?: unknown;
      emailVerificationOtpExpiresAt?: unknown;
    };
    void _passwordHash;
    void _refreshTokenHash;
    void _emailVerificationOtpHash;
    void _emailVerificationOtpExpiresAt;
    return rest;
  }

  private generateOtp() {
    return String(Math.floor(100000 + Math.random() * 900000));
  }

  private getOtpExpiryMinutes() {
    const raw = Number(process.env.OTP_EXPIRY_MINUTES || 10);
    return Number.isFinite(raw) && raw > 0 ? raw : 10;
  }

  private async sendOtpEmail(to: string, name: string, otp: string) {
    const host = process.env.SMTP_HOST;
    const port = Number(process.env.SMTP_PORT || 587);
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    const from = process.env.MAIL_FROM || user;
    const appName = process.env.APP_NAME || "Signature Auto Care";
    const expiry = this.getOtpExpiryMinutes();

    const subject = `${appName} email verification code`;
    const text = `Hi ${name || "there"}, your verification code is ${otp}. It expires in ${expiry} minutes.`;

    if (!host || !user || !pass || !from) {
      if (process.env.NODE_ENV === "production") {
        throw new InternalServerErrorException("SMTP is not configured");
      }
      // eslint-disable-next-line no-console
      console.warn(`[MAIL_FALLBACK] OTP for ${to}: ${otp}`);
      return;
    }

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });

    await transporter.sendMail({
      from,
      to,
      subject,
      text,
    });
  }

  async resendVerificationOtp(userId: string) {
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException("User not found");
    if (user.emailVerified) return this.toSafe(user);
    const otp = this.generateOtp();
    user.emailVerificationOtpHash = await bcrypt.hash(otp, 10);
    user.emailVerificationOtpExpiresAt = new Date(Date.now() + this.getOtpExpiryMinutes() * 60 * 1000);
    await user.save();
    await this.sendOtpEmail(user.email, user.name, otp);
    const safe = this.toSafe(user) as Record<string, unknown>;
    if (process.env.NODE_ENV !== "production") {
      safe.otpDebug = otp;
    }
    return safe;
  }

  async create(input: { email: string; password: string; name: string; role: Role }) {
    const exists = await this.findByEmail(input.email);
    if (exists) {
      throw new ConflictException("User already exists");
    }
    const hash = await bcrypt.hash(input.password, 10);
    const otp = this.generateOtp();
    const otpHash = await bcrypt.hash(otp, 10);
    const rolePermissions = DefaultRolePermissions[input.role];
    const user = await this.userModel.create({
      email: input.email.trim().toLowerCase(),
      passwordHash: hash,
      name: input.name,
      role: input.role,
      permissions: rolePermissions,
      isActive: false,
      emailVerified: false,
      emailVerificationOtpHash: otpHash,
      emailVerificationOtpExpiresAt: new Date(Date.now() + this.getOtpExpiryMinutes() * 60 * 1000),
    });
    await this.sendOtpEmail(user.email, user.name, otp);
    const safe = this.toSafe(user) as Record<string, unknown>;
    safe.verificationRequired = true;
    if (process.env.NODE_ENV !== "production") {
      safe.otpDebug = otp;
    }
    return safe;
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
    actor: { role?: string; permissions?: string[] }
  ) {
    void actor;
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

  async delete(id: string, actorId?: string) {
    const user = await this.userModel.findById(id);
    if (!user) throw new NotFoundException("User not found");
    if (actorId && user._id.toString() === actorId) {
      throw new ForbiddenException("You cannot delete your own account");
    }
    if (user.role === "OWNER_ADMIN") {
      throw new ForbiddenException("Owner/Admin users cannot be deleted");
    }
    await this.userModel.deleteOne({ _id: user._id });
    return { success: true, deletedUserId: id };
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

  async verifyEmailOtp(email: string, otp: string) {
    const normalizedEmail = email.trim().toLowerCase();
    const user = await this.userModel.findOne({ email: normalizedEmail });
    if (!user) {
      throw new NotFoundException("User not found");
    }
    if (user.emailVerified) {
      return { success: true, message: "Email already verified" };
    }
    if (!user.emailVerificationOtpHash || !user.emailVerificationOtpExpiresAt) {
      throw new ForbiddenException("Verification OTP not found");
    }
    if (user.emailVerificationOtpExpiresAt.getTime() < Date.now()) {
      throw new ForbiddenException("OTP expired");
    }
    const ok = await bcrypt.compare(otp, user.emailVerificationOtpHash);
    if (!ok) {
      throw new ForbiddenException("Invalid OTP");
    }
    user.emailVerified = true;
    user.isActive = true;
    user.emailVerificationOtpHash = undefined;
    user.emailVerificationOtpExpiresAt = undefined;
    await user.save();
    return { success: true, user: this.toSafe(user) };
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
      isActive: true,
      emailVerified: true,
    });
  }
}
