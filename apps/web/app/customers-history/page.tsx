"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Shell from "../../components/shell";
import api from "../../lib/api-client";
import { useAuth } from "../../lib/auth-context";
import { PageHeader } from "../../components/page-header";
import { PageToolbar, PageToolbarSection } from "../../components/page-toolbar";
import { Badge } from "../../components/ui/badge";
import { Skeleton } from "../../components/ui/skeleton";
import { EmptyState } from "../../components/ui/empty-state";
import { ErrorState } from "../../components/ui/error-state";
import { SegmentedControl } from "../../components/ui/segmented-control";
import { Input } from "../../components/ui/input";

type Customer = {
  _id: string;
  name: string;
  phone: string;
  email?: string;
  address?: string;
  visitSummary?: {
    totalVisits?: number;
    distinctVehicles?: number;
    lastVisit?: string | null;
  };
};
type Vehicle = {
  _id: string;
  make?: string;
  model?: string;
  year?: number;
  plate?: string;
  vin?: string;
  color?: string;
  visitSummary?: {
    visitCount?: number;
    firstVisit?: string | null;
    lastVisit?: string | null;
  };
};
type Invoice = {
  _id: string;
  customerId?: string;
  invoiceNumber: string;
  total?: number;
  totalPaid?: number;
  outstandingAmount?: number;
  createdAt: string;
  type?: string;
  workOrderId?: string;
  workOrderNumber?: string;
  lineItems?: { type: string; description: string; quantity: number; unitPrice: number; total: number }[];
};

const asMoney = (value?: number | string | null) => {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num : 0;
};

const formatDate = (value?: string | null) =>
  value ? new Date(value).toLocaleDateString() : "--";

