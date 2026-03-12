import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { HydratedDocument, Schema as MongooseSchema, Types } from "mongoose";

export type VendorPaymentDocument = HydratedDocument<VendorPayment>;

@Schema({ timestamps: true })
export class VendorPayment {
  @Prop({ type: Types.ObjectId, ref: "Payable", required: true, index: true })
  payableId!: Types.ObjectId;

  @Prop()
  vendorName?: string;

  @Prop({ required: true, type: MongooseSchema.Types.Decimal128 })
  amount!: Types.Decimal128;

  @Prop({ required: true })
  method!: string;

  @Prop({ default: () => new Date() })
  paidAt!: Date;

  @Prop()
  note?: string;

  @Prop({ type: Types.ObjectId, ref: "User" })
  createdByEmployeeId?: Types.ObjectId;

  @Prop()
  createdByName?: string;

  @Prop()
  createdByRole?: string;
}

export const VendorPaymentSchema = SchemaFactory.createForClass(VendorPayment);
VendorPaymentSchema.index({ payableId: 1, paidAt: -1 });

function toNumber(val: unknown) {
  if (val && typeof val === "object" && "toString" in val) {
    const text = (val as { toString: () => string }).toString();
    const parsed = Number(text);
    return Number.isNaN(parsed) ? val : parsed;
  }
  return val;
}

VendorPaymentSchema.set("toJSON", {
  transform: (_doc, ret) => {
    ret.amount = toNumber(ret.amount);
    return ret;
  }
});
