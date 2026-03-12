import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { HydratedDocument, Schema as MongooseSchema, Types } from "mongoose";
import { WorkOrderStatus } from "@signature-auto-care/shared";

export type WorkOrderDocument = HydratedDocument<WorkOrder>;

@Schema({ timestamps: true })
export class WorkOrder {
  @Prop({ required: true, unique: true, trim: true })
  workOrderNumber!: string;

  @Prop({ type: Types.ObjectId, ref: "Customer", required: true })
  customerId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: "Vehicle", required: true })
  vehicleId!: Types.ObjectId;

  @Prop()
  complaint?: string;

  @Prop({ trim: true, maxlength: 120 })
  reference?: string;

  @Prop({ default: 0, min: 0, type: MongooseSchema.Types.Decimal128 })
  advanceAmount!: Types.Decimal128;

  @Prop({ default: 0, min: 0, type: MongooseSchema.Types.Decimal128 })
  advanceAppliedAmount!: Types.Decimal128;

  @Prop({ type: Number, min: 0, max: 100 })
  oilLevelPct?: number;

  @Prop({
    enum: Object.values(WorkOrderStatus),
    default: WorkOrderStatus.SCHEDULED,
  })
  status!: string;

  @Prop({ type: Date, default: null })
  deliveredAt?: Date | null;

  @Prop({ type: Date })
  dateIn?: Date;

  @Prop({ default: false })
  isHistorical?: boolean;

  @Prop({ trim: true, maxlength: 200 })
  historicalSource?: string;

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
        serviceId: { type: Types.ObjectId, ref: "Service" },
        nameAtTime: String,
        qty: Number,
        unitPriceAtTime: { type: MongooseSchema.Types.Decimal128 },
        unitCostAtTime: { type: MongooseSchema.Types.Decimal128 },
      },
    ],
    default: [],
  })
  servicesUsed!: {
    serviceId: Types.ObjectId;
    nameAtTime: string;
    qty: number;
    unitPriceAtTime: Types.Decimal128;
    unitCostAtTime?: Types.Decimal128;
  }[];

  @Prop({
    type: [
      {
        name: String,
        amount: { type: MongooseSchema.Types.Decimal128 },
        costAtTime: { type: MongooseSchema.Types.Decimal128 },
      },
    ],
    default: [],
  })
  otherCharges!: { name: string; amount: Types.Decimal128; costAtTime?: Types.Decimal128 }[];

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
WorkOrderSchema.index({ workOrderNumber: 1 }, { unique: true });
WorkOrderSchema.index({ status: 1 });
WorkOrderSchema.index({ deliveredAt: 1 });
WorkOrderSchema.index({ dateIn: 1 });
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
    ret.advanceAmount = toNumber(ret.advanceAmount);
    ret.advanceAppliedAmount = toNumber(ret.advanceAppliedAmount);
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
        const charge = c as { amount?: unknown; costAtTime?: unknown };
        return {
          ...charge,
          amount: toNumber(charge.amount),
          costAtTime: toNumber(charge.costAtTime),
        };
      });
    }
    if (Array.isArray(ret.servicesUsed)) {
      ret.servicesUsed = ret.servicesUsed.map((s: unknown) => {
        const service = s as { unitPriceAtTime?: unknown; unitCostAtTime?: unknown };
        return {
          ...service,
          unitPriceAtTime: toNumber(service.unitPriceAtTime),
          unitCostAtTime: toNumber(service.unitCostAtTime),
        };
      });
    }
    return ret;
  },
});
