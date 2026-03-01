import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ServicesService } from "./services.service";
import { JwtAuthGuard } from "../auth/jwt.guard";
import { PermissionsGuard } from "../../common/guards/permissions.guard";
import { PermissionsRequired } from "../../common/decorators/permissions.decorator";
import { Permissions } from "@signature-auto-care/shared";

type ServiceBody = {
  name?: string;
  code?: string;
  category?: string;
  defaultPrice?: number | string;
  defaultCost?: number | string;
  taxable?: boolean;
  isActive?: boolean;
};

type PriceBody = {
  defaultPrice?: number | string;
  defaultCost?: number | string;
};

@Controller()
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ServicesController {
  constructor(private services: ServicesService) {}

  @Get("services")
  @PermissionsRequired(Permissions.SERVICES_READ)
  list(@Query("search") search?: string, @Query("activeOnly") activeOnly?: string) {
    return this.services.list({
      search,
      activeOnly: activeOnly === "1" || activeOnly === "true",
    });
  }

  @Post("services")
  @PermissionsRequired(Permissions.SERVICES_CREATE)
  create(@Body() body: ServiceBody) {
    return this.services.create({
      ...body,
      defaultPrice: body.defaultPrice !== undefined ? Number(body.defaultPrice) : undefined,
      defaultCost: body.defaultCost !== undefined ? Number(body.defaultCost) : undefined,
    });
  }

  @Patch("services/:id")
  @PermissionsRequired(Permissions.SERVICES_UPDATE)
  update(@Param("id") id: string, @Body() body: ServiceBody) {
    return this.services.update(id, {
      ...body,
      defaultPrice: body.defaultPrice !== undefined ? Number(body.defaultPrice) : undefined,
      defaultCost: body.defaultCost !== undefined ? Number(body.defaultCost) : undefined,
    });
  }

  @Patch("services/:id/price")
  @PermissionsRequired(Permissions.SERVICES_PRICE_UPDATE)
  updatePrice(@Param("id") id: string, @Body() body: PriceBody) {
    return this.services.updatePrice(id, {
      defaultPrice: body.defaultPrice !== undefined ? Number(body.defaultPrice) : undefined,
      defaultCost: body.defaultCost !== undefined ? Number(body.defaultCost) : undefined,
    });
  }
}

