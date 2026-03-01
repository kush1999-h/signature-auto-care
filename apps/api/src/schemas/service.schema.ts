import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { HydratedDocument, Schema as MongooseSchema, Types } from "mongoose";

export type ServiceDocument = HydratedDocument<Service>;

@Schema({ timestamps: true })
export class Service {
  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ required: true, unique: true, trim: true, uppercase: true })
  code!: string;

  @Prop({ trim: true })
  category?: string;

  @Prop({ min: 0, type: MongooseSchema.Types.Decimal128, default: 0 })
  defaultPrice!: Types.Decimal128;

  @Prop({ min: 0, type: MongooseSchema.Types.Decimal128, default: 0 })
  defaultCost?: Types.Decimal128;

  @Prop({ default: false })
  taxable!: boolean;

  @Prop({ default: true })
  isActive!: boolean;
}

export const ServiceSchema = SchemaFactory.createForClass(Service);
ServiceSchema.index({ code: 1 }, { unique: true });
ServiceSchema.index({ name: 1 });
ServiceSchema.index({ isActive: 1 });

function toNumber(val: unknown) {
  if (val && typeof val === "object" && "toString" in val) {
    const text = (val as { toString: () => string }).toString();
    const parsed = Number(text);
    return Number.isNaN(parsed) ? val : parsed;
  }
  return val;
}

ServiceSchema.set("toJSON", {
  transform: (_doc, ret) => {
    ret.defaultPrice = toNumber(ret.defaultPrice);
    ret.defaultCost = toNumber(ret.defaultCost);
    return ret;
  }
});

