"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { Badge } from "../../components/ui/badge";
import { PageHeader } from "../../components/page-header";
import { PageToolbar, PageToolbarSection } from "../../components/page-toolbar";
import { Dialog } from "../../components/ui/dialog";
import { Textarea } from "../../components/ui/textarea";

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
  workOrderNumber?: string;
  customerId?: string;
  createdAt?: string;
  subtotal?: number;
  tax?: number;
  total?: number;
  totalPaid?: number;
  outstandingAmount?: number;
  dueDate?: string;
  lineItems?: InvoiceLine[];
};
type Customer = { _id: string; name?: string; phone?: string };
type PaymentHistoryRow = {
  _id: string;
  amount?: number;
  method?: string;
  paymentType?: string;
  paidAt?: string;
  note?: string;
  isVoided?: boolean;
  voidReason?: string;
};

const formatMoney = (value?: number) => {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num.toFixed(2) : "0.00";
};

export default function InvoicesPage() {
  const { session } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const canRead = session?.user?.permissions?.includes("INVOICES_READ");
  const canReadCustomers = session?.user?.permissions?.includes("CUSTOMERS_READ");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [historyInvoice, setHistoryInvoice] = useState<Invoice | null>(null);
  const [refundInvoice, setRefundInvoice] = useState<Invoice | null>(null);
  const [voidInvoiceTarget, setVoidInvoiceTarget] = useState<Invoice | null>(null);
  const [refundAmount, setRefundAmount] = useState("");
  const [refundMethod, setRefundMethod] = useState("CASH");
  const [refundNote, setRefundNote] = useState("");
  const [voidReason, setVoidReason] = useState("");
  const canCorrect = session?.user?.role === "OWNER_ADMIN";

  const invoicesQuery = useQuery({
    queryKey: ["invoices"],
    queryFn: async () => (await api.get("/invoices")).data as Invoice[],
    enabled: Boolean(canRead)
  });
  const customersQuery = useQuery({
    queryKey: ["invoice-customers"],
    queryFn: async () => (await api.get("/customers")).data as Customer[],
    enabled: Boolean(canReadCustomers)
  });
  const historyQuery = useQuery({
    queryKey: ["invoice-payments", historyInvoice?._id],
    queryFn: async () =>
      (await api.get(`/invoices/${historyInvoice?._id}/payments`)).data as {
        payments: PaymentHistoryRow[];
      },
    enabled: Boolean(historyInvoice?._id && canRead)
  });

  const refundMutation = useMutation({
    mutationFn: async () =>
      api.post(`/invoices/${refundInvoice?._id}/refund`, {
        amount: Number(refundAmount),
        method: refundMethod,
        note: refundNote || undefined
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      if (historyInvoice?._id) {
        qc.invalidateQueries({ queryKey: ["invoice-payments", historyInvoice._id] });
      }
      toast.show({ title: "Refund recorded", variant: "success" });
      setRefundInvoice(null);
      setRefundAmount("");
      setRefundMethod("CASH");
      setRefundNote("");
    },
    onError: (err: unknown) => {
      toast.show({
        title: "Refund failed",
        description: err instanceof Error ? err.message : "Unable to refund invoice.",
        variant: "error"
      });
    }
  });

  const voidInvoiceMutation = useMutation({
    mutationFn: async () =>
      api.post(`/invoices/${voidInvoiceTarget?._id}/void`, { reason: voidReason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      toast.show({ title: "Invoice voided", variant: "success" });
      setVoidInvoiceTarget(null);
      setVoidReason("");
    },
    onError: (err: unknown) => {
      toast.show({
        title: "Void failed",
        description: err instanceof Error ? err.message : "Unable to void invoice.",
        variant: "error"
      });
    }
  });
  const customerMap = useMemo(
    () => new Map((customersQuery.data || []).map((customer) => [customer._id, customer])),
    [customersQuery.data]
  );

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
        const woNumber = (inv.workOrderNumber || "").toLowerCase();
        const customer = inv.customerId ? customerMap.get(inv.customerId) : undefined;
        const customerName = (customer?.name || "").toLowerCase();
        const customerPhone = (customer?.phone || "").toLowerCase();
        return (
          invoiceNo.includes(normalizedSearch) ||
          wo.includes(normalizedSearch) ||
          woNumber.includes(normalizedSearch) ||
          customerName.includes(normalizedSearch) ||
          customerPhone.includes(normalizedSearch)
        );
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
  }, [customerMap, from, invoicesQuery.data, search, status, to, type]);

  const statusVariant = (value?: string) => {
    if (value === "PAID") return "success";
    if (value === "PARTIALLY_PAID") return "default";
    if (value === "ISSUED") return "warning";
    return "secondary";
  };

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
      <PageHeader
        title="Invoices"
        description="Filter, review, and print invoices from work orders and counter sales."
        badge={<Badge variant="secondary">{filtered.length} invoices</Badge>}
      />

      {!canRead ? (
        <div className="glass p-6 rounded-xl text-center">
          <p className="font-semibold text-foreground">You don&apos;t have permission to view invoices.</p>
        </div>
      ) : (
        <div className="glass p-4 rounded-xl space-y-3">
          <PageToolbar>
            <PageToolbarSection>
              <Input
                placeholder="Search invoice, work order, customer"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Search invoices"
                className="md:max-w-xs"
              />
              <Select value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">All status</option>
                <option value="DRAFT">Draft</option>
                <option value="ISSUED">Issued</option>
                <option value="PARTIALLY_PAID">Partially paid</option>
                <option value="PAID">Paid</option>
                <option value="VOID">Void</option>
              </Select>
              <Select value={type} onChange={(e) => setType(e.target.value)}>
                <option value="">All types</option>
                <option value="WORK_ORDER">Work Order</option>
                <option value="COUNTER_SALE">Counter Sale</option>
              </Select>
            </PageToolbarSection>
            <PageToolbarSection align="end">
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="md:max-w-[170px]" />
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="md:max-w-[170px]" />
            </PageToolbarSection>
          </PageToolbar>

          <div className="rounded-lg border border-border overflow-hidden">
            <Table>
              <THead>
                <TR>
                  <TH>Date</TH>
                  <TH>Invoice</TH>
                  <TH>Customer</TH>
                  <TH>Type</TH>
                  <TH>Status</TH>
                  <TH>Work Order</TH>
                  <TH>Due Date</TH>
                  <TH>Total</TH>
                  <TH>Paid</TH>
                  <TH>Due</TH>
                  <TH>Actions</TH>
                  <TH>Print</TH>
                </TR>
              </THead>
              <TBody>
                {invoicesQuery.isLoading &&
                  Array.from({ length: 6 }).map((_, idx) => (
                    <TR key={idx}>
                      <TD colSpan={12}>
                        <Skeleton className="h-5 w-full" />
                      </TD>
                    </TR>
                  ))}
                {!invoicesQuery.isLoading &&
                  filtered.map((inv) => {
                    const customer = inv.customerId ? customerMap.get(inv.customerId) : undefined;
                    return (
                      <TR key={inv._id}>
                        <TD>{inv.createdAt ? new Date(inv.createdAt).toLocaleDateString() : "--"}</TD>
                        <TD>{inv.invoiceNumber || inv._id}</TD>
                        <TD>
                          <div className="space-y-1">
                            <p className="font-medium text-foreground">{customer?.name || "--"}</p>
                            <p className="text-xs text-muted-foreground">{customer?.phone || "--"}</p>
                          </div>
                        </TD>
                        <TD>{inv.type || "--"}</TD>
                        <TD><Badge variant={statusVariant(inv.status)}>{inv.status || "--"}</Badge></TD>
                        <TD>{inv.workOrderNumber || inv.workOrderId || "--"}</TD>
                        <TD>{inv.dueDate ? new Date(inv.dueDate).toLocaleDateString() : "--"}</TD>
                        <TD className="font-semibold text-foreground">Tk. {formatMoney(inv.total)}</TD>
                        <TD>Tk. {formatMoney(inv.totalPaid)}</TD>
                        <TD>Tk. {formatMoney(inv.outstandingAmount)}</TD>
                        <TD>
                          <div className="flex flex-wrap gap-2">
                            <Button size="sm" variant="secondary" onClick={() => setHistoryInvoice(inv)}>
                              History
                            </Button>
                            {canCorrect && (
                              <>
                                {Number(inv.totalPaid || 0) > 0 && (
                                  <Button size="sm" variant="secondary" onClick={() => setRefundInvoice(inv)}>
                                    Refund
                                  </Button>
                                )}
                                {inv.status !== "VOID" && (
                                  <Button size="sm" variant="secondary" onClick={() => setVoidInvoiceTarget(inv)}>
                                    Void
                                  </Button>
                                )}
                              </>
                            )}
                          </div>
                        </TD>
                        <TD>
                          <Button size="sm" variant="secondary" onClick={() => printInvoice(inv)}>
                            Print
                          </Button>
                        </TD>
                      </TR>
                    );
                  })}
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
      <Dialog
        open={!!historyInvoice}
        onClose={() => setHistoryInvoice(null)}
        title={historyInvoice ? `Payment history: ${historyInvoice.invoiceNumber || historyInvoice._id}` : "Payment history"}
      >
        <div className="space-y-3">
          {historyQuery.isLoading && <Skeleton className="h-24 w-full" />}
          {!historyQuery.isLoading && (historyQuery.data?.payments || []).length === 0 && (
            <EmptyState title="No payment history" description="Payments, refunds, and voids will appear here." />
          )}
          {(historyQuery.data?.payments || []).map((payment) => (
            <div key={payment._id} className="rounded-lg border border-border bg-card/40 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium text-foreground">
                  Tk. {formatMoney(payment.amount)} <span className="text-muted-foreground">({payment.paymentType || "INVOICE_PAYMENT"})</span>
                </p>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary">{payment.method || "CASH"}</Badge>
                  {payment.isVoided && <Badge variant="danger">Voided</Badge>}
                </div>
              </div>
              <p className="text-sm text-muted-foreground">
                {payment.paidAt ? new Date(payment.paidAt).toLocaleString() : "--"}
              </p>
              <p className="text-sm text-muted-foreground">{payment.note || payment.voidReason || "No note"}</p>
            </div>
          ))}
        </div>
      </Dialog>
      <Dialog
        open={!!refundInvoice}
        onClose={() => {
          setRefundInvoice(null);
          setRefundAmount("");
          setRefundMethod("CASH");
          setRefundNote("");
        }}
        title={refundInvoice ? `Refund ${refundInvoice.invoiceNumber || refundInvoice._id}` : "Refund invoice"}
        footer={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setRefundInvoice(null)}>Cancel</Button>
            <Button
              onClick={() => refundMutation.mutate()}
              disabled={refundMutation.isPending || Number(refundAmount || 0) <= 0}
            >
              Save refund
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <Input
            placeholder="Refund amount"
            value={refundAmount}
            onChange={(e) => setRefundAmount(e.target.value)}
            inputMode="decimal"
          />
          <Select value={refundMethod} onChange={(e) => setRefundMethod(e.target.value)}>
            <option value="CASH">Cash</option>
            <option value="CARD">Card</option>
            <option value="BANK_TRANSFER">Bank transfer</option>
          </Select>
          <Textarea placeholder="Reason / note" value={refundNote} onChange={(e) => setRefundNote(e.target.value)} />
        </div>
      </Dialog>
      {!!voidInvoiceTarget && (
        <Dialog
          open={!!voidInvoiceTarget}
          onClose={() => {
            setVoidInvoiceTarget(null);
            setVoidReason("");
          }}
          title={`Void ${voidInvoiceTarget.invoiceNumber || voidInvoiceTarget._id}`}
          footer={
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setVoidInvoiceTarget(null)}>Cancel</Button>
              <Button
                variant="danger"
                onClick={() => voidInvoiceMutation.mutate()}
                disabled={voidInvoiceMutation.isPending || !voidReason.trim()}
              >
                Void invoice
              </Button>
            </div>
          }
        >
          <Textarea placeholder="Reason" value={voidReason} onChange={(e) => setVoidReason(e.target.value)} />
        </Dialog>
      )}
    </Shell>
  );
}
