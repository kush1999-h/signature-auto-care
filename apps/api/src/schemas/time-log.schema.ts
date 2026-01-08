import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { HydratedDocument, Types } from "mongoose";

export type TimeLogDocument = HydratedDocument<TimeLog>;

@Schema({ collection: "time_logs", timestamps: true })
export class TimeLog {
  @Prop({ type: Types.ObjectId, ref: "WorkOrder", required: true })
  workOrderId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: "User", required: true })
  employeeId!: Types.ObjectId;

  @Prop({ required: true })
  clockInAt!: Date;

  @Prop()
  clockOutAt?: Date;

  @Prop()
  durationMinutes?: number;
}

export const TimeLogSchema = SchemaFactory.createForClass(TimeLog);
TimeLogSchema.index({ workOrderId: 1, employeeId: 1 });