export default function CustomersHistoryPage() {
  const { session } = useAuth();
  const permissions = session?.user?.permissions || [];
  const allowed =
    permissions.includes("CUSTOMERS_READ") &&
    permissions.includes("VEHICLES_READ") &&
    permissions.includes("INVOICES_READ");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "invoices" | "vehicles">("all");
  const [expandedInvoices, setExpandedInvoices] = useState<Record<string, boolean>>({});

  const customersQuery = useQuery({
    queryKey: ["customers"],
    queryFn: async () => (await api.get("/customers")).data,
    enabled: allowed
  });

  const invoicesQuery = useQuery({
    queryKey: ["invoices"],
    queryFn: async () => (await api.get("/invoices")).data,
    enabled: allowed
  });

  const vehiclesQuery = useQuery({
    queryKey: ["customer-vehicles", customersQuery.data?.length],
    enabled: allowed && !!customersQuery.data,
    queryFn: async () => {
      const customers: Customer[] = customersQuery.data || [];
      const results = await Promise.all(
        customers.map(async (c) => {
          const res = await api.get(`/customers/${c._id}/vehicles`);
          return { customerId: c._id, vehicles: res.data as Vehicle[] };
        })
      );
      const map: Record<string, Vehicle[]> = {};
      results.forEach((r) => (map[r.customerId] = r.vehicles));
      return map;
    }
  });

  const invoicesByCustomer = useMemo(() => {
    const map: Record<string, Invoice[]> = {};
    (invoicesQuery.data as Invoice[] | undefined)?.forEach((inv) => {
      const key = inv.customerId || "unknown";
      map[key] = map[key] || [];
      map[key].push(inv);
    });
    return map;
  }, [invoicesQuery.data]);

  const loading = customersQuery.isLoading || invoicesQuery.isLoading || vehiclesQuery.isLoading;
  const hasError = customersQuery.isError || invoicesQuery.isError || vehiclesQuery.isError;
  const customers = useMemo(
    () => (customersQuery.data as Customer[] | undefined) || [],
    [customersQuery.data]
  );
  const filteredCustomers = useMemo(() => {
    const term = search.trim().toLowerCase();
    const matches = term
      ? customers.filter((c) => {
          const haystack = `${c.name} ${c.phone} ${c.email || ""} ${c.address || ""}`.toLowerCase();
          return haystack.includes(term);
        })
      : customers;
    return matches.filter((c) => {
      const vehicles = vehiclesQuery.data?.[c._id] || [];
      const invoices = invoicesByCustomer[c._id] || [];
      if (filter === "invoices") return invoices.length > 0;
      if (filter === "vehicles") return vehicles.length > 0;
      return true;
    });
  }, [customers, filter, invoicesByCustomer, search, vehiclesQuery.data]);

  if (!allowed) {
    return (
      <Shell>
        <div className="glass p-6 rounded-xl">
          <p className="font-semibold text-foreground">No access</p>
          <p className="text-sm text-muted-foreground">
            Customer history requires customer, vehicle, and invoice access.
          </p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <PageHeader
        title="Customer History"
        description="Review repeat customers, returning vehicles, and invoice history in one workspace."
        badge={<Badge variant="secondary">{filteredCustomers.length} customers</Badge>}
      />

      <PageToolbar>
        <PageToolbarSection>
          <label className="text-sm text-muted-foreground min-w-[260px]">
            Search
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name, phone, email"
              className="mt-1"
              disabled={loading}
            />
          </label>
        </PageToolbarSection>
        <PageToolbarSection align="end">
          <div className="text-sm text-muted-foreground">
            Filter
            <div className="mt-1">
              <SegmentedControl
                aria-label="Customer filter"
                options={[
                  { value: "all", label: "All" },
                  { value: "invoices", label: "With invoices" },
                  { value: "vehicles", label: "With vehicles" }
                ]}
                value={filter}
                onChange={(val) => setFilter(val as typeof filter)}
                disabled={loading}
              />
            </div>
          </div>
        </PageToolbarSection>
      </PageToolbar>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : hasError ? (
        <ErrorState
          message="Unable to load customers right now."
          onRetry={() => {
            customersQuery.refetch();
            invoicesQuery.refetch();
            vehiclesQuery.refetch();
          }}
        />
      ) : filteredCustomers.length === 0 ? (
        <EmptyState
          title="No customers found"
          description="Try another search term or switch the filter."
        />
      ) : (
        <div className="space-y-3">
          {filteredCustomers.map((c) => {
            const vehicles = vehiclesQuery.data?.[c._id] || [];
            const invoices = invoicesByCustomer[c._id] || [];
            const lastInvoice = invoices.reduce<Invoice | null>((latest, inv) => {
              if (!latest) return inv;
              return new Date(inv.createdAt).getTime() > new Date(latest.createdAt).getTime() ? inv : latest;
            }, null);
            const totalVisits = c.visitSummary?.totalVisits || 0;
            const distinctVehicles = c.visitSummary?.distinctVehicles || vehicles.length;
            const lastVisit = c.visitSummary?.lastVisit || null;
            const totalReceivable = invoices.reduce(
              (sum, invoice) => sum + asMoney(invoice.outstandingAmount),
              0
            );
            return (
              <div key={c._id} className="rounded-xl border border-border p-4 glass space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <div>
                    <p className="font-semibold text-foreground">{c.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {c.phone}
                      {c.email ? ` | ${c.email}` : ""}
                    </p>
                    {c.address && <p className="text-xs text-muted-foreground">{c.address}</p>}
                    <p className="text-[11px] text-muted-foreground">
                      Last invoice:{" "}
                      {lastInvoice
                        ? `${lastInvoice.invoiceNumber} on ${new Date(lastInvoice.createdAt).toLocaleDateString()}`
                        : "None yet"}
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                    <div className="rounded-lg border border-border bg-card/50 px-3 py-2">
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Visits</p>
                      <p className="font-semibold text-foreground">{totalVisits}</p>
                    </div>
                    <div className="rounded-lg border border-border bg-card/50 px-3 py-2">
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Vehicles</p>
                      <p className="font-semibold text-foreground">{distinctVehicles}</p>
                    </div>
                    <div className="rounded-lg border border-border bg-card/50 px-3 py-2">
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Invoices</p>
                      <p className="font-semibold text-foreground">{invoices.length}</p>
                    </div>
                    <div className="rounded-lg border border-border bg-card/50 px-3 py-2">
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Total due</p>
                      <p className="font-semibold text-foreground">Tk. {totalReceivable.toFixed(2)}</p>
                    </div>
                    <div className="rounded-lg border border-border bg-card/50 px-3 py-2">
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Latest visit</p>
                      <p className="font-semibold text-foreground">{formatDate(lastVisit)}</p>
                    </div>
                  </div>
                </div>
                {vehicles.length > 0 && (
                  <div className="text-sm text-muted-foreground space-y-3">
                    <p className="font-semibold text-foreground">Vehicles</p>
                    <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                      {vehicles.map((v) => (
                        <div key={v._id} className="rounded-lg border border-border bg-card/50 p-3 space-y-2">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="font-medium text-foreground">
                                {[v.make, v.model, v.year].filter(Boolean).join(" ") || "Vehicle"}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                Plate {v.plate || "--"}{v.color ? ` | ${v.color}` : ""}
                              </p>
                            </div>
                            <Badge variant={(v.visitSummary?.visitCount || 0) > 1 ? "default" : "secondary"}>
                              {v.visitSummary?.visitCount || 0} visit
                              {(v.visitSummary?.visitCount || 0) === 1 ? "" : "s"}
                            </Badge>
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-[11px]">
                            <div className="rounded border border-border/60 bg-background/30 px-2 py-1">
                              <p className="uppercase tracking-wide text-muted-foreground">First visit</p>
                              <p className="text-foreground">{formatDate(v.visitSummary?.firstVisit)}</p>
                            </div>
                            <div className="rounded border border-border/60 bg-background/30 px-2 py-1">
                              <p className="uppercase tracking-wide text-muted-foreground">Last visit</p>
                              <p className="text-foreground">{formatDate(v.visitSummary?.lastVisit)}</p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {invoices.length > 0 && (
                  <div className="text-sm text-muted-foreground space-y-2">
                    <p className="font-semibold text-foreground">Invoices</p>
                    <div className="flex flex-col gap-1">
                      {invoices.map((inv) => (
                        <div key={inv._id} className="rounded-lg border border-border p-3 space-y-2 bg-card/30">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="space-y-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-mono text-xs text-foreground">{inv.invoiceNumber}</span>
                                <Badge variant="secondary">{inv.type || "Invoice"}</Badge>
                                {(inv.workOrderNumber || inv.workOrderId) && <Badge variant="secondary">WO {inv.workOrderNumber || inv.workOrderId}</Badge>}
                              </div>
                              <p className="text-xs text-muted-foreground">{new Date(inv.createdAt).toLocaleDateString()}</p>
                            </div>
                            <div className="grid grid-cols-3 gap-2 text-right text-xs min-w-[260px]">
                              <div>
                                <p className="uppercase tracking-wide text-muted-foreground">Total</p>
                                <p className="font-semibold text-foreground">Tk. {asMoney(inv.total).toFixed(2)}</p>
                              </div>
                              <div>
                                <p className="uppercase tracking-wide text-muted-foreground">Paid</p>
                                <p className="font-semibold text-foreground">Tk. {asMoney(inv.totalPaid).toFixed(2)}</p>
                              </div>
                              <div>
                                <p className="uppercase tracking-wide text-muted-foreground">Due</p>
                                <p className="font-semibold text-foreground">Tk. {asMoney(inv.outstandingAmount).toFixed(2)}</p>
                              </div>
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            {inv.lineItems && inv.lineItems.length > 0 && (
                              <button
                                type="button"
                                className="text-xs underline text-accent"
                                onClick={() =>
                                  setExpandedInvoices((prev) => ({
                                    ...prev,
                                    [inv._id]: !prev[inv._id],
                                  }))
                                }
                              >
                                {expandedInvoices[inv._id] ? "Hide lines" : "Show lines"}
                              </button>
                            )}
                          </div>
                          {inv.lineItems && inv.lineItems.length > 0 && expandedInvoices[inv._id] && (
                            <div className="text-xs space-y-1">
                              {inv.lineItems.map((li, idx) => (
                                <div key={idx} className="flex flex-wrap gap-2 justify-between">
                                  <span className="font-medium">{li.description}</span>
                                  <span className="text-muted-foreground">Type {li.type}</span>
                                  <span>Qty {li.quantity}</span>
                                  <span>Unit Tk. {asMoney(li.unitPrice).toFixed(2)}</span>
                                  <span className="font-semibold">Line Tk. {asMoney(li.total).toFixed(2)}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {vehicles.length === 0 && invoices.length === 0 && (
                  <p className="text-xs text-muted-foreground">No vehicles or invoices recorded.</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Shell>
  );
}
