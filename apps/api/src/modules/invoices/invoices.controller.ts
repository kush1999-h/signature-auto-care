import { Body, Controller, Get, Headers, Param, Post, UseGuards } from "@nestjs/common";
import { InvoicesService } from "./invoices.service";
import { JwtAuthGuard } from "../auth/jwt.guard";
import { PermissionsGuard } from "../../common/guards/permissions.guard";
import { PermissionsRequired } from "../../common/decorators/permissions.decorator";
import { Permissions } from "@signature-auto-care/shared";
import { AuthUser, CurrentUser } from "../../common/decorators/current-user.decorator";
import type { Invoice } from "../../schemas";

type CloseInvoiceBody = {
  payment: { method: string; amount: number };
};

type CounterSaleBody = {
  customerId?: string;
  items: { partId: string; qty: number }[];
  payment: { method: string; amount: number };
};

@Controller()
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class InvoicesController {
  constructor(private invoices: InvoicesService) {}

  @Get("invoices")
  @PermissionsRequired(Permissions.INVOICES_READ)
  list() {
    return this.invoices.list();
  }

  @Post("invoices")
  @PermissionsRequired(Permissions.INVOICES_CREATE)
  create(@Body() body: Partial<Invoice>) {
    return this.invoices.create(body);
  }

  @Post("invoices/:id/close")
  @PermissionsRequired(Permissions.INVOICES_CLOSE)
  close(@Param("id") id: string, @Body() body: CloseInvoiceBody, @CurrentUser() user: AuthUser) {
    const performedBy = user.userId || user.sub;
    if (!performedBy) throw new Error("User ID not found");
    return this.invoices.closeInvoice({
      invoiceId: id,
      payment: body.payment,
      performedBy
    });
  }

  @Post("counter-sales/checkout")
  @PermissionsRequired(Permissions.INVENTORY_COUNTER_SALE)
  counterSale(
    @Body() body: CounterSaleBody,
    @CurrentUser() user: AuthUser,
    @Headers("idempotency-key") idempotencyKey?: string
  ) {
    const performedBy = user.userId || user.sub;
    if (!performedBy) throw new Error("User ID not found");
    return this.invoices.counterSaleCheckout({
      customerId: body.customerId,
      items: body.items,
      payment: body.payment,
      performedBy,
      idempotencyKey
    });
  }
}
