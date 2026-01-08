import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { AuditLog, AuditLogSchema, User, UserSchema } from "../../schemas";
import { AuditService } from "./audit.service";
import { AuditController } from "./audit.controller";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AuditLog.name, schema: AuditLogSchema },
      { name: User.name, schema: UserSchema }
    ])
  ],
  providers: [AuditService],
  controllers: [AuditController],
  exports: [AuditService]
})
export class AuditModule {}
