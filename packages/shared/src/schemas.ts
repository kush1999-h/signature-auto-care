import { z } from "zod";
import { InvoiceStatus, InvoiceType, InventoryTransactionType, WorkOrderStatus } from "./enums";

export const permissionSchema = z.string();
export const roleSchema = z.string();

export const userSchema = z.object({
  _id: z.string().optional(),
  email: z.string().email(),
  password: z.string().optional(),
  name: z.string(),
  role: roleSchema,
  permissions: z.array(permissionSchema),
  isActive: z.boolean().default(true)
});

export const authMeSchema = userSchema.omit({ password: true });

export const customerSchema = z.object({
  _id: z.string().optional(),
  name: z.string(),
  phone: z.string(),
  email: z.string().optional(),
  address: z.string().optional()
});

export const vehicleSchema = z.object({
  _id: z.string().optional(),
  customerId: z.string(),
  vin: z.string().optional(),
  plate: z.string().optional(),
  make: z.string().optional(),
  model: z.string().optional(),
  year: z.number().optional(),
  mileage: z.number().optional()
});

export const partSchema = z.object({
  _id: z.string().optional(),
  partName: z.string(),
  sku: z.string(),
  barcode: z.string().optional(),
  purchasePrice: z.number().optional(),
  sellingPrice: z.number().optional(),
  avgCost: z.number().optional(),
  description: z.string().optional(),
  category: z.string().optional(),
  vendorName: z.string().optional(),
  reorderLevel: z.number().optional(),
  unit: z.string().optional(),
  onHandQty: z.number().optional(),
  reservedQty: z.number().optional()
});

export const inventoryTransactionSchema = z.object({
  _id: z.string().optional(),
  type: z.nativeEnum(InventoryTransactionType),
  partId: z.string(),
  qtyChange: z.number(),
  unitCost: z.number().optional(),
  unitPrice: z.number().optional(),
  paymentMethod: z.string().optional(),
  vendorName: z.string().optional(),
  referenceType: z.string().optional(),
  referenceId: z.string().optional(),
  performedByEmployeeId: z.string(),
  performedByName: z.string().optional(),
  performedByRole: z.string().optional(),
  idempotencyKey: z.string().optional(),
  reversesTransactionId: z.string().optional(),
  createdAt: z.string(),
  notes: z.string().optional()
});

export const workOrderSchema = z.object({
  _id: z.string().optional(),
  customerId: z.string(),
  vehicleId: z.string(),
  complaint: z.string().optional(),
  status: z.nativeEnum(WorkOrderStatus),
  assignedEmployees: z
    .array(
      z.object({
        employeeId: z.string(),
        roleType: z.string()
      })
    )
    .optional(),
  billableLaborAmount: z.number().optional(),
  partsUsed: z
    .array(
      z.object({
        partId: z.string(),
        qty: z.number(),
        sellingPriceAtTime: z.number(),
        costAtTime: z.number().optional()
      })
    )
    .optional(),
  otherCharges: z
    .array(
      z.object({
        name: z.string(),
        amount: z.number()
      })
    )
    .optional()
});

export const invoiceLineItemSchema = z.object({
  type: z.enum(["PART", "LABOR", "OTHER"]),
  description: z.string(),
  quantity: z.number().default(1),
  unitPrice: z.number(),
  total: z.number(),
  costAtTime: z.number().optional()
});

export const invoiceSchema = z.object({
  _id: z.string().optional(),
  invoiceNumber: z.string(),
  idempotencyKey: z.string().optional(),
  type: z.nativeEnum(InvoiceType),
  customerId: z.string().optional(),
  vehicleId: z.string().optional(),
  workOrderId: z.string().optional(),
  lineItems: z.array(invoiceLineItemSchema),
  subtotal: z.number(),
  tax: z.number().default(0),
  total: z.number(),
  status: z.nativeEnum(InvoiceStatus),
  createdAt: z.string()
});

export const paymentSchema = z.object({
  _id: z.string().optional(),
  invoiceId: z.string(),
  method: z.string(),
  amount: z.number(),
  paidAt: z.string(),
  note: z.string().optional()
});

export const expenseSchema = z.object({
  _id: z.string().optional(),
  category: z.string(),
  amount: z.number(),
  expenseDate: z.string(),
  note: z.string().optional()
});

export const payableSchema = z.object({
  _id: z.string().optional(),
  category: z.string(),
  amount: z.number(),
  purchaseDate: z.string(),
  dueDate: z.string().optional(),
  status: z.string().optional(),
  partId: z.string().optional(),
  transactionId: z.string().optional(),
  vendorName: z.string().optional(),
  qty: z.number(),
  unitCost: z.number(),
  createdByEmployeeId: z.string().optional(),
  createdByName: z.string().optional(),
  createdByRole: z.string().optional(),
  note: z.string().optional(),
  paidAt: z.string().optional()
});
