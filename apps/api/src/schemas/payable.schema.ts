import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { HydratedDocument, Schema as MongooseSchema, Types } from "mongoose";

export type PayableDocument = HydratedDocument<Payable>;

@Schema({ timestamps: true })
export class Payable {
  @Prop({ required: true })
  category!: string;

  @Prop({ required: true, type: MongooseSchema.Types.Decimal128 })
  amount!: Types.Decimal128;

  @Prop({ required: true })
  purchaseDate!: Date;

  @Prop()
  dueDate?: Date;

  @Prop({ default: "OPEN" })
  status?: string;

  @Prop({ type: Types.ObjectId, ref: "Part" })
  partId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: "InventoryTransaction" })
  transactionId?: Types.ObjectId;

  @Prop()
  vendorName?: string;

  @Prop({ required: true })
  qty!: number;

  @Prop({ required: true, type: MongooseSchema.Types.Decimal128 })
  unitCost!: Types.Decimal128;

  @Prop({ type: Types.ObjectId, ref: "User" })
  createdByEmployeeId?: Types.ObjectId;

  @Prop()
  createdByName?: string;

  @Prop()
  createdByRole?: string;

  @Prop()
  note?: string;

  @Prop()
  paidAt?: Date;
}

export const PayableSchema = SchemaFactory.createForClass(Payable);
PayableSchema.index({ status: 1, purchaseDate: -1 });

function toNumber(val: unknown) {
  if (val && typeof val === "object" && "toString" in val) {
    const text = (val as { toString: () => string }).toString();
    const parsed = Number(text);
    return Number.isNaN(parsed) ? val : parsed;
  }
  return val;
}

PayableSchema.set("toJSON", {
  transform: (_doc, ret) => {
    ret.amount = toNumber(ret.amount);
    ret.unitCost = toNumber(ret.unitCost);
    return ret;
  }
});
