import { Permissions, Permission } from "./permissions";

export const Roles = {
  OWNER_ADMIN: "OWNER_ADMIN",
  OPS_MANAGER: "OPS_MANAGER",
  SERVICE_ADVISOR: "SERVICE_ADVISOR",
  TECHNICIAN: "TECHNICIAN",
  PAINTER: "PAINTER",
  INVENTORY_MANAGER: "INVENTORY_MANAGER",
  ACCOUNTANT: "ACCOUNTANT"
} as const;

export type Role = (typeof Roles)[keyof typeof Roles];

export const DefaultRolePermissions: Record<Role, Permission[]> = {
  [Roles.OWNER_ADMIN]: Object.values(Permissions),
  [Roles.OPS_MANAGER]: [
    Permissions.CUSTOMERS_READ,
    Permissions.CUSTOMERS_CREATE,
    Permissions.CUSTOMERS_UPDATE,
    Permissions.VEHICLES_READ,
    Permissions.VEHICLES_CREATE,
    Permissions.VEHICLES_UPDATE,
    Permissions.WORKORDERS_READ_ALL,
    Permissions.WORKORDERS_CREATE,
    Permissions.WORKORDERS_UPDATE_STATUS,
    Permissions.WORKORDERS_ASSIGN_EMPLOYEE,
    Permissions.WORKORDERS_ADD_NOTES,
    Permissions.WORKORDERS_ADD_ATTACHMENTS,
    Permissions.WORKORDERS_READ_SCHEDULED_POOL,
    Permissions.TIMELOGS_READ_ALL,
    Permissions.PARTS_READ,
    Permissions.PARTS_CREATE,
    Permissions.PARTS_UPDATE,
    Permissions.INVENTORY_PRICE_UPDATE,
    Permissions.INVENTORY_RECEIVE,
    Permissions.INVENTORY_ADJUST,
    Permissions.INVENTORY_ISSUE_TO_WORKORDER,
    Permissions.INVENTORY_COUNTER_SALE,
    Permissions.INVENTORY_REPORTS_READ,
    Permissions.INVOICES_READ,
    Permissions.PAYABLES_READ,
    Permissions.PAYABLES_UPDATE,
    Permissions.REPORTS_READ_SALES,
    Permissions.REPORTS_READ_PROFIT,
    Permissions.REPORTS_READ_INVENTORY,
    Permissions.AUDITLOGS_READ
  ],
  [Roles.SERVICE_ADVISOR]: [
    Permissions.CUSTOMERS_READ,
    Permissions.CUSTOMERS_CREATE,
    Permissions.CUSTOMERS_UPDATE,
    Permissions.VEHICLES_READ,
    Permissions.VEHICLES_CREATE,
    Permissions.VEHICLES_UPDATE,
    Permissions.WORKORDERS_READ_ASSIGNED,
    Permissions.WORKORDERS_READ_SCHEDULED_POOL,
    Permissions.WORKORDERS_CREATE,
    Permissions.WORKORDERS_UPDATE_STATUS,
    Permissions.WORKORDERS_ASSIGN_EMPLOYEE,
    Permissions.WORKORDERS_ADD_NOTES,
    Permissions.WORKORDERS_ADD_ATTACHMENTS,
    Permissions.PARTS_READ,
    Permissions.INVENTORY_ISSUE_TO_WORKORDER,
    Permissions.INVOICES_READ,
    Permissions.INVOICES_CREATE,
    Permissions.INVOICES_CLOSE,
    Permissions.PAYMENTS_CREATE,
    Permissions.PAYMENTS_READ,
    Permissions.REPORTS_READ_SALES,
    Permissions.INVENTORY_COUNTER_SALE
  ],
  [Roles.TECHNICIAN]: [
    Permissions.WORKORDERS_READ_ASSIGNED,
    Permissions.WORKORDERS_READ_SCHEDULED_POOL,
    Permissions.TIMELOGS_CREATE_SELF,
    Permissions.TIMELOGS_READ_SELF,
    Permissions.PARTS_READ
  ],
  [Roles.PAINTER]: [
    Permissions.WORKORDERS_READ_ASSIGNED,
    Permissions.WORKORDERS_READ_SCHEDULED_POOL,
    Permissions.TIMELOGS_CREATE_SELF,
    Permissions.TIMELOGS_READ_SELF,
    Permissions.PARTS_READ
  ],
  [Roles.INVENTORY_MANAGER]: [
    Permissions.PARTS_READ,
    Permissions.PARTS_CREATE,
    Permissions.PARTS_UPDATE,
    Permissions.INVENTORY_RECEIVE,
    Permissions.INVENTORY_ADJUST,
    Permissions.INVENTORY_ISSUE_TO_WORKORDER,
    Permissions.INVENTORY_REPORTS_READ,
    Permissions.INVOICES_READ,
    Permissions.PAYABLES_READ
  ],
  [Roles.ACCOUNTANT]: [
    Permissions.WORKORDERS_READ_ALL,
    Permissions.INVOICES_READ,
    Permissions.PAYMENTS_READ,
    Permissions.EXPENSES_READ,
    Permissions.EXPENSES_CREATE,
    Permissions.EXPENSES_UPDATE,
    Permissions.PAYABLES_READ,
    Permissions.PAYABLES_UPDATE,
    Permissions.REPORTS_READ_SALES,
    Permissions.REPORTS_READ_PROFIT,
    Permissions.REPORTS_EXPORT_PDF,
    Permissions.AUDITLOGS_READ
  ]
};
