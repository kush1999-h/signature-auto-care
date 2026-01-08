import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { HydratedDocument, Schema as MongooseSchema, Types } from "mongoose";
import { InvoiceStatus, InvoiceType } from "@signature-auto-care/shared";

export type InvoiceDocument = HydratedDocument<Invoice>;

@Schema({ timestamps: true })
export class Invoice {
  @Prop({ required: true, unique: true })
  invoiceNumber!: string;

  @Prop({ unique: true, sparse: true })
  idempotencyKey?: string;

  @Prop({ enum: Object.values(InvoiceType), required: true })
  type!: string;

  @Prop({ type: Types.ObjectId, ref: "Customer" })
  customerId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: "Vehicle" })
  vehicleId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: "WorkOrder" })
  workOrderId?: Types.ObjectId;

  @Prop({
    type: [
      {
        type: { type: String },
        description: String,
        quantity: Number,
        unitPrice: { type: MongooseSchema.Types.Decimal128 },
        total: { type: MongooseSchema.Types.Decimal128 },
        costAtTime: { type: MongooseSchema.Types.Decimal128 }
      }
    ],
    default: []
  })
  lineItems!: { type: string; description: string; quantity: number; unitPrice: Types.Decimal128; total: Types.Decimal128; costAtTime?: Types.Decimal128 }[];

  @Prop({ default: 0, type: MongooseSchema.Types.Decimal128 })
  subtotal!: Types.Decimal128;

  @Prop({ default: 0, type: MongooseSchema.Types.Decimal128 })
  tax!: Types.Decimal128;

  @Prop({ default: 0, type: MongooseSchema.Types.Decimal128 })
  total!: Types.Decimal128;

  @Prop({ enum: Object.values(InvoiceStatus), default: InvoiceStatus.DRAFT })
  status!: string;
}

export const InvoiceSchema = SchemaFactory.createForClass(Invoice);
InvoiceSchema.index({ invoiceNumber: 1 }, { unique: true });

function toNumber(val: unknown) {
  if (val && typeof val === "object" && "toString" in val) {
    const text = (val as { toString: () => string }).toString();
    const parsed = Number(text);
    return Number.isNaN(parsed) ? val : parsed;
  }
  return val;
}

InvoiceSchema.set("toJSON", {
  transform: (_doc, ret) => {
    ret.subtotal = toNumber(ret.subtotal);
    ret.tax = toNumber(ret.tax);
    ret.total = toNumber(ret.total);
    if (Array.isArray(ret.lineItems)) {
      ret.lineItems = ret.lineItems.map((li: unknown) => {
        const item = li as { unitPrice?: unknown; total?: unknown; costAtTime?: unknown };
        return {
          ...item,
          unitPrice: toNumber(item.unitPrice),
          total: toNumber(item.total),
          costAtTime: toNumber(item.costAtTime)
        };
      });
    }
    return ret;
  }
});
