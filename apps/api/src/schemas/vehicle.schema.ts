import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { HydratedDocument, Types } from "mongoose";

export type VehicleDocument = HydratedDocument<Vehicle>;

@Schema({ timestamps: true })
export class Vehicle {
  @Prop({ type: Types.ObjectId, ref: "Customer", required: true })
  customerId!: Types.ObjectId;

  @Prop()
  vin?: string;

  @Prop()
  plate?: string;

  @Prop()
  make?: string;

  @Prop()
  model?: string;

  @Prop()
  year?: number;

  @Prop()
  mileage?: number;
}

export const VehicleSchema = SchemaFactory.createForClass(Vehicle);
VehicleSchema.index({ customerId: 1, plate: 1 });
