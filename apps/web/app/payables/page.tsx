"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Shell from "../../components/shell";
import api from "../../lib/api-client";
import { useAuth } from "../../lib/auth-context";
import { Input } from "../../components/ui/input";
import { Select } from "../../components/ui/select";
import { Button } from "../../components/ui/button";
import { Table, THead, TBody, TR, TH, TD } from "../../components/ui/table";
import { Skeleton } from "../../components/ui/skeleton";
import { EmptyState } from "../../components/ui/empty-state";
import { ErrorState } from "../../components/ui/error-state";
import { Badge } from "../../components/ui/badge";
import { useToast } from "../../components/ui/toast";
import { ConfirmDialog } from "../../components/ui/confirm-dialog";
import { Dialog } from "../../components/ui/dialog";
import { PageHeader } from "../../components/page-header";
import { PageToolbar, PageToolbarSection } from "../../components/page-toolbar";

type Payable = {
  _id: string;
  category?: string;
  amount?: number;
  purchaseDate?: string;
  status?: string;
  partId?: string;
  vendorName?: string;
  qty?: number;
  unitCost?: number;
  createdByName?: string;
  createdByRole?: string;
  note?: string;
  paidAt?: string;
  dueDate?: string;
  daysOverdue?: number;
  bucket?: string;
};

type Part = {
  _id: string;
  partName: string;
  sku: string;
};

const formatMoney = (value?: number | null) => {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num.toFixed(2) : "0.00";
};

