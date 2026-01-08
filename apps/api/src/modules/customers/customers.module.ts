import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { Customer, CustomerSchema, Vehicle, VehicleSchema } from "../../schemas";
import { CustomersService } from "./customers.service";
import { CustomersController } from "./customers.controller";

@Module({
  imports: [MongooseModule.forFeature([{ name: Customer.name, schema: CustomerSchema }, { name: Vehicle.name, schema: VehicleSchema }])],
  providers: [CustomersService],
  controllers: [CustomersController],
  exports: [CustomersService]
})
export class CustomersModule {}
