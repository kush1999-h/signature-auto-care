import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { HydratedDocument, Schema as MongooseSchema, Types } from "mongoose";
import { WorkOrderStatus } from "@signature-auto-care/shared";

export type WorkOrderDocument = HydratedDocument<WorkOrder>;

@Schema({ timestamps: true })
export class WorkOrder {
  @Prop({ type: Types.ObjectId, ref: "Customer", required: true })
  customerId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: "Vehicle", required: true })
  vehicleId!: Types.ObjectId;

  @Prop()
  complaint?: string;

  @Prop({
    enum: Object.values(WorkOrderStatus),
    default: WorkOrderStatus.SCHEDULED,
  })
  status!: string;

  @Prop({
    type: [
      {
        employeeId: { type: Types.ObjectId, ref: "User" },
        roleType: { type: String },
      },
    ],
    default: [],
  })
  assignedEmployees!: { employeeId: Types.ObjectId; roleType: string }[];

  @Prop({ default: 0, type: MongooseSchema.Types.Decimal128 })
  billableLaborAmount!: Types.Decimal128;

  @Prop({
    type: [
      {
        partId: { type: Types.ObjectId, ref: "Part" },
        qty: Number,
        sellingPriceAtTime: { type: MongooseSchema.Types.Decimal128 },
        costAtTime: { type: MongooseSchema.Types.Decimal128 },
      },
    ],
    default: [],
  })
  partsUsed!: {
    partId: Types.ObjectId;
    qty: number;
    sellingPriceAtTime: Types.Decimal128;
    costAtTime?: Types.Decimal128;
  }[];

  @Prop({
    type: [
      {
        name: String,
        amount: { type: MongooseSchema.Types.Decimal128 },
      },
    ],
    default: [],
  })
  otherCharges!: { name: string; amount: Types.Decimal128 }[];

  @Prop({
    type: [
      {
        authorId: { type: Types.ObjectId, ref: "User" },
        message: String,
        createdAt: { type: Date, default: Date.now },
      },
    ],
    default: [],
  })
  notes!: { authorId: Types.ObjectId; message: string; createdAt: Date }[];
}

export const WorkOrderSchema = SchemaFactory.createForClass(WorkOrder);
WorkOrderSchema.index({ status: 1 });
WorkOrderSchema.index({ "assignedEmployees.employeeId": 1 });

function toNumber(val: unknown) {
  if (val && typeof val === "object" && "toString" in val) {
    const text = (val as { toString: () => string }).toString();
    const parsed = Number(text);
    return Number.isNaN(parsed) ? val : parsed;
  }
  return val;
}

WorkOrderSchema.set("toJSON", {
  transform: (_doc, ret) => {
    ret.billableLaborAmount = toNumber(ret.billableLaborAmount);
    if (Array.isArray(ret.partsUsed)) {
      ret.partsUsed = ret.partsUsed.map((p: unknown) => {
        const part = p as { sellingPriceAtTime?: unknown; costAtTime?: unknown };
        return {
          ...part,
          sellingPriceAtTime: toNumber(part.sellingPriceAtTime),
          costAtTime: toNumber(part.costAtTime),
        };
      });
    }
    if (Array.isArray(ret.otherCharges)) {
      ret.otherCharges = ret.otherCharges.map((c: unknown) => {
        const charge = c as { amount?: unknown };
        return {
          ...charge,
          amount: toNumber(charge.amount),
        };
      });
    }
    return ret;
  },
});
