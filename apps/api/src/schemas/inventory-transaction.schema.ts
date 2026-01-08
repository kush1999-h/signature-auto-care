import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { HydratedDocument, Schema as MongooseSchema, Types } from "mongoose";
import {
  InventoryReferenceType,
  InventoryTransactionType,
} from "@signature-auto-care/shared";

export type InventoryTransactionDocument =
  HydratedDocument<InventoryTransaction>;

@Schema({
  collection: "inventory_transactions",
  timestamps: { createdAt: true, updatedAt: false },
})
export class InventoryTransaction {
  @Prop({ required: true, enum: Object.values(InventoryTransactionType) })
  type!: string;

  @Prop({ type: Types.ObjectId, ref: "Part", required: true })
  partId!: Types.ObjectId;

  @Prop({
    required: true,
    validate: {
      validator: (v: number) => Number.isInteger(v),
      message: "Quantity must be an integer",
    },
  })
  qtyChange!: number;

  @Prop({ type: MongooseSchema.Types.Decimal128, required: true })
  unitCost!: Types.Decimal128;

  @Prop({ type: MongooseSchema.Types.Decimal128 })
  unitPrice?: Types.Decimal128;

  @Prop()
  paymentMethod?: string;

  @Prop()
  vendorName?: string;

  @Prop({ enum: Object.values(InventoryReferenceType), required: false })
  referenceType?: string;

  @Prop({ type: String })
  referenceId?: string;

  @Prop({ type: Types.ObjectId, ref: "User", required: true })
  performedByEmployeeId!: Types.ObjectId;

  @Prop()
  performedByName?: string;

  @Prop()
  performedByRole?: string;

  @Prop({ unique: true, sparse: true })
  idempotencyKey?: string;

  @Prop({ type: Types.ObjectId })
  reversesTransactionId?: Types.ObjectId;

  @Prop()
  notes?: string;
}

export const InventoryTransactionSchema =
  SchemaFactory.createForClass(InventoryTransaction);
InventoryTransactionSchema.index({ partId: 1, createdAt: -1 });
InventoryTransactionSchema.index({
  referenceType: 1,
  referenceId: 1,
  createdAt: -1,
});

function toNumber(val: unknown) {
  if (val && typeof val === "object" && "toString" in val) {
    const text = (val as { toString: () => string }).toString();
    const parsed = Number(text);
    return Number.isNaN(parsed) ? val : parsed;
  }
  return val;
}

InventoryTransactionSchema.set("toJSON", {
  transform: (_doc, ret) => {
    ret.unitCost = toNumber(ret.unitCost);
    ret.unitPrice = toNumber(ret.unitPrice);
    return ret;
  },
});
