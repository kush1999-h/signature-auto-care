"use client";

import type { Route } from "next";
import {
  BarChart3,
  ClipboardList,
  ClipboardPlus,
  DollarSign,
  Gauge,
  Package,
  Receipt,
  ShieldCheck,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  href: Route;
  label: string;
  icon: LucideIcon;
  permission?: string;
  permissions?: string[];
  roles?: string[];
};

export type NavGroup = {
  label: string;
  items: NavItem[];
};

export const navGroups: NavGroup[] = [
  {
    label: "Front Desk",
    items: [
      { href: "/" as const, label: "Dashboard", icon: Gauge },
      { href: "/intake" as const, label: "Intake", icon: ClipboardPlus, permission: "WORKORDERS_CREATE" },
      {
        href: "/work-orders" as const,
        label: "Work Orders",
        icon: ClipboardList,
        permissions: ["WORKORDERS_READ_ASSIGNED", "WORKORDERS_READ_ALL"],
      },
      {
        href: "/customers-history" as const,
        label: "Customers",
        icon: Users,
        permissions: ["CUSTOMERS_READ", "VEHICLES_READ", "INVOICES_READ"],
      },
    ],
  },
  {
    label: "Billing",
    items: [
      { href: "/invoices" as const, label: "Invoices", icon: Receipt, permission: "INVOICES_READ" },
      { href: "/receivables" as const, label: "Receivables", icon: Receipt, permission: "INVOICES_READ" },
      { href: "/expenses" as const, label: "Expenses", icon: DollarSign, permission: "EXPENSES_READ" },
      { href: "/payables" as const, label: "Payables", icon: DollarSign, permission: "PAYABLES_READ" },
      {
        href: "/reports" as const,
        label: "Reports",
        icon: BarChart3,
        permissions: ["REPORTS_READ_SALES", "REPORTS_READ_PROFIT", "REPORTS_READ_INVENTORY"],
      },
    ],
  },
  {
    label: "Catalog",
    items: [
      { href: "/inventory" as const, label: "Inventory", icon: Package, permission: "PARTS_READ" },
      { href: "/services" as const, label: "Services", icon: Wrench, permission: "SERVICES_READ" },
      { href: "/counter-sale" as const, label: "Counter Sale", icon: DollarSign, permission: "INVENTORY_COUNTER_SALE" },
    ],
  },
  {
    label: "Admin",
    items: [
      { href: "/users" as const, label: "Users", icon: Users, permission: "USERS_READ" },
      { href: "/audit-logs" as const, label: "Audit Logs", icon: ShieldCheck, permission: "AUDITLOGS_READ" },
    ],
  },
];

export const quickActions: NavItem[] = [
  { href: "/intake" as const, label: "New Intake", icon: ClipboardPlus, permission: "WORKORDERS_CREATE" },
  {
    href: "/work-orders" as const,
    label: "Open Work Orders",
    icon: ClipboardList,
    permissions: ["WORKORDERS_READ_ASSIGNED", "WORKORDERS_READ_ALL"],
  },
  { href: "/invoices" as const, label: "Record Payment", icon: Receipt, permission: "INVOICES_READ" },
  { href: "/expenses" as const, label: "Add Expense", icon: DollarSign, permission: "EXPENSES_CREATE" },
];
