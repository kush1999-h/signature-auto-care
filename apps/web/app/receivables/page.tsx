"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Shell from "../../components/shell";
import api from "../../lib/api-client";
import { useAuth } from "../../lib/auth-context";
import { Input } from "../../components/ui/input";
import { Select } from "../../components/ui/select";
import { Table, TBody, TD, TH, THead, TR } from "../../components/ui/table";
import { EmptyState } from "../../components/ui/empty-state";
import { ErrorState } from "../../components/ui/error-state";
import { Skeleton } from "../../components/ui/skeleton";
import { Badge } from "../../components/ui/badge";
import { PageHeader } from "../../components/page-header";
import { PageToolbar, PageToolbarSection } from "../../components/page-toolbar";

type Invoice = {
  _id: string;
  invoiceNumber?: string;
  customerId?: string;
  status?: string;
  type?: string;
  workOrderNumber?: string;
  workOrderId?: string;
  createdAt?: string;
  total?: number;
  totalPaid?: number;
  outstandingAmount?: number;
  dueDate?: string;
  daysOverdue?: number;
  bucket?: string;
};
type Customer = { _id: string; name?: string; phone?: string };

const formatMoney = (value?: number) => {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num.toFixed(2) : "0.00";
};

export default function ReceivablesPage() {
  const { session } = useAuth();
  const canRead = session?.user?.permissions?.includes("INVOICES_READ");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [bucket, setBucket] = useState("");

  const invoicesQuery = useQuery({
    queryKey: ["receivables-aging"],
    queryFn: async () => (await api.get("/reports/receivables-aging")).data as {
      totals: Record<string, number>;
      rows: Invoice[];
    },
    enabled: Boolean(canRead),
  });
  const customersQuery = useQuery({
    queryKey: ["receivable-customers"],
    queryFn: async () => (await api.get("/customers")).data as Customer[],
    enabled: Boolean(canRead),
  });
  const customerMap = useMemo(
    () => new Map((customersQuery.data || []).map((customer) => [customer._id, customer])),
    [customersQuery.data]
  );

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (invoicesQuery.data?.rows || [])
      .filter((invoice) => (status ? (invoice.status || "").toUpperCase() === status : true))
      .filter((invoice) => (bucket ? (invoice.bucket || "") === bucket : true))
      .filter((invoice) => {
        if (!term) return true;
        const customer = invoice.customerId ? customerMap.get(invoice.customerId) : undefined;
        return [
          invoice.invoiceNumber,
          invoice.workOrderNumber,
          invoice.workOrderId,
          invoice.customerId,
          customer?.name,
          customer?.phone,
          invoice.type,
        ]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(term));
      })
      .sort((a, b) => {
        const aDate = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bDate = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return bDate - aDate;
      });
  }, [bucket, customerMap, invoicesQuery.data, search, status]);

  const totals = invoicesQuery.data?.totals || {
    total: 0,
    CURRENT: 0,
    "1_30": 0,
    "31_60": 0,
    "61_90": 0,
    "90_PLUS": 0,
  };

  return (
    <Shell>
      <PageHeader
        title="Receivables"
        description="Track customer dues from issued and partially paid invoices."
        badge={<Badge variant="secondary">{rows.length} open invoices</Badge>}
      />

      {!canRead ? (
        <div className="glass p-6 rounded-xl text-center">
          <p className="font-semibold text-foreground">You don&apos;t have permission to view receivables.</p>
        </div>
      ) : (
        <div className="glass p-4 rounded-xl space-y-3">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
            {[
              ["Total due", totals.total],
              ["Current", totals.CURRENT],
              ["1-30", totals["1_30"]],
              ["31-60", totals["31_60"]],
              ["61-90", totals["61_90"]],
              ["90+", totals["90_PLUS"]],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border border-border bg-card/50 px-4 py-3">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
                <p className="text-lg font-semibold text-foreground">Tk. {formatMoney(Number(value))}</p>
              </div>
            ))}
          </div>

          <PageToolbar>
            <PageToolbarSection>
              <Input
                placeholder="Search invoice, work order, customer"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Search receivables"
                className="md:max-w-xs"
              />
              <Select value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">All status</option>
                <option value="ISSUED">Issued</option>
                <option value="PARTIALLY_PAID">Partially paid</option>
              </Select>
              <Select value={bucket} onChange={(e) => setBucket(e.target.value)}>
                <option value="">All aging buckets</option>
                <option value="CURRENT">Current</option>
                <option value="1_30">1-30 days</option>
                <option value="31_60">31-60 days</option>
                <option value="61_90">61-90 days</option>
                <option value="90_PLUS">90+ days</option>
              </Select>
            </PageToolbarSection>
          </PageToolbar>

          <div className="rounded-lg border border-border overflow-hidden">
            <Table>
              <THead>
                <TR>
                  <TH>Date</TH>
                  <TH>Invoice</TH>
                  <TH>Customer</TH>
                  <TH>Status</TH>
                  <TH>Work Order</TH>
                  <TH>Due Date</TH>
                  <TH>Overdue</TH>
                  <TH>Total</TH>
                  <TH>Paid</TH>
                  <TH>Due</TH>
                </TR>
              </THead>
              <TBody>
                {invoicesQuery.isLoading &&
                  Array.from({ length: 5 }).map((_, idx) => (
                    <TR key={idx}>
                      <TD colSpan={10}>
                        <Skeleton className="h-5 w-full" />
                      </TD>
                    </TR>
                  ))}
                {!invoicesQuery.isLoading &&
                  rows.map((invoice) => (
                    <TR key={invoice._id}>
                      <TD>{invoice.createdAt ? new Date(invoice.createdAt).toLocaleDateString() : "--"}</TD>
                      <TD>{invoice.invoiceNumber || invoice._id}</TD>
                      <TD>
                        <div className="space-y-1">
                          <p className="font-medium text-foreground">
                            {invoice.customerId ? customerMap.get(invoice.customerId)?.name || "--" : "--"}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {invoice.customerId ? customerMap.get(invoice.customerId)?.phone || "--" : "--"}
                          </p>
                        </div>
                      </TD>
                      <TD>
                        <Badge variant={invoice.status === "PARTIALLY_PAID" ? "default" : "warning"}>
                          {invoice.status || "--"}
                        </Badge>
                      </TD>
                      <TD>{invoice.workOrderNumber || invoice.workOrderId || "--"}</TD>
                      <TD>{invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString() : "--"}</TD>
                      <TD>
                        <div className="space-y-1">
                          <p className="font-medium text-foreground">{invoice.daysOverdue || 0} days</p>
                          <p className="text-xs text-muted-foreground">{invoice.bucket || "CURRENT"}</p>
                        </div>
                      </TD>
                      <TD className="font-semibold text-foreground">Tk. {formatMoney(invoice.total)}</TD>
                      <TD>Tk. {formatMoney(invoice.totalPaid)}</TD>
                      <TD>Tk. {formatMoney(invoice.outstandingAmount)}</TD>
                    </TR>
                  ))}
              </TBody>
            </Table>
            {!invoicesQuery.isLoading && rows.length === 0 && (
              <div className="p-4">
                <EmptyState title="No receivables" description="Outstanding invoice balances will appear here." />
              </div>
            )}
            {invoicesQuery.isError && (
              <div className="p-4">
                <ErrorState message="Unable to load receivables." onRetry={() => invoicesQuery.refetch()} />
              </div>
            )}
          </div>
        </div>
      )}
    </Shell>
  );
}
