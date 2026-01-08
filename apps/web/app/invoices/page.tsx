"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Shell from "../../components/shell";
import api, { getPdfBaseUrl } from "../../lib/api-client";
import { useAuth } from "../../lib/auth-context";
import { Input } from "../../components/ui/input";
import { Select } from "../../components/ui/select";
import { Button } from "../../components/ui/button";
import { Table, THead, TBody, TR, TH, TD } from "../../components/ui/table";
import { EmptyState } from "../../components/ui/empty-state";
import { ErrorState } from "../../components/ui/error-state";
import { Skeleton } from "../../components/ui/skeleton";
import { useToast } from "../../components/ui/toast";

type InvoiceLine = {
  description?: string;
  quantity?: number;
  unitPrice?: number;
  total?: number;
};

type Invoice = {
  _id: string;
  invoiceNumber?: string;
  type?: string;
  status?: string;
  workOrderId?: string;
  customerId?: string;
  createdAt?: string;
  subtotal?: number;
  tax?: number;
  total?: number;
  lineItems?: InvoiceLine[];
};

const formatMoney = (value?: number) => {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num.toFixed(2) : "0.00";
};

export default function InvoicesPage() {
  const { session } = useAuth();
  const toast = useToast();
  const canRead = session?.user?.permissions?.includes("INVOICES_READ");
  const canReadCustomers = session?.user?.permissions?.includes("CUSTOMERS_READ");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const invoicesQuery = useQuery({
    queryKey: ["invoices"],
    queryFn: async () => (await api.get("/invoices")).data as Invoice[],
    enabled: Boolean(canRead)
  });

  const resolveCustomerName = async (invoice: Invoice) => {
    if (!invoice.customerId) return "Customer";
    if (!canReadCustomers) return invoice.customerId;
    try {
      const res = await api.get(`/customers/${invoice.customerId}`);
      const customer = res.data as { name?: string; email?: string; phone?: string };
      return customer?.name || customer?.email || customer?.phone || invoice.customerId;
    } catch {
      return invoice.customerId;
    }
  };

  const filtered = useMemo(() => {
    const list = invoicesQuery.data || [];
    const normalizedSearch = search.trim().toLowerCase();
    const fromDate = from ? new Date(from) : null;
    const toDate = to ? new Date(to) : null;
    return list
      .filter((inv) => (status ? (inv.status || "").toUpperCase() === status : true))
      .filter((inv) => (type ? (inv.type || "") === type : true))
      .filter((inv) => {
        if (!normalizedSearch) return true;
        const invoiceNo = (inv.invoiceNumber || "").toLowerCase();
        const wo = (inv.workOrderId || "").toLowerCase();
        return invoiceNo.includes(normalizedSearch) || wo.includes(normalizedSearch);
      })
      .filter((inv) => {
        if (!fromDate && !toDate) return true;
        const created = inv.createdAt ? new Date(inv.createdAt) : null;
        if (!created) return false;
        if (fromDate && created < fromDate) return false;
        if (toDate && created > toDate) return false;
        return true;
      })
      .sort((a, b) => {
        const aDate = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bDate = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return bDate - aDate;
      });
  }, [from, invoicesQuery.data, search, status, to, type]);

  const printInvoice = async (invoice: Invoice) => {
    if (!session?.accessToken) {
      toast.show({
        title: "Unable to print",
        description: "Please sign in again.",
        variant: "error"
      });
      return;
    }
    const pdfBase = getPdfBaseUrl();
    try {
      const customerName = await resolveCustomerName(invoice);
      const res = await fetch(`${pdfBase}/pdf/invoice`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.accessToken}`
        },
        body: JSON.stringify({
          invoiceNumber: invoice.invoiceNumber || invoice._id,
          customerName,
          lineItems: invoice.lineItems || []
        })
      });
      if (!res.ok) {
        throw new Error(`Print failed (${res.status})`);
      }
      const data = (await res.json()) as { base64?: string };
      if (!data?.base64) {
        throw new Error("PDF service returned no data");
      }
      const win = window.open("", "_blank");
      if (!win) throw new Error("Popup blocked. Please allow popups.");
      win.document.write(
        `<iframe width='100%' height='100%' src='data:application/pdf;base64,${data.base64}'></iframe>`
      );
    } catch (err) {
      toast.show({
        title: "Print failed",
        description: err instanceof Error ? err.message : "Unable to print invoice.",
        variant: "error"
      });
    }
  };

  return (
    <Shell>
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Invoices</h1>
          <p className="text-sm text-muted-foreground">Filter and print invoices.</p>
        </div>
      </div>

      {!canRead ? (
        <div className="glass p-6 rounded-xl text-center">
          <p className="font-semibold text-foreground">You don&apos;t have permission to view invoices.</p>
        </div>
      ) : (
        <div className="glass p-4 rounded-xl space-y-3">
          <div className="grid gap-2 md:grid-cols-5">
            <Input
              placeholder="Search invoice or WO"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search invoices"
            />
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All status</option>
              <option value="DRAFT">Draft</option>
              <option value="CLOSED">Closed</option>
              <option value="VOID">Void</option>
            </Select>
            <Select value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">All types</option>
              <option value="WORK_ORDER">Work Order</option>
              <option value="COUNTER_SALE">Counter Sale</option>
            </Select>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>

          <div className="rounded-lg border border-border overflow-hidden">
            <Table>
              <THead>
                <TR>
                  <TH>Date</TH>
                  <TH>Invoice</TH>
                  <TH>Type</TH>
                  <TH>Status</TH>
                  <TH>Work Order</TH>
                  <TH>Total</TH>
                  <TH>Print</TH>
                </TR>
              </THead>
              <TBody>
                {invoicesQuery.isLoading &&
                  Array.from({ length: 6 }).map((_, idx) => (
                    <TR key={idx}>
                      <TD colSpan={7}>
                        <Skeleton className="h-5 w-full" />
                      </TD>
                    </TR>
                  ))}
                {!invoicesQuery.isLoading &&
                  filtered.map((inv) => (
                    <TR key={inv._id}>
                      <TD>{inv.createdAt ? new Date(inv.createdAt).toLocaleDateString() : "--"}</TD>
                      <TD>{inv.invoiceNumber || inv._id}</TD>
                      <TD>{inv.type || "--"}</TD>
                      <TD>{inv.status || "--"}</TD>
                      <TD>{inv.workOrderId || "--"}</TD>
                      <TD className="font-semibold text-foreground">Tk. {formatMoney(inv.total)}</TD>
                      <TD>
                        <Button size="sm" variant="secondary" onClick={() => printInvoice(inv)}>
                          Print
                        </Button>
                      </TD>
                    </TR>
                  ))}
              </TBody>
            </Table>
            {!invoicesQuery.isLoading && filtered.length === 0 && (
              <div className="p-4">
                <EmptyState title="No invoices found" description="Adjust filters or create invoices to see them here." />
              </div>
            )}
            {invoicesQuery.isError && (
              <div className="p-4">
                <ErrorState message="Unable to load invoices." onRetry={() => invoicesQuery.refetch()} />
              </div>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Filters are applied client-side while the API returns the full list.
          </p>
        </div>
      )}
    </Shell>
  );
}
