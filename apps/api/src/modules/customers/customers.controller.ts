import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { CustomersService } from "./customers.service";
import { JwtAuthGuard } from "../auth/jwt.guard";
import { PermissionsGuard } from "../../common/guards/permissions.guard";
import { PermissionsRequired } from "../../common/decorators/permissions.decorator";
import { Permissions } from "@signature-auto-care/shared";
import type { Customer, Vehicle } from "../../schemas";

@Controller()
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CustomersController {
  constructor(private customers: CustomersService) {}

  @Get("customers")
  @PermissionsRequired(Permissions.CUSTOMERS_READ)
  listCustomers() {
    return this.customers.listCustomers();
  }

  @Get("customers/:id")
  @PermissionsRequired(Permissions.CUSTOMERS_READ)
  getCustomer(@Param("id") id: string) {
    return this.customers.getCustomer(id);
  }

  @Post("customers")
  @PermissionsRequired(Permissions.CUSTOMERS_CREATE)
  createCustomer(@Body() body: Partial<Customer>) {
    return this.customers.createCustomer(body);
  }

  @Patch("customers/:id")
  @PermissionsRequired(Permissions.CUSTOMERS_UPDATE)
  updateCustomer(@Param("id") id: string, @Body() body: Partial<Customer>) {
    return this.customers.updateCustomer(id, body);
  }

  @Get("customers/search/by-phone")
  @PermissionsRequired(Permissions.CUSTOMERS_READ)
  searchByPhone(@Query("phone") phone?: string) {
    if (!phone) {
      return { results: [] };
    }
    return this.customers.searchCustomerByPhone(phone).then((results) => ({
      results,
      count: results.length,
    }));
  }

  @Get("customers/:customerId/vehicles")
  @PermissionsRequired(Permissions.VEHICLES_READ)
  listVehicles(@Param("customerId") customerId: string) {
    return this.customers.listVehiclesByCustomer(customerId);
  }

  @Post("vehicles")
  @PermissionsRequired(Permissions.VEHICLES_CREATE)
  createVehicle(@Body() body: Partial<Vehicle>) {
    return this.customers.addVehicle(body);
  }

  @Patch("vehicles/:id")
  @PermissionsRequired(Permissions.VEHICLES_UPDATE)
  updateVehicle(@Param("id") id: string, @Body() body: Partial<Vehicle>) {
    return this.customers.updateVehicle(id, body);
  }
}
