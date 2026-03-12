import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import {
  Customer,
  CustomerSchema,
  Vehicle,
  VehicleSchema,
  WorkOrder,
  WorkOrderSchema,
} from "../../schemas";
import { CustomersService } from "./customers.service";
import { CustomersController } from "./customers.controller";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Customer.name, schema: CustomerSchema },
      { name: Vehicle.name, schema: VehicleSchema },
      { name: WorkOrder.name, schema: WorkOrderSchema },
    ]),
  ],
  providers: [CustomersService],
  controllers: [CustomersController],
  exports: [CustomersService]
})
export class CustomersModule {}
