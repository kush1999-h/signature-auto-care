import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { Service, ServiceSchema } from "../../schemas";
import { ServicesService } from "./services.service";
import { ServicesController } from "./services.controller";

@Module({
  imports: [MongooseModule.forFeature([{ name: Service.name, schema: ServiceSchema }])],
  providers: [ServicesService],
  controllers: [ServicesController],
  exports: [ServicesService],
})
export class ServicesModule {}

