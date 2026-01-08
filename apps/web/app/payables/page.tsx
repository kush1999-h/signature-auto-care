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
    to: ""
  });
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

  const filtered = useMemo(() => {
    const list = payablesQuery.data || [];
    return list
      .filter((p) => (filters.partId ? p.partId === filters.partId : true))
      .filter((p) => (filters.status ? (p.status || "").toUpperCase() === filters.status : true))
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
  }, [filters, payablesQuery.data]);

  const openTotal = useMemo(
    () =>
      filtered.reduce((sum, p) => {
        const status = String(p.status || "OPEN").toUpperCase();
        return status === "PAID" ? sum : sum + Number(p.amount || 0);
      }, 0),
    [filtered]
  );

  const payablesUpdate = useMutation({
    mutationFn: async (payableId: string) => api.patch(`/payables/${payableId}`, { status: "PAID" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payables"] });
      qc.invalidateQueries({ queryKey: ["expenses"] });
      toast.show({
        title: "Payable marked as paid",
        description: "Expense recorded and payables updated.",
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Payables</h1>
          <p className="text-sm text-muted-foreground">Track credit purchases and mark them paid.</p>
        </div>
      </div>

      <div className="glass p-4 rounded-xl space-y-3">
        <div className="grid md:grid-cols-6 gap-2">
          <Select value={filters.partId} onChange={(e) => setFilters((f) => ({ ...f, partId: e.target.value }))}>
            <option value="">All parts</option>
            {(partsQuery.data?.items || []).map((p: Part) => (
              <option key={p._id} value={p._id}>
                {p.partName} - {p.sku}
              </option>
            ))}
          </Select>
          <Select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}>
            <option value="">All status</option>
            <option value="OPEN">Open</option>
            <option value="PAID">Paid</option>
          </Select>
          <Input
            placeholder="Vendor"
            value={filters.vendor}
            onChange={(e) => setFilters((f) => ({ ...f, vendor: e.target.value }))}
          />
          <Input
            placeholder="Purchased by"
            value={filters.purchaser}
            onChange={(e) => setFilters((f) => ({ ...f, purchaser: e.target.value }))}
          />
          <Input type="date" value={filters.from} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))} />
          <Input type="date" value={filters.to} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))} />
        </div>

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Open total: Tk. {formatMoney(openTotal)}</span>
          <span>{filtered.length} records</span>
        </div>

        <div className="rounded-lg border border-border overflow-hidden">
          <Table>
            <THead>
              <TR>
                <TH>Date</TH>
                <TH>Part</TH>
                <TH>Qty</TH>
                <TH>Unit Cost</TH>
                <TH>Total</TH>
                <TH>Status</TH>
                <TH>Vendor</TH>
                <TH>Purchased by</TH>
                <TH>Notes</TH>
                <TH>Action</TH>
              </TR>
            </THead>
            <TBody>
              {payablesQuery.isLoading &&
                Array.from({ length: 6 }).map((_, i) => (
                  <TR key={i}>
                    <TD colSpan={10}>
                      <Skeleton className="h-5 w-full" />
                    </TD>
                  </TR>
                ))}
              {!payablesQuery.isLoading &&
                filtered.map((p) => {
                  const part = p.partId ? partsMap.get(p.partId) : undefined;
                  return (
                    <TR key={p._id}>
                      <TD>{p.purchaseDate ? new Date(p.purchaseDate).toLocaleString() : "--"}</TD>
                      <TD>{part ? `${part.partName} (${part.sku})` : p.partId || "--"}</TD>
                      <TD>{p.qty ?? "--"}</TD>
                      <TD>Tk. {formatMoney(p.unitCost)}</TD>
                      <TD>Tk. {formatMoney(p.amount)}</TD>
                      <TD>
                        <Badge variant={p.status === "PAID" ? "secondary" : "warning"}>{(p.status || "OPEN").toUpperCase()}</Badge>
                      </TD>
                      <TD>{p.vendorName || "--"}</TD>
                      <TD>
                        {p.createdByName
                          ? `${p.createdByName}${p.createdByRole ? ` (${p.createdByRole})` : ""}`
                          : "--"}
                      </TD>
                      <TD className="max-w-[220px] truncate" title={p.note || ""}>
                        {p.note || "--"}
                      </TD>
                      <TD>
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={!canUpdate || p.status === "PAID" || payablesUpdate.isPending}
                          onClick={() => {
                            openConfirm({
                              title: "Mark payable as paid?",
                              description: "This will create a cash expense and close the payable.",
                              confirmText: "Mark paid",
                              onConfirm: () => payablesUpdate.mutate(p._id)
                            });
                          }}
                        >
                          {p.status === "PAID" ? "Paid" : "Mark paid"}
                        </Button>
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
    </Shell>
  );
}
