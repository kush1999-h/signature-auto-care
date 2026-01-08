"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Shell from "../../components/shell";
import api from "../../lib/api-client";
import { useAuth } from "../../lib/auth-context";
import { Badge } from "../../components/ui/badge";
import { Skeleton } from "../../components/ui/skeleton";
import { EmptyState } from "../../components/ui/empty-state";
import { ErrorState } from "../../components/ui/error-state";
import { SegmentedControl } from "../../components/ui/segmented-control";
import { Input } from "../../components/ui/input";

type Customer = { _id: string; name: string; phone: string; email?: string; address?: string };
type Vehicle = { _id: string; make?: string; model?: string; year?: number; plate?: string; vin?: string };
type Invoice = {
  _id: string;
  customerId?: string;
  invoiceNumber: string;
  total?: number;
  createdAt: string;
  type?: string;
  workOrderId?: string;
  lineItems?: { type: string; description: string; quantity: number; unitPrice: number; total: number }[];
};

export default function CustomersHistoryPage() {
  const { session } = useAuth();
  const allowed = ["OWNER_ADMIN", "OPS_MANAGER"].includes(session?.user?.role || "");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "invoices" | "vehicles">("all");

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
          <p className="text-sm text-muted-foreground">Only Owner/Admin or Operations Manager can view customer history.</p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Customer History</h1>
          <p className="text-sm text-muted-foreground">All customers with their vehicles and invoices.</p>
        </div>
        <Badge variant="secondary">{filteredCustomers.length} customers</Badge>
      </div>

      <div className="glass p-3 rounded-xl mt-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <label className="text-sm text-muted-foreground">
            Search
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name, phone, email"
              className="mt-1"
              disabled={loading}
            />
          </label>
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
        </div>
      </div>

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
            return (
              <div key={c._id} className="rounded-lg border border-border p-4 glass space-y-3">
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
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="secondary">{vehicles.length} vehicle{vehicles.length === 1 ? "" : "s"}</Badge>
                    <Badge variant="secondary">{invoices.length} invoice{invoices.length === 1 ? "" : "s"}</Badge>
                  </div>
                </div>
                {vehicles.length > 0 && (
                  <div className="text-sm text-muted-foreground">
                    <p className="font-semibold text-foreground">Vehicles</p>
                    <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2">
                      {vehicles.map((v) => (
                        <div key={v._id} className="rounded-md border border-border px-2 py-1">
                          {v.make || "Vehicle"} {v.model || ""} {v.year || ""} | Plate {v.plate || "--"}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {invoices.length > 0 && (
                  <div className="text-sm text-muted-foreground space-y-1">
                    <p className="font-semibold text-foreground">Invoices</p>
                    <div className="flex flex-col gap-1">
                      {invoices.map((inv) => (
                        <div key={inv._id} className="rounded-md border border-border p-2 space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-xs">{inv.invoiceNumber}</span>
                            <span className="text-xs">Tk. {(inv.total || 0).toFixed(2)}</span>
                            <span className="text-xs text-muted-foreground">{new Date(inv.createdAt).toLocaleDateString()}</span>
                            <Badge variant="secondary">{inv.type || "Invoice"}</Badge>
                            {inv.workOrderId && <Badge variant="secondary">WO {inv.workOrderId}</Badge>}
                          </div>
                          {inv.lineItems && inv.lineItems.length > 0 && (
                            <div className="text-xs space-y-1">
                              {inv.lineItems.map((li, idx) => (
                                <div key={idx} className="flex flex-wrap gap-2 justify-between">
                                  <span className="font-medium">{li.description}</span>
                                  <span className="text-muted-foreground">Type {li.type}</span>
                                  <span>Qty {li.quantity}</span>
                                  <span>Unit Tk. {li.unitPrice?.toFixed?.(2) ?? li.unitPrice}</span>
                                  <span className="font-semibold">Line Tk. {li.total?.toFixed?.(2) ?? li.total}</span>
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