export default function PayablesPage() {
  const { session } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const canRead = session?.user?.permissions?.includes("PAYABLES_READ");
  const canUpdate = session?.user?.permissions?.includes("PAYABLES_UPDATE");
  const canReadParts = session?.user?.permissions?.includes("PARTS_READ");

  const [filters, setFilters] = useState({
    partId: "",
    status: "",
    vendor: "",
    purchaser: "",
    from: "",
    to: "",
    bucket: ""
  });
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyTarget, setHistoryTarget] = useState<Payable | null>(null);
  const [confirmState, setConfirmState] = useState<{
    open: boolean;
    title: string;
    description?: string;
    confirmText?: string;
    destructive?: boolean;
    onConfirm?: () => void;
  }>({ open: false, title: "" });

  const openConfirm = (next: {
    title: string;
    description?: string;
    confirmText?: string;
    destructive?: boolean;
    onConfirm: () => void;
  }) => {
    setConfirmState({ open: true, ...next });
  };

  const closeConfirm = () => {
    setConfirmState((state) => ({ ...state, open: false, onConfirm: undefined }));
  };

  const handleConfirm = () => {
    const action = confirmState.onConfirm;
    closeConfirm();
    action?.();
  };

  const payablesQuery = useQuery({
    queryKey: ["payables"],
    queryFn: async () => (await api.get("/payables", { params: { limit: 500 } })).data as Payable[],
    enabled: Boolean(canRead)
  });

  const agingQuery = useQuery({
    queryKey: ["payables-aging"],
    queryFn: async () => (await api.get("/reports/payables-aging")).data as {
      totals: Record<string, number>;
      rows: Payable[];
    },
    enabled: Boolean(canRead)
  });

  const historyQuery = useQuery({
    queryKey: ["payable-history", historyTarget?._id],
    queryFn: async () =>
      (await api.get(`/payables/${historyTarget?._id}/payments`)).data as {
        payments: {
          _id: string;
          amount: number;
          method?: string;
          paidAt?: string;
          note?: string;
          createdByName?: string;
          createdByRole?: string;
        }[];
      },
    enabled: Boolean(historyTarget?._id && historyOpen && canRead)
  });

  const partsQuery = useQuery({
    queryKey: ["parts", "payables"],
    queryFn: async () => (await api.get("/parts", { params: { limit: 500 } })).data,
    enabled: Boolean(canReadParts)
  });

  const partsMap = useMemo(() => {
    const map = new Map<string, Part>();
    const items = (partsQuery.data?.items || []) as Part[];
    items.forEach((p) => map.set(p._id, p));
    return map;
  }, [partsQuery.data]);

  const agingMap = useMemo(() => {
    const map = new Map<string, Payable>();
    (agingQuery.data?.rows || []).forEach((row) => map.set(row._id, row));
    return map;
  }, [agingQuery.data]);

  const filtered = useMemo(() => {
    const list = (payablesQuery.data || []).map((payable) => ({
      ...agingMap.get(payable._id),
      ...payable,
      dueDate: agingMap.get(payable._id)?.dueDate || payable.dueDate,
      daysOverdue: agingMap.get(payable._id)?.daysOverdue,
      bucket: agingMap.get(payable._id)?.bucket,
    }));
    return list
      .filter((p) => (filters.partId ? p.partId === filters.partId : true))
      .filter((p) => (filters.status ? (p.status || "").toUpperCase() === filters.status : true))
      .filter((p) => (filters.bucket ? (p.bucket || "") === filters.bucket : true))
      .filter((p) =>
        filters.vendor ? (p.vendorName || "").toLowerCase().includes(filters.vendor.toLowerCase()) : true
      )
      .filter((p) =>
        filters.purchaser
          ? (p.createdByName || "").toLowerCase().includes(filters.purchaser.toLowerCase())
          : true
      )
      .filter((p) => {
        if (!filters.from && !filters.to) return true;
        const created = p.purchaseDate ? new Date(p.purchaseDate).getTime() : null;
        if (!created) return false;
        const from = filters.from ? new Date(filters.from).getTime() : undefined;
        const to = filters.to ? new Date(filters.to).getTime() : undefined;
        if (from && created < from) return false;
        if (to && created > to) return false;
        return true;
      });
  }, [agingMap, filters, payablesQuery.data]);

  const openTotal = useMemo(
    () =>
      filtered.reduce((sum, p) => {
        const status = String(p.status || "OPEN").toUpperCase();
        return status === "PAID" ? sum : sum + Number(p.amount || 0);
      }, 0),
    [filtered]
  );
  const openCount = useMemo(
    () => filtered.filter((p) => String(p.status || "OPEN").toUpperCase() !== "PAID").length,
    [filtered]
  );
  const paidCount = useMemo(
    () => filtered.filter((p) => String(p.status || "OPEN").toUpperCase() === "PAID").length,
    [filtered]
  );
  const agingTotals = agingQuery.data?.totals || {
    total: 0,
    CURRENT: 0,
    "1_30": 0,
    "31_60": 0,
    "61_90": 0,
    "90_PLUS": 0,
  };

  const payablesUpdate = useMutation({
    mutationFn: async (payableId: string) =>
      api.patch(`/payables/${payableId}`, { status: "PAID", paymentMethod: "CASH" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payables"] });
      qc.invalidateQueries({ queryKey: ["payables-aging"] });
      toast.show({
        title: "Payable marked as paid",
        description: "Payable updated successfully.",
        variant: "success"
      });
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : "Unable to mark paid.";
      toast.show({ title: "Update failed", description: message, variant: "error" });
    }
  });

  if (!canRead) {
    return (
      <Shell>
        <div className="glass p-6 rounded-xl text-center">
          <p className="font-semibold text-foreground">You don&apos;t have permission to view payables.</p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <PageHeader
        title="Payables"
        description="Track supplier liabilities, review open balances, and mark credit purchases as paid."
        badge={<Badge variant="secondary">{filtered.length} records</Badge>}
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-xl border border-border bg-card/50 px-4 py-3">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Open total</p>
          <p className="text-2xl font-semibold text-foreground">Tk. {formatMoney(openTotal)}</p>
        </div>
        <div className="rounded-xl border border-border bg-card/50 px-4 py-3">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Open payables</p>
          <p className="text-2xl font-semibold text-foreground">{openCount}</p>
        </div>
        <div className="rounded-xl border border-border bg-card/50 px-4 py-3">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Paid payables</p>
          <p className="text-2xl font-semibold text-foreground">{paidCount}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        {[
          ["Total aging", agingTotals.total],
          ["Current", agingTotals.CURRENT],
          ["1-30", agingTotals["1_30"]],
          ["31-60", agingTotals["31_60"]],
          ["61-90", agingTotals["61_90"]],
          ["90+", agingTotals["90_PLUS"]],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border border-border bg-card/50 px-4 py-3">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
            <p className="text-lg font-semibold text-foreground">Tk. {formatMoney(Number(value))}</p>
          </div>
        ))}
      </div>

      <PageToolbar>
        <PageToolbarSection>
          <Select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}>
            <option value="">All status</option>
            <option value="OPEN">Open</option>
            <option value="PAID">Paid</option>
          </Select>
          <Select value={filters.bucket} onChange={(e) => setFilters((f) => ({ ...f, bucket: e.target.value }))}>
            <option value="">All aging buckets</option>
            <option value="CURRENT">Current</option>
            <option value="1_30">1-30 days</option>
            <option value="31_60">31-60 days</option>
            <option value="61_90">61-90 days</option>
            <option value="90_PLUS">90+ days</option>
          </Select>
          <Input
            placeholder="Vendor"
            value={filters.vendor}
            onChange={(e) => setFilters((f) => ({ ...f, vendor: e.target.value }))}
          />
          <Input type="date" value={filters.from} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))} />
          <Input type="date" value={filters.to} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))} />
        </PageToolbarSection>
        <PageToolbarSection align="end">
          <Select value={filters.partId} onChange={(e) => setFilters((f) => ({ ...f, partId: e.target.value }))}>
            <option value="">All parts</option>
            {(partsQuery.data?.items || []).map((p: Part) => (
              <option key={p._id} value={p._id}>
                {p.partName} - {p.sku}
              </option>
            ))}
          </Select>
          <Input
            placeholder="Purchased by"
            value={filters.purchaser}
            onChange={(e) => setFilters((f) => ({ ...f, purchaser: e.target.value }))}
          />
        </PageToolbarSection>
      </PageToolbar>

      <div className="glass p-4 rounded-xl space-y-3">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Rows follow the same finance table rhythm as expenses and reports.</span>
          <span>{filtered.length} visible</span>
        </div>

        <div className="rounded-lg border border-border overflow-hidden">
          <Table>
            <THead>
              <TR>
                <TH>Date</TH>
                <TH>Vendor / Part</TH>
                <TH>Qty</TH>
                <TH>Status</TH>
                <TH>Due Date</TH>
                <TH>Overdue</TH>
                <TH className="text-right">Unit Cost</TH>
                <TH className="text-right">Total</TH>
                <TH>Purchased by</TH>
                <TH>Notes</TH>
                <TH>Action</TH>
              </TR>
            </THead>
            <TBody>
              {payablesQuery.isLoading &&
                Array.from({ length: 6 }).map((_, i) => (
                    <TR key={i}>
                      <TD colSpan={11}>
                        <Skeleton className="h-5 w-full" />
                      </TD>
                    </TR>
                ))}
              {!payablesQuery.isLoading &&
                filtered.map((p) => {
                  const part = p.partId ? partsMap.get(p.partId) : undefined;
                  const paid = String(p.status || "OPEN").toUpperCase() === "PAID";
                  return (
                    <TR key={p._id} className={paid ? "opacity-60" : undefined}>
                      <TD>{p.purchaseDate ? new Date(p.purchaseDate).toLocaleString() : "--"}</TD>
                      <TD>
                        <div className="space-y-1">
                          <p className="font-medium text-foreground">{p.vendorName || "--"}</p>
                          <p className="text-xs text-muted-foreground">
                            {part ? `${part.partName} (${part.sku})` : p.partId || "--"}
                          </p>
                        </div>
                      </TD>
                      <TD>{p.qty ?? "--"}</TD>
                      <TD>
                        <Badge variant={paid ? "secondary" : "warning"}>{(p.status || "OPEN").toUpperCase()}</Badge>
                      </TD>
                      <TD>{p.dueDate ? new Date(p.dueDate).toLocaleDateString() : "--"}</TD>
                      <TD>
                        <div className="space-y-1">
                          <p className="font-medium text-foreground">{p.daysOverdue || 0} days</p>
                          <p className="text-xs text-muted-foreground">{p.bucket || "CURRENT"}</p>
                        </div>
                      </TD>
                      <TD className="text-right">Tk. {formatMoney(p.unitCost)}</TD>
                      <TD className="text-right font-medium">Tk. {formatMoney(p.amount)}</TD>
                      <TD>
                        {p.createdByName
                          ? `${p.createdByName}${p.createdByRole ? ` (${p.createdByRole})` : ""}`
                          : "--"}
                      </TD>
                      <TD className="max-w-[220px] truncate" title={p.note || ""}>
                        {p.note || "--"}
                      </TD>
                      <TD>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => {
                              setHistoryTarget(p);
                              setHistoryOpen(true);
                            }}
                          >
                            History
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={!canUpdate || p.status === "PAID" || payablesUpdate.isPending}
                            onClick={() => {
                              openConfirm({
                                title: "Mark payable as paid?",
                                description: "This will mark the payable as paid.",
                                confirmText: "Mark paid",
                                onConfirm: () => payablesUpdate.mutate(p._id)
                              });
                            }}
                          >
                            {p.status === "PAID" ? "Paid" : "Mark paid"}
                          </Button>
                        </div>
                      </TD>
                    </TR>
                  );
                })}
            </TBody>
          </Table>
          {!payablesQuery.isLoading && filtered.length === 0 && (
            <div className="p-4">
              <EmptyState title="No payables found" description="Adjust filters or record a credit purchase." />
            </div>
          )}
          {payablesQuery.isError && (
            <div className="p-4">
              <ErrorState message="Unable to load payables." onRetry={() => payablesQuery.refetch()} />
            </div>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={confirmState.open}
        title={confirmState.title}
        description={confirmState.description}
        confirmText={confirmState.confirmText}
        destructive={confirmState.destructive}
        onConfirm={handleConfirm}
        onCancel={closeConfirm}
      />
      <Dialog
        open={historyOpen}
        onClose={() => {
          setHistoryOpen(false);
          setHistoryTarget(null);
        }}
        title={historyTarget ? `Vendor payment history` : "Vendor payment history"}
      >
        <div className="space-y-3">
          {historyTarget && (
            <div className="rounded-lg border border-border bg-card/40 p-3 text-sm">
              <p className="font-medium text-foreground">{historyTarget.vendorName || "--"}</p>
              <p className="text-muted-foreground">
                {historyTarget.note || historyTarget.partId || "No reference"}
              </p>
            </div>
          )}
          {historyQuery.isLoading && <Skeleton className="h-24 w-full" />}
          {!historyQuery.isLoading && (historyQuery.data?.payments || []).length === 0 && (
            <EmptyState title="No vendor payments yet" description="Payment history will appear after this payable is settled." />
          )}
          {(historyQuery.data?.payments || []).map((payment) => (
            <div key={payment._id} className="rounded-lg border border-border bg-card/40 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium text-foreground">Tk. {formatMoney(payment.amount)}</p>
                <Badge variant="secondary">{payment.method || "CASH"}</Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                {payment.paidAt ? new Date(payment.paidAt).toLocaleString() : "--"}
              </p>
              <p className="text-sm text-muted-foreground">{payment.note || "No note"}</p>
            </div>
          ))}
        </div>
      </Dialog>
    </Shell>
  );
}
