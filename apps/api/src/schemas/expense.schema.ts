import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { HydratedDocument, Schema as MongooseSchema, Types } from "mongoose";

export type ExpenseDocument = HydratedDocument<Expense>;

@Schema({ timestamps: true })
export class Expense {
  @Prop({ required: true })
  category!: string;

  @Prop({ required: true, type: MongooseSchema.Types.Decimal128 })
  amount!: Types.Decimal128;

  @Prop({ required: true })
  expenseDate!: Date;

  @Prop()
  note?: string;

  @Prop({ default: false })
  isDeleted?: boolean;
}

export const ExpenseSchema = SchemaFactory.createForClass(Expense);
ExpenseSchema.index({ expenseDate: -1 });

function toNumber(val: unknown) {
  if (val && typeof val === "object" && "toString" in val) {
    const text = (val as { toString: () => string }).toString();
    const parsed = Number(text);
    return Number.isNaN(parsed) ? val : parsed;
  }
  return val;
}

ExpenseSchema.set("toJSON", {
  transform: (_doc, ret) => {
    ret.amount = toNumber(ret.amount);
    return ret;
  }
});
