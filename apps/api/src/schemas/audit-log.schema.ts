import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { HydratedDocument, Types } from "mongoose";

export type AuditLogDocument = HydratedDocument<AuditLog>;

@Schema({ collection: "audit_logs", timestamps: { createdAt: "timestamp", updatedAt: false } })
export class AuditLog {
  @Prop({ required: true })
  actionType!: string;

  @Prop({ required: true })
  entityType!: string;

  @Prop({ required: true })
  entityId!: string;

  @Prop({ type: Types.ObjectId, ref: "User", required: true })
  performedByEmployeeId!: Types.ObjectId;

  @Prop()
  performedByName?: string;

  @Prop()
  performedByRole?: string;

  // store snapshots as plain objects
  @Prop({ type: Object })
  before?: Record<string, unknown>;

  @Prop({ type: Object })
  after?: Record<string, unknown>;
}

export const AuditLogSchema = SchemaFactory.createForClass(AuditLog);
AuditLogSchema.index({ entityType: 1, entityId: 1, timestamp: -1 });
