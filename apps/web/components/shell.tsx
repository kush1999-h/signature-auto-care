"use client";

import Link from "next/link";
import type { Route } from "next";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useAuth } from "../lib/auth-context";
import {
  LogOut,
  Package,
  Gauge,
  ClipboardList,
  DollarSign,
  Wrench,
  BarChart3,
  Users,
  ClipboardPlus,
  Receipt,
  ShieldCheck,
  type LucideIcon
} from "lucide-react";
import clsx from "clsx";
import { useEffect, useState } from "react";

type NavItem = {
  href: Route;
  label: string;
  icon: LucideIcon;
  permission?: string;
  permissions?: string[];
  roles?: string[];
};

const navItems: NavItem[] = [
  { href: "/" as const, label: "Dashboard", icon: Gauge },
  { href: "/inventory" as const, label: "Inventory", icon: Package, permission: "PARTS_READ" },
  {
    href: "/work-orders" as const,
    label: "Work Orders",
    icon: ClipboardList,
    permissions: ["WORKORDERS_READ_ASSIGNED", "WORKORDERS_READ_ALL"]
  },
  { href: "/counter-sale" as const, label: "Counter Sale", icon: DollarSign, permission: "INVENTORY_COUNTER_SALE" },
  { href: "/invoices" as const, label: "Invoices", icon: Receipt, permission: "INVOICES_READ" },
  { href: "/payables" as const, label: "Payables", icon: DollarSign, permission: "PAYABLES_READ" },
  { href: "/customers-history" as const, label: "Customers", icon: Users, roles: ["OWNER_ADMIN", "OPS_MANAGER"] },
  { href: "/expenses" as const, label: "Expenses", icon: Wrench, permission: "EXPENSES_READ" },
  { href: "/reports" as const, label: "Reports", icon: BarChart3, permission: "REPORTS_READ_SALES" },
  { href: "/audit-logs" as const, label: "Audit Logs", icon: ShieldCheck, permission: "AUDITLOGS_READ" },
  { href: "/intake" as const, label: "Intake", icon: ClipboardPlus, permission: "WORKORDERS_CREATE" },
  { href: "/users" as const, label: "Users", icon: Users, permission: "USERS_READ" }
];

export default function Shell({ children }: { children: React.ReactNode }) {
  const { session, logout } = useAuth();
  const pathname = usePathname();
  const [hydrated, setHydrated] = useState(false);
  const [navOpen, setNavOpen] = useState(false);

  const displayName = session?.user?.name?.trim() || "User";
  const roleLabel = session?.user?.role || "Unknown";
  const initials = displayName
    .split(" ")
    .filter(Boolean)
    .map((n) => n[0]?.toUpperCase())
    .join("")
    .slice(0, 2) || "U";

  useEffect(() => {
    setHydrated(true);
  }, []);

  const can = (item: NavItem) => {
    const role = session?.user?.role || "";
    const perms = session?.user?.permissions || [];
    if (item.roles && !item.roles.includes(role)) return false;
    if (item.permissions?.length) {
      return item.permissions.some((p) => perms.includes(p));
    }
    if (!item.permission) return true;
    return perms.includes(item.permission);
  };

  if (!hydrated) {
    return <div className="min-h-screen bg-background" />;
  }

  if (!session) {
    return (
      <div className="min-h-screen grid place-items-center">
        <div className="glass p-6 rounded-xl text-center space-y-3">
          <p className="text-lg font-semibold text-foreground">Sign in to continue</p>
          <a
            href="/login"
            className="px-4 py-2 rounded-lg bg-primary text-foreground inline-block"
          >
            Go to Login
          </a>
        </div>
      </div>
    );
  }
  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <header className="flex items-center justify-between px-4 py-3 border-b border-border md:hidden">
        <button
          aria-label="Toggle navigation"
          onClick={() => setNavOpen((o) => !o)}
          className="rounded-md border border-border px-3 py-2 text-sm"
        >
          Menu
        </button>
        <Link href="/" className="inline-block">
          <Image src="/logo.png" alt="Signature Auto Care" width={160} height={60} className="h-10 w-auto object-contain" />
        </Link>
        <div className="flex items-center gap-2 rounded-full border border-border px-3 py-1 bg-card/80">
          <span className="text-xs font-semibold">{initials}</span>
          <div className="text-[11px] leading-tight text-foreground/70 text-right">
            <div className="font-semibold text-foreground">{displayName}</div>
            <div className="uppercase tracking-wide">{roleLabel.replace("_", " ")}</div>
          </div>
        </div>
      </header>
      <div className="flex min-h-[calc(100vh-56px)] md:min-h-screen">
        <aside
          className={clsx(
            "bg-[#050505] border-r border-border p-4 flex flex-col w-64 z-20",
            "md:static md:translate-x-0 md:flex",
            navOpen ? "fixed inset-y-0 left-0 translate-x-0" : "hidden md:flex"
          )}
        >
          <div className="w-full flex justify-center mb-4">
            <Link href="/" className="inline-block">
              <Image src="/logo.png" alt="Signature Auto Care" width={220} height={80} className="h-14 w-auto object-contain scale-110" />
            </Link>
          </div>
          <div className="rounded-lg border border-border bg-white/5 p-3 mb-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-primary/20 text-primary flex items-center justify-center font-semibold">
                {initials}
              </div>
              <div className="space-y-0.5">
                <p className="text-sm font-semibold text-foreground leading-tight">{displayName}</p>
                <p className="text-xs text-foreground/70 uppercase tracking-wide">{roleLabel.replace("_", " ")}</p>
              </div>
            </div>
          </div>
          <div className="h-px bg-border mb-4" />
          <nav className="space-y-1 flex-1">
            {navItems.filter(can).map((item) => {
              const Icon = item.icon;
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={clsx(
                    "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition",
                    active ? "bg-primary/20 text-foreground" : "text-foreground/80 hover:bg-muted"
                  )}
                  onClick={() => setNavOpen(false)}
                >
                  <Icon size={18} />
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <button
            onClick={logout}
            className="flex items-center gap-2 text-sm text-foreground/70 hover:text-foreground transition"
          >
            <LogOut size={16} /> Logout
          </button>
        </aside>
        {navOpen && <div className="fixed inset-0 bg-black/60 z-10 md:hidden" onClick={() => setNavOpen(false)} />}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 space-y-6">{children}</main>
      </div>
    </div>
  );
}
