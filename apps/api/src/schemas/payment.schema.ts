import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { HydratedDocument, Types } from "mongoose";
import { PaymentType } from "@signature-auto-care/shared";

export type PaymentDocument = HydratedDocument<Payment>;

@Schema({ timestamps: true })
export class Payment {
  @Prop({ type: Types.ObjectId, ref: "Invoice", required: true })
  invoiceId!: Types.ObjectId;

  @Prop({ enum: Object.values(PaymentType), default: PaymentType.INVOICE_PAYMENT })
  paymentType!: string;

  @Prop({ required: true })
  method!: string;

  @Prop({ required: true })
  amount!: Types.Decimal128;

  @Prop({ default: () => new Date() })
  paidAt!: Date;

  @Prop()
  note?: string;

  @Prop({ default: false })
  isVoided?: boolean;

  @Prop()
  voidedAt?: Date;

  @Prop()
  voidReason?: string;

  @Prop({ type: Types.ObjectId, ref: "User" })
  voidedByEmployeeId?: Types.ObjectId;

  @Prop()
  voidedByName?: string;

  @Prop()
  voidedByRole?: string;

  @Prop({ type: Types.ObjectId, ref: "Payment" })
  reversesPaymentId?: Types.ObjectId;
}

export const PaymentSchema = SchemaFactory.createForClass(Payment);
PaymentSchema.index({ invoiceId: 1 });

function toNumber(val: unknown) {
  if (val && typeof val === "object" && "toString" in val) {
    const text = (val as { toString: () => string }).toString();
    const parsed = Number(text);
    return Number.isNaN(parsed) ? val : parsed;
  }
  return val;
}

PaymentSchema.set("toJSON", {
  transform: (_doc, ret) => {
    ret.amount = toNumber(ret.amount);
    return ret;
  }
});
