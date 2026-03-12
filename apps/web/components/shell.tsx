"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useAuth } from "../lib/auth-context";
import {
  LogOut,
  ArrowRight,
  PanelLeft,
} from "lucide-react";
import clsx from "clsx";
import { useEffect, useState } from "react";
import { navGroups, quickActions, type NavItem } from "./navigation-config";
import { Button } from "./ui/button";
import { ThemeToggle } from "./theme-toggle";

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
  const isActive = (href: NavItem["href"]) => {
    if (href === "/") return pathname === "/";
    return pathname === href || pathname.startsWith(`${href}/`);
  };
  const visibleGroups = navGroups
    .map((group) => ({
      ...group,
      items: group.items.filter(can),
    }))
    .filter((group) => group.items.length > 0);
  const visibleQuickActions = quickActions.filter(can);
  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-border bg-[var(--surface-strong)] px-4 py-3 backdrop-blur-xl md:hidden">
        <button
          aria-label="Toggle navigation"
          onClick={() => setNavOpen((o) => !o)}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm shadow-sm"
        >
          <PanelLeft size={16} />
          Menu
        </button>
        <Link href="/" className="inline-block">
          <Image src="/logo.png" alt="Signature Auto Care" width={160} height={60} className="h-10 w-auto object-contain" />
        </Link>
        <div className="flex items-center gap-2">
          <ThemeToggle compact />
          <div className="hidden min-[430px]:flex items-center gap-2 rounded-full border border-border px-3 py-1 bg-card/80">
            <span className="text-xs font-semibold">{initials}</span>
            <div className="text-[11px] leading-tight text-foreground/70 text-right">
              <div className="font-semibold text-foreground">{displayName}</div>
              <div className="uppercase tracking-wide">{roleLabel.replace("_", " ")}</div>
            </div>
          </div>
        </div>
      </header>
      <div className="flex min-h-[calc(100vh-56px)] md:min-h-screen">
        <aside
          className={clsx(
            "z-30 flex w-[17rem] flex-col border-r border-border bg-[var(--surface-strong)] p-4 shadow-[var(--shadow-strong)] backdrop-blur-xl",
            "md:static md:translate-x-0 md:flex md:shadow-none",
            navOpen ? "fixed inset-y-0 left-0 translate-x-0" : "hidden md:flex"
          )}
        >
          <div className="mb-4 flex w-full justify-center">
            <Link href="/" className="inline-block">
              <Image src="/logo.png" alt="Signature Auto Care" width={220} height={80} className="h-14 w-auto object-contain scale-110" />
            </Link>
          </div>
          <div className="mb-4 rounded-xl border border-border bg-card/80 p-3">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-primary/20 text-primary flex items-center justify-center font-semibold">
                {initials}
              </div>
              <div className="space-y-0.5">
                <p className="text-sm font-semibold text-foreground leading-tight">{displayName}</p>
                <p className="text-xs text-foreground/70 uppercase tracking-wide">{roleLabel.replace("_", " ")}</p>
              </div>
            </div>
            <div className="mt-3 border-t border-border pt-3">
              <ThemeToggle />
            </div>
          </div>
          <div className="mb-4 h-px bg-border" />
          <nav className="flex-1 space-y-5 overflow-y-auto pr-1">
            {visibleGroups.map((group) => (
              <div key={group.label} className="space-y-1.5">
                <p className="px-3 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                  {group.label}
                </p>
                <div className="space-y-1">
                  {group.items.map((item) => {
                    const Icon = item.icon;
                    const active = isActive(item.href);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={clsx(
                          "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition",
                          active
                            ? "bg-primary/15 text-foreground ring-1 ring-primary/25 shadow-sm"
                            : "text-foreground/80 hover:bg-muted"
                        )}
                        onClick={() => setNavOpen(false)}
                      >
                        <Icon size={18} />
                        <span>{item.label}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>
          <Button onClick={logout} variant="ghost" className="justify-start px-2 text-sm text-muted-foreground hover:text-foreground">
            <LogOut size={16} /> Logout
          </Button>
        </aside>
        {navOpen && <div className="fixed inset-0 z-20 bg-[var(--overlay)] md:hidden" onClick={() => setNavOpen(false)} />}
        <main className="flex-1 px-4 py-4 sm:px-5 sm:py-5 lg:px-8 lg:py-8">
          <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-5 lg:gap-6">
          {visibleQuickActions.length > 0 && (
            <div className="glass rounded-xl p-3 sm:p-4">
              <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">Quick Actions</p>
                  <p className="text-xs text-muted-foreground">Jump into the most-used tasks for your role.</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {visibleQuickActions.map((action) => {
                    const Icon = action.icon;
                    return (
                      <Button key={action.href} variant="outline" size="sm" asChild>
                        <Link href={action.href} onClick={() => setNavOpen(false)}>
                          <Icon size={15} />
                          {action.label}
                          <ArrowRight size={14} />
                        </Link>
                      </Button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
          {children}
          </div>
        </main>
      </div>
    </div>
  );
}
