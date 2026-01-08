import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model, Types } from "mongoose";
import { AuditLog, User } from "../../schemas";

@Injectable()
export class AuditService {
  constructor(
    @InjectModel(AuditLog.name) private auditModel: Model<AuditLog>,
    @InjectModel(User.name) private userModel?: Model<User>
  ) {}

  async record(entry: Partial<AuditLog> & { performedByName?: string; performedByRole?: string }) {
    const enriched = { ...entry };

    // Backfill performer name/role if missing
    if (this.userModel && entry.performedByEmployeeId && (!entry.performedByName || !entry.performedByRole)) {
      const id =
        entry.performedByEmployeeId instanceof Types.ObjectId
          ? entry.performedByEmployeeId
          : new Types.ObjectId(String(entry.performedByEmployeeId));
      const user = await this.userModel.findById(id).select("name email role").lean();
      if (user) {
        if (!enriched.performedByName) {
          enriched.performedByName = user.name || user.email || id.toString();
        }
        if (!enriched.performedByRole && user.role) {
          enriched.performedByRole = user.role;
        }
      }
    }

    return this.auditModel.create(enriched);
  }

  async list(params: { entityType?: string; entityId?: string; actionType?: string | string[]; limit?: number } = {}) {
    const query: Record<string, unknown> = {};
    if (params.entityType) query.entityType = params.entityType;
    if (params.entityId) query.entityId = params.entityId;
    if (params.actionType) {
      query.actionType = Array.isArray(params.actionType) ? { $in: params.actionType } : params.actionType;
    }
    const limit = params.limit || 100;
    return this.auditModel.find(query).sort({ timestamp: -1 }).limit(limit).exec();
  }
}
