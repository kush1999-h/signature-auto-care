import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { HydratedDocument, Schema as MongooseSchema, Types } from "mongoose";

export type PartDocument = HydratedDocument<Part>;

@Schema({ timestamps: true })
export class Part {
  @Prop({ required: true })
  partName!: string;

  @Prop({ required: true, unique: true })
  sku!: string;

  @Prop()
  barcode?: string;

  @Prop({ min: 0, type: MongooseSchema.Types.Decimal128, default: 0 })
  purchasePrice?: Types.Decimal128;

  @Prop({ min: 0, type: MongooseSchema.Types.Decimal128, default: 0 })
  sellingPrice?: Types.Decimal128;

  @Prop({ type: MongooseSchema.Types.Decimal128, default: 0 })
  avgCost?: Types.Decimal128;

  @Prop()
  description?: string;

  @Prop()
  category?: string;

  @Prop()
  vendorName?: string;

  @Prop()
  reorderLevel?: number;

  @Prop()
  unit?: string;

  @Prop({ default: 0 })
  onHandQty!: number;

  @Prop({ default: 0 })
  reservedQty!: number;
}

export const PartSchema = SchemaFactory.createForClass(Part);
PartSchema.index({ sku: 1 }, { unique: true });
PartSchema.index({ barcode: 1 }, { unique: true, sparse: true });

PartSchema.virtual("availableQty").get(function (this: { onHandQty?: number; reservedQty?: number }) {
  const onHand = this.onHandQty || 0;
  const reserved = this.reservedQty || 0;
  return onHand - reserved;
});

function toNumber(val: unknown) {
  if (val && typeof val === "object" && "toString" in val) {
    const text = (val as { toString: () => string }).toString();
    const parsed = Number(text);
    return Number.isNaN(parsed) ? val : parsed;
  }
  return val;
}

PartSchema.set("toJSON", {
  transform: (_doc, ret) => {
    ret.purchasePrice = toNumber(ret.purchasePrice);
    ret.sellingPrice = toNumber(ret.sellingPrice);
    ret.avgCost = toNumber(ret.avgCost);
    ret.availableQty = (ret.onHandQty || 0) - (ret.reservedQty || 0);
    return ret;
  }
});
