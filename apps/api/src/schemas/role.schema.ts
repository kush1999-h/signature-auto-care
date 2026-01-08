import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { HydratedDocument } from "mongoose";
import { Permission, Role, Roles } from "@signature-auto-care/shared";

export type RoleDocument = HydratedDocument<RoleEntity>;

@Schema({ collection: "roles" })
export class RoleEntity {
  @Prop({ required: true, unique: true, type: String, enum: Object.values(Roles) })
  name!: Role;

  @Prop({ type: [String], default: [] })
  permissions!: Permission[];
}

export const RoleSchema = SchemaFactory.createForClass(RoleEntity);
