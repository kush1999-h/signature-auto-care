export const WorkOrderStatus = {
  SCHEDULED: "Scheduled",
  IN_PROGRESS: "In Progress",
  WAITING_PARTS: "Waiting Parts",
  COMPLETED: "Completed",
  CLOSED: "Closed"
} as const;

export type WorkOrderStatusType = (typeof WorkOrderStatus)[keyof typeof WorkOrderStatus];

export const InvoiceType = {
  WORK_ORDER: "WORK_ORDER",
  COUNTER_SALE: "COUNTER_SALE"
} as const;

export const InvoiceStatus = {
  DRAFT: "DRAFT",
  CLOSED: "CLOSED",
  VOID: "VOID"
} as const;

export const InventoryTransactionType = {
  RECEIVE: "RECEIVE",
  ISSUE_TO_WORK_ORDER: "ISSUE_TO_WORK_ORDER",
  COUNTER_SALE: "COUNTER_SALE",
  ADJUSTMENT: "ADJUSTMENT",
  RETURN: "RETURN"
} as const;

export const InventoryReferenceType = {
  WORK_ORDER: "WORK_ORDER",
  INVOICE: "INVOICE",
  COUNTER_SALE: "COUNTER_SALE",
  ADJUSTMENT: "ADJUSTMENT",
  PURCHASE: "PURCHASE"
} as const;
