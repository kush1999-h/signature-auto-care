"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Shell from "../../components/shell";
import api from "../../lib/api-client";
import { useAuth } from "../../lib/auth-context";
import { useDebounce } from "../../lib/use-debounce";
import { Input } from "../../components/ui/input";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { Skeleton } from "../../components/ui/skeleton";
import { Dialog } from "../../components/ui/dialog";
import { ConfirmDialog } from "../../components/ui/confirm-dialog";
import { Drawer } from "../../components/ui/drawer";
import { Table, THead, TBody, TR, TH, TD } from "../../components/ui/table";
import { Select } from "../../components/ui/select";
import { Textarea } from "../../components/ui/textarea";
import { useToast } from "../../components/ui/toast";

type Part = {
  _id: string;
  partName: string;
  sku: string;
  category?: string;
  barcode?: string;
  onHandQty?: number;
  reservedQty?: number;
  availableQty?: number;
  sellingPrice?: number;
  purchasePrice?: number;
  avgCost?: number;
  reorderLevel?: number;
};

type Transaction = {
  _id: string;
  type: string;
  qtyChange: number;
  partId: string;
  referenceType?: string;
  referenceId?: string;
  unitCost?: number;
  unitPrice?: number;
  paymentMethod?: string;
  vendorName?: string;
  performedByName?: string;
  performedByRole?: string;
  createdAt: string;
  notes?: string;
};

type Payable = {
  _id: string;
  category: string;
  amount: number;
  purchaseDate: string;
  status?: string;
  partId?: string;
  transactionId?: string;
  vendorName?: string;
  qty: number;
  unitCost: number;
  createdByName?: string;
  createdByRole?: string;
  note?: string;
  paidAt?: string;
};

type ReceiveForm = {
  partId: string;
  qty: number;
  unitCost: number;
  sellingPrice?: number;
  paymentMethod?: "CASH" | "CREDIT" | "";
  vendorName?: string;
  notes?: string;
};
type AdjustForm = { partId: string; qtyChange: number; reason: string };

const formatMoney = (value?: number | string | null) => {
  if (value === null || value === undefined) return "--";
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num.toFixed(2) : "--";
};

export default function InventoryPage() {
  const { session } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();

  const canRead = session?.user?.permissions?.includes("PARTS_READ");
  const canCreate = session?.user?.permissions?.includes("PARTS_CREATE");
  const canReceive = session?.user?.permissions?.includes("INVENTORY_RECEIVE");
  const canAdjust = session?.user?.permissions?.includes("INVENTORY_ADJUST");
  const canIssue = session?.user?.permissions?.includes("INVENTORY_ISSUE_TO_WORKORDER");
  const canPriceUpdate = session?.user?.role
    ? ["OWNER_ADMIN", "OPS_MANAGER"].includes(session.user.role) ||
      session.user.permissions?.includes("INVENTORY_PRICE_UPDATE")
    : false;
  const canReport = session?.user?.permissions?.includes("INVENTORY_REPORTS_READ");
  const canViewPurchases =
    canReport && ["OWNER_ADMIN", "OPS_MANAGER", "INVENTORY_MANAGER"].includes(session?.user?.role || "");
  const canViewPayables = session?.user?.permissions?.includes("PAYABLES_READ");
  const canUpdatePayables = session?.user?.permissions?.includes("PAYABLES_UPDATE");
  const isOwner = session?.user?.role === "OWNER_ADMIN";
  const canAdjustRole = ["OWNER_ADMIN", "INVENTORY_MANAGER", "OPS_MANAGER"].includes(session?.user?.role || "");
  const canAdjustAllowed = canAdjust && canAdjustRole;

  const [search, setSearch] = useState("");
  const [barcode, setBarcode] = useState("");
  const [selectedPart, setSelectedPart] = useState<Part | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [issueOpen, setIssueOpen] = useState(false);
  const [priceOpen, setPriceOpen] = useState(false);
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [purchasesOpen, setPurchasesOpen] = useState(false);
  const [payablesOpen, setPayablesOpen] = useState(false);
  const [receiveForm, setReceiveForm] = useState<ReceiveForm>({
    partId: "",
    qty: 0,
    unitCost: 0,
    sellingPrice: undefined,
    paymentMethod: "",
    vendorName: "",
    notes: ""
  });
  const [adjustForm, setAdjustForm] = useState<AdjustForm>({ partId: "", qtyChange: 0, reason: "" });
  const [issueForm, setIssueForm] = useState({ partId: "", workOrderId: "", qty: 1 });
  const [createForm, setCreateForm] = useState({
    partName: "",
    sku: "",
    barcode: "",
    category: "",
    vendorName: "",
    reorderLevel: 0
  });
  const [priceForm, setPriceForm] = useState({ partId: "", sellingPrice: 0 });
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
  const [ledgerFilters, setLedgerFilters] = useState({ partId: "", type: "", ref: "" });
  const [purchaseFilters, setPurchaseFilters] = useState({
    partId: "",
    paymentMethod: "",
    vendor: "",
    purchaser: "",
    from: "",
    to: ""
  });
  const [payableFilters, setPayableFilters] = useState({
    partId: "",
    status: "",
    vendor: "",
    purchaser: "",
    from: "",
    to: ""
  });

  const debouncedSearch = useDebounce(search || barcode, 300);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  useEffect(() => {
    if (selectedPart) {
      setReceiveForm((prev) => ({ ...prev, partId: selectedPart._id }));
      setAdjustForm((prev) => ({ ...prev, partId: selectedPart._id }));
      setIssueForm((prev) => ({ ...prev, partId: selectedPart._id }));
    }
  }, [selectedPart]);

  const partsQuery = useQuery({
    queryKey: ["parts", debouncedSearch],
    queryFn: async () => {
      const res = await api.get("/parts", { params: { search: debouncedSearch, limit: 500 } });
      return res.data;
    },
    enabled: Boolean(canRead)
  });

  const lowStockQuery = useQuery({
    queryKey: ["low-stock"],
    queryFn: async () => (await api.get("/inventory/low-stock")).data,
    enabled: Boolean(canRead)
  });

  const ledgerQuery = useQuery({
    queryKey: ["inventory-transactions"],
    queryFn: async () => (await api.get("/inventory/transactions", { params: { limit: 200 } })).data,
    enabled: Boolean(canRead && canReport)
  });

  const purchasesQuery = useQuery({
    queryKey: ["inventory-purchases"],
    queryFn: async () =>
      (await api.get("/inventory/transactions", { params: { type: "RECEIVE", limit: 500 } })).data,
    enabled: Boolean(canRead && canViewPurchases)
  });

  const payablesQuery = useQuery({
    queryKey: ["payables"],
    queryFn: async () => (await api.get("/payables", { params: { limit: 500 } })).data,
    enabled: Boolean(canViewPayables)
  });

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
      toast.show({
        title: "Unable to mark paid",
        description: getErrorMessage(err) || "Try again.",
        variant: "error"
      });
    }
  });

  const activityQuery = useQuery({
    queryKey: ["inventory-activity"],
    queryFn: async () => (await api.get("/inventory/transactions", { params: { limit: 10 } })).data,
    enabled: Boolean(canRead)
  });

  const parts = useMemo(
    () => (partsQuery.data?.items as Part[] | undefined) || [],
    [partsQuery.data]
  );
  const [sortKey, setSortKey] = useState<keyof Part>("partName");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const [receiveBanner, setReceiveBanner] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [adjustBanner, setAdjustBanner] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [issueBanner, setIssueBanner] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [barcodeFocused, setBarcodeFocused] = useState(false);

  const sortedParts = useMemo(() => {
    const list = [...parts];
    list.sort((a, b) => {
      const aVal = a[sortKey];
      const bVal = b[sortKey];
      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortDir === "asc" ? aVal - bVal : bVal - aVal;
      }
      return sortDir === "asc"
        ? String(aVal ?? "").localeCompare(String(bVal ?? ""))
        : String(bVal ?? "").localeCompare(String(aVal ?? ""));
    });
    return list;
  }, [parts, sortDir, sortKey]);

  const pageCount = Math.max(1, Math.ceil(sortedParts.length / pageSize));
  const pagedParts = useMemo(
    () => sortedParts.slice((page - 1) * pageSize, page * pageSize),
    [sortedParts, page]
  );

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch]);

  const filteredLedger: Transaction[] = useMemo(() => {
    if (!ledgerQuery.data) return [];
    return ledgerQuery.data
      .filter((t: Transaction) => (ledgerFilters.partId ? t.partId === ledgerFilters.partId : true))
      .filter((t: Transaction) => (ledgerFilters.type ? t.type === ledgerFilters.type : true))
      .filter((t: Transaction) => (ledgerFilters.ref ? (t.referenceId || "").includes(ledgerFilters.ref) : true));
  }, [ledgerQuery.data, ledgerFilters]);

  const partsById = useMemo(() => {
    const map = new Map<string, Part>();
    parts.forEach((p) => map.set(p._id, p));
    return map;
  }, [parts]);

  const filteredPurchases: Transaction[] = useMemo(() => {
    const list: Transaction[] = purchasesQuery.data || [];
    return list
      .filter((t) => (purchaseFilters.partId ? t.partId === purchaseFilters.partId : true))
      .filter((t) => (purchaseFilters.paymentMethod ? t.paymentMethod === purchaseFilters.paymentMethod : true))
      .filter((t) =>
        purchaseFilters.vendor
          ? (t.vendorName || "").toLowerCase().includes(purchaseFilters.vendor.toLowerCase())
          : true
      )
      .filter((t) =>
        purchaseFilters.purchaser
          ? (t.performedByName || "").toLowerCase().includes(purchaseFilters.purchaser.toLowerCase())
          : true
      )
      .filter((t) => {
        if (!purchaseFilters.from && !purchaseFilters.to) return true;
        const created = new Date(t.createdAt).getTime();
        const from = purchaseFilters.from ? new Date(purchaseFilters.from).getTime() : undefined;
        const to = purchaseFilters.to ? new Date(purchaseFilters.to).getTime() : undefined;
        if (from && created < from) return false;
        if (to && created > to) return false;
        return true;
      });
  }, [purchaseFilters, purchasesQuery.data]);

  const filteredPayables: Payable[] = useMemo(() => {
    const list: Payable[] = payablesQuery.data || [];
    return list
      .filter((p) => (payableFilters.partId ? p.partId === payableFilters.partId : true))
      .filter((p) => (payableFilters.status ? (p.status || "").toUpperCase() === payableFilters.status : true))
      .filter((p) =>
        payableFilters.vendor
          ? (p.vendorName || "").toLowerCase().includes(payableFilters.vendor.toLowerCase())
          : true
      )
      .filter((p) =>
        payableFilters.purchaser
          ? (p.createdByName || "").toLowerCase().includes(payableFilters.purchaser.toLowerCase())
          : true
      )
      .filter((p) => {
        if (!payableFilters.from && !payableFilters.to) return true;
        const created = new Date(p.purchaseDate).getTime();
        const from = payableFilters.from ? new Date(payableFilters.from).getTime() : undefined;
        const to = payableFilters.to ? new Date(payableFilters.to).getTime() : undefined;
        if (from && created < from) return false;
        if (to && created > to) return false;
        return true;
      });
  }, [payableFilters, payablesQuery.data]);

  const purchasesTotal = useMemo(
    () => filteredPurchases.reduce((sum, t) => sum + Math.abs(t.qtyChange) * (t.unitCost ?? 0), 0),
    [filteredPurchases]
  );
  const payablesTotal = useMemo(
    () => filteredPayables.reduce((sum, p) => sum + (p.amount || 0), 0),
    [filteredPayables]
  );

  const receiveMutation = useMutation({
    mutationFn: async () =>
      api.post("/inventory/receive", {
        ...receiveForm,
        vendorName: receiveForm.vendorName || undefined
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["parts"] });
      setReceiveBanner({ type: "success", message: `Txn ${res.data.transaction?._id || ""} - Avg cost ${res.data.part?.avgCost ?? "--"}` });
      toast.show({
        title: "Receive Stock posted",
        description: `Txn ${res.data.transaction?._id || ""} - Avg cost ${res.data.part?.avgCost ?? "--"}`,
        variant: "success"
      });
      setReceiveOpen(false);
    },
    onError: (err: unknown) => {
      const message = `${getErrorMessage(err) || "Unable to post receive"}. Verify quantity and try again.`;
      setReceiveBanner({ type: "error", message });
      toast.show({
        title: "Receive Stock failed",
        description: message,
        variant: "error"
      });
    }
  });

  const adjustMutation = useMutation({
    mutationFn: async () =>
      api.post("/inventory/adjust", {
        ...adjustForm
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["parts"] });
      setAdjustBanner({ type: "success", message: `Txn ${res.data.transaction?._id || ""}` });
      toast.show({
        title: "Adjust Stock posted",
        description: `Txn ${res.data.transaction?._id || ""}`,
        variant: "success"
      });
      setAdjustOpen(false);
    },
    onError: (err: unknown) => {
      const message = `${getErrorMessage(err) || "Unable to adjust"}. Confirm reason and available quantity.`;
      setAdjustBanner({ type: "error", message });
      toast.show({
        title: "Adjust Stock failed",
        description: message,
        variant: "error"
      });
    }
  });

  const createPartMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        ...createForm,
        barcode: createForm.barcode.trim() || undefined,
        category: createForm.category.trim() || undefined,
        vendorName: createForm.vendorName.trim() || undefined
      };
      return api.post("/parts", payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["parts"] });
      toast.show({ title: "Part created", description: `${createForm.sku}`, variant: "success" });
      setCreateOpen(false);
      setCreateForm({
        partName: "",
        sku: "",
        barcode: "",
        category: "",
        vendorName: "",
        reorderLevel: 0
      });
    },
    onError: (err: unknown) =>
      toast.show({
        title: "Part creation failed",
        description: getErrorMessage(err) || "Check SKU uniqueness and required fields.",
        variant: "error"
      })
  });

  const priceMutation = useMutation({
    mutationFn: async () =>
      api.patch(`/parts/${priceForm.partId}/price`, {
        sellingPrice: priceForm.sellingPrice
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["parts"] });
      toast.show({ title: "Price updated", description: `New sell price set`, variant: "success" });
      setPriceOpen(false);
    },
    onError: (err: unknown) =>
      toast.show({
        title: "Price update failed",
        description: getErrorMessage(err) || "Check permission and try again.",
        variant: "error"
      })
  });

  const issueMutation = useMutation({
    mutationFn: async () =>
      api.post(`/work-orders/${issueForm.workOrderId}/issue-part`, {
        partId: issueForm.partId,
        qty: issueForm.qty
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["parts"] });
      setIssueBanner({ type: "success", message: `WO ${issueForm.workOrderId} - Txn ${res.data?.transaction?._id || ""}` });
      toast.show({
        title: "Issue to Work Order posted",
        description: `WO ${issueForm.workOrderId} - Txn ${res.data?.transaction?._id || ""}`,
        variant: "success"
      });
      setIssueOpen(false);
    },
    onError: (err: unknown) => {
      const msg = getErrorMessage(err);
      const message = msg.includes("Insufficient")
        ? `Only ${issueAvailable} available. Reduce quantity or receive stock.`
        : msg || "Unable to issue. Verify WO and quantity.";
      setIssueBanner({ type: "error", message });
      toast.show({
        title: "Issue to Work Order failed",
        description: message,
        variant: "error"
      });
    }
  });

  const lowStock = (lowStockQuery.data as Part[]) || [];

  const selectedAvailable = selectedPart ? (selectedPart.availableQty ?? (selectedPart.onHandQty ?? 0) - (selectedPart.reservedQty ?? 0)) : 0;
  const receiveSelectedPart = parts.find((p) => p._id === receiveForm.partId) || selectedPart;
  const issueSelectedPart = parts.find((p) => p._id === issueForm.partId) || selectedPart;
  const adjustSelectedPart = parts.find((p) => p._id === adjustForm.partId) || selectedPart;
  const issueAvailable = issueSelectedPart
    ? (issueSelectedPart.availableQty ?? (issueSelectedPart.onHandQty ?? 0) - (issueSelectedPart.reservedQty ?? 0))
    : 0;
  const receiveTotal =
    Number.isFinite(receiveForm.qty) && Number.isFinite(receiveForm.unitCost)
      ? receiveForm.qty * receiveForm.unitCost
      : 0;

  const getErrorMessage = (err: unknown) => {
    if (err instanceof Error) return err.message;
    if (typeof err === "string") return err;
    return "Unexpected error";
  };

  const viewOnlyMessage =
    !canReceive && !canAdjustAllowed && !canIssue
      ? "Your role is view-only. Contact an admin for inventory permissions."
    : null;

  const validateReceive = () => {
    if (!receiveForm.partId) return "Select a part to receive.";
    if (!Number.isFinite(receiveForm.qty) || receiveForm.qty <= 0) return "Quantity must be greater than zero.";
    if (!Number.isFinite(receiveForm.unitCost) || receiveForm.unitCost < 0) return "Unit cost must be zero or higher.";
    if (receiveForm.sellingPrice !== undefined && (receiveForm.sellingPrice as number) < 0) return "Sell price cannot be negative.";
    if (!receiveForm.paymentMethod) return "Select cash or credit.";
    return null;
  };

  const validateAdjust = () => {
    if (!adjustForm.partId) return "Select a part to adjust.";
    if (!Number.isFinite(adjustForm.qtyChange) || adjustForm.qtyChange === 0) return "Enter a positive or negative quantity.";
    if (!adjustForm.reason.trim()) return "Reason is required.";
    return null;
  };

  const validateIssue = () => {
    if (!issueForm.partId) return "Select a part to issue.";
    if (!issueForm.workOrderId.trim()) return "Work Order ID is required.";
    if (!Number.isFinite(issueForm.qty) || issueForm.qty <= 0) return "Quantity must be greater than zero.";
    if (issueSelectedPart && issueForm.qty > issueAvailable) return `Only ${issueAvailable} available.`;
    return null;
  };

  const exportLedgerCsv = () => {
    if (!filteredLedger.length) return;
    const header = ["type", "partId", "qtyChange", "unitCost", "unitPrice", "referenceType", "referenceId", "createdAt"].join(",");
    const rows = filteredLedger
      .map((t) => [t.type, t.partId, t.qtyChange, t.unitCost ?? "", t.unitPrice ?? "", t.referenceType ?? "", t.referenceId ?? "", t.createdAt].join(","))
      .join("\n");
    const blob = new Blob([header + "\n" + rows], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "inventory-ledger.csv";
    link.click();
  };

  const exportLowStockCsv = () => {
    if (!lowStock.length) return;
    const header = ["sku", "partName", "onHand", "reserved", "available", "reorderLevel"].join(",");
    const rows = lowStock
      .map((p) =>
        [
          p.sku,
          p.partName,
          p.onHandQty ?? 0,
          p.reservedQty ?? 0,
          (p.onHandQty ?? 0) - (p.reservedQty ?? 0),
          p.reorderLevel ?? ""
        ].join(",")
      )
      .join("\n");
    const blob = new Blob([header + "\n" + rows], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "low-stock.csv";
    link.click();
  };

  const loading = partsQuery.isLoading;
  const activity = activityQuery.data as Transaction[] | undefined;

  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const todaysTransactions = (ledgerQuery.data as Transaction[] | undefined) || [];
  const todaysCounterSales = todaysTransactions.filter((t) => t.type === "COUNTER_SALE" && new Date(t.createdAt) >= todayStart).length;
  const todaysIssued = todaysTransactions.filter((t) => t.type === "ISSUE_TO_WORK_ORDER" && new Date(t.createdAt) >= todayStart).reduce((sum, t) => sum + Math.abs(t.qtyChange), 0);
  const lowStockCount = lowStock.length;

  return (
    <Shell>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Inventory</h1>
          <p className="text-muted-foreground text-sm">Receive Stock, Issue to Work Order, Adjust Stock, and Reverse Transaction with audit.</p>
        </div>
        {viewOnlyMessage && <Badge variant="warning">View-only</Badge>}
      </div>

      <div className="glass p-4 rounded-xl space-y-3">
        <div className="grid md:grid-cols-2 gap-3">
          <div className="flex gap-2 items-center">
            <Input
              ref={searchRef}
              placeholder="Search name / SKU"
              title="Search by part name or SKU"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search inventory"
            />
            <Input
              placeholder="Barcode scan"
              title="Scan or type barcode"
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
              onFocus={() => setBarcodeFocused(true)}
              onBlur={() => setBarcodeFocused(false)}
              aria-label="Barcode search"
            />
            {barcodeFocused && <span className="text-[11px] text-accent">Scan mode: focused</span>}
          </div>
          <div className="flex flex-wrap gap-2 justify-end">
            {canCreate && (
              <Button variant="secondary" onClick={() => setCreateOpen(true)}>
                Create Part
              </Button>
            )}
            {canPriceUpdate && selectedPart && (
              <Button
                variant="secondary"
                onClick={() => {
                  setPriceForm({ partId: selectedPart._id, sellingPrice: selectedPart.sellingPrice || 0 });
                  setPriceOpen(true);
                }}
              >
                Update Price
              </Button>
            )}
            {canReport && (
              <Button variant="secondary" onClick={() => setLedgerOpen(true)}>
                View Ledger
              </Button>
            )}
            {canViewPurchases && (
              <Button variant="secondary" onClick={() => setPurchasesOpen(true)}>
                Purchases
              </Button>
            )}
            {canViewPayables && (
              <Button variant="secondary" onClick={() => setPayablesOpen(true)}>
                Payables
              </Button>
            )}
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-3">
          <div className="p-3 rounded-lg border border-border bg-card">
            <p className="text-xs text-muted-foreground">Low stock items</p>
            <p className="text-2xl font-semibold">{lowStockCount}</p>
          </div>
          <div className="p-3 rounded-lg border border-border bg-card">
            <p className="text-xs text-muted-foreground">Today&apos;s counter sales</p>
            <p className="text-2xl font-semibold">{todaysCounterSales}</p>
          </div>
          <div className="p-3 rounded-lg border border-border bg-card">
            <p className="text-xs text-muted-foreground">Parts issued today</p>
            <p className="text-2xl font-semibold">{todaysIssued}</p>
          </div>
        </div>

        <div className="overflow-auto rounded-lg border border-border">
          <Table>
            <THead>
              <TR>
                {[
                  { key: "sku", label: "SKU" },
                  { key: "partName", label: "Name" },
                  { key: "category", label: "Category" },
                  { key: "onHandQty", label: "On hand" },
                  { key: "reservedQty", label: "Reserved" },
                  { key: "availableQty", label: "Available" },
                  { key: "sellingPrice", label: "Sell" },
                  { key: "purchasePrice", label: "Landed" }
                ].map((col) => (
                  <TH
                    key={col.key}
                    className="cursor-pointer select-none"
                    onClick={() => {
                      const nextDir = sortKey === col.key ? (sortDir === "asc" ? "desc" : "asc") : "asc";
                      setSortKey(col.key as keyof Part);
                      setSortDir(nextDir);
                      setPage(1);
                    }}
                    title="Click to sort"
                  >
                    {col.label} {sortKey === col.key ? (sortDir === "asc" ? "up" : "down") : ""}
                  </TH>
                ))}
                <TH></TH>
              </TR>
            </THead>
            <TBody>
              {loading &&
                Array.from({ length: 6 }).map((_, i) => (
                  <TR key={i}>
                    <TD colSpan={9}>
                      <Skeleton className="h-6 w-full" />
                    </TD>
                  </TR>
                ))}
              {!loading &&
                pagedParts.map((p) => (
                  <TR key={p._id} onClick={() => setSelectedPart(p)} className="cursor-pointer">
                    <TD className="font-mono text-xs">{p.sku}</TD>
                    <TD>{p.partName}</TD>
                    <TD>{p.category || "-"}</TD>
                    <TD>{p.onHandQty ?? 0}</TD>
                    <TD>{p.reservedQty ?? 0}</TD>
                    <TD className="font-semibold">{p.availableQty ?? (p.onHandQty ?? 0) - (p.reservedQty ?? 0)}</TD>
                    <TD>Tk. {p.sellingPrice?.toFixed(2) ?? "--"}</TD>
                    <TD className="text-xs text-muted-foreground">
                      {p.purchasePrice !== undefined ? `Tk. ${p.purchasePrice.toFixed(2)}` : "--"}
                    </TD>
                    <TD>
                      {p.reorderLevel && (p.onHandQty ?? 0) < p.reorderLevel ? <Badge variant="warning">Low</Badge> : <Badge variant="secondary">OK</Badge>}
                    </TD>
                  </TR>
                ))}
            </TBody>
          </Table>
          {!loading && parts.length === 0 && <div className="p-4 text-sm text-muted-foreground">No parts found.</div>}
        </div>
        <div className="flex items-center justify-between text-sm text-muted-foreground mt-2">
          <span>
            Page {page} of {pageCount}
          </span>
          <div className="flex gap-2">
            <Button variant="secondary" disabled={page === 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              Prev
            </Button>
            <Button variant="secondary" disabled={page === pageCount} onClick={() => setPage((p) => Math.min(pageCount, p + 1))}>
              Next
            </Button>
          </div>
        </div>
      </div>

      <div className="glass p-4 rounded-xl">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="font-semibold text-foreground">Low Stock</p>
            <p className="text-xs text-muted-foreground">Based on reorder levels</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={exportLowStockCsv}>
              Export CSV
            </Button>
            <Button variant="secondary" onClick={() => toast.show({ title: "Purchase orders coming soon" })}>
              Create PO (stub)
            </Button>
          </div>
        </div>
        <div className="space-y-2">
          {(lowStock || []).map((p) => {
            const available = (p.onHandQty ?? 0) - (p.reservedQty ?? 0);
            const suggested = Math.max((p.reorderLevel || 0) - (p.onHandQty || 0), 1);
            return (
              <div key={p._id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                <div>
                  <p className="font-semibold">{p.partName}</p>
                  <p className="text-xs text-muted-foreground">
                    SKU {p.sku} - On hand {p.onHandQty ?? 0} - Available {available}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="warning">Reorder {suggested}</Badge>
                  <Button variant="secondary" onClick={() => setSelectedPart(p)}>
                    View
                  </Button>
                </div>
              </div>
            );
          })}
          {lowStock?.length === 0 && <p className="text-sm text-muted-foreground">All good. No low-stock items.</p>}
        </div>
      </div>

      <Drawer open={!!selectedPart} onClose={() => setSelectedPart(null)} title={selectedPart?.partName || "Part detail"}>
        {selectedPart && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
              <Badge variant="secondary">SKU {selectedPart.sku}</Badge>
              <Badge variant="secondary">On hand {selectedPart.onHandQty ?? 0}</Badge>
              <Badge variant="secondary">Reserved {selectedPart.reservedQty ?? 0}</Badge>
              <Badge variant="secondary">Available {selectedAvailable}</Badge>
            </div>
            <div className="space-y-2 text-sm">
              <p>Sell price: Tk. {selectedPart.sellingPrice?.toFixed(2) ?? "--"}</p>
              <p>Avg cost: Tk. {selectedPart.avgCost?.toFixed(2) ?? "--"}</p>
              <p>Category: {selectedPart.category || "-"}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {canReceive && (
                <Button
                  onClick={() => {
                    setReceiveForm((p) => ({
                      ...p,
                      partId: selectedPart._id,
                      sellingPrice: selectedPart.sellingPrice ?? undefined
                    }));
                    setReceiveOpen(true);
                  }}
                >
                  Receive
                </Button>
              )}
              {canAdjust && (
                <Button variant="secondary" onClick={() => setAdjustOpen(true)}>
                  Adjust
                </Button>
              )}
              {canIssue && (
                <Button variant="secondary" onClick={() => setIssueOpen(true)}>
                  Issue to WO
                </Button>
              )}
              {canPriceUpdate && (
                <Button variant="secondary" onClick={() => { setPriceForm({ partId: selectedPart._id, sellingPrice: selectedPart.sellingPrice || 0 }); setPriceOpen(true); }}>
                  Update Price
                </Button>
              )}
              <Button variant="outline" onClick={() => setLedgerOpen(true)}>
                View Ledger
              </Button>
            </div>
            {viewOnlyMessage && <p className="text-xs text-amber-400">{viewOnlyMessage}</p>}
          </div>
        )}
      </Drawer>

      <Dialog open={receiveOpen} onClose={() => setReceiveOpen(false)} title="Receive Stock">
        <div className="space-y-3">
          {receiveBanner && (
            <div className={`rounded-md px-3 py-2 text-sm ${receiveBanner.type === "error" ? "bg-destructive/10 text-destructive" : "bg-emerald-500/10 text-emerald-200"}`}>
              {receiveBanner.message}
            </div>
          )}
          <Select value={receiveForm.partId} onChange={(e) => setReceiveForm((p) => ({ ...p, partId: e.target.value }))}>
            <option value="">Select part</option>
            {parts.map((p) => (
              <option key={p._id} value={p._id}>
                {p.partName} - {p.sku}
              </option>
            ))}
          </Select>
          {receiveSelectedPart && (
            <p className="text-xs text-muted-foreground">
              Selected available: {(receiveSelectedPart.availableQty ?? (receiveSelectedPart.onHandQty ?? 0) - (receiveSelectedPart.reservedQty ?? 0))} units
            </p>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Input
              type="number"
              min={1}
              placeholder="Quantity"
              title="Units to receive"
              value={receiveForm.qty}
              onChange={(e) => setReceiveForm((p) => ({ ...p, qty: Number(e.target.value) }))}
            />
            <Input
              type="number"
              min={0}
              step="0.01"
              placeholder="Unit cost"
              title="Cost per unit"
              value={receiveForm.unitCost}
              onChange={(e) => setReceiveForm((p) => ({ ...p, unitCost: Number(e.target.value) }))}
            />
          </div>
          <Select
            value={receiveForm.paymentMethod || ""}
            onChange={(e) =>
              setReceiveForm((p) => ({ ...p, paymentMethod: e.target.value as ReceiveForm["paymentMethod"] }))
            }
          >
            <option value="">Payment method</option>
            <option value="CASH">Cash</option>
            <option value="CREDIT">Credit</option>
          </Select>
          <Input
            type="number"
            min={0}
            step="0.01"
            placeholder="Sell price (optional)"
            title="Customer price per unit"
            value={receiveForm.sellingPrice ?? ""}
            onChange={(e) =>
              setReceiveForm((p) => ({
                ...p,
                sellingPrice: e.target.value === "" ? undefined : Number(e.target.value)
              }))
            }
          />
          <Input
            placeholder="Vendor (optional)"
            title="Supplier or vendor reference"
            value={receiveForm.vendorName}
            onChange={(e) => setReceiveForm((p) => ({ ...p, vendorName: e.target.value }))}
          />
          <Textarea
            placeholder="Notes (optional)"
            title="Reference or notes for audit"
            value={receiveForm.notes}
            onChange={(e) => setReceiveForm((p) => ({ ...p, notes: e.target.value }))}
          />
          <div className="text-xs text-muted-foreground">
            Total cost: Tk. {formatMoney(receiveTotal)}.{" "}
            {receiveForm.paymentMethod === "CASH"
              ? "Cash receives post a Supplies expense automatically."
              : receiveForm.paymentMethod === "CREDIT"
              ? "Credit receives create an open payable."
              : "Select cash or credit to continue."}
          </div>
          <p className="text-xs text-muted-foreground">
            Avg cost updates automatically on receive. Current avg: Tk. {selectedPart?.avgCost?.toFixed(2) ?? "--"}. Leave sell price blank to keep current.
          </p>
        </div>
        <div className="flex justify-end gap-2 mt-3">
          <Button variant="ghost" onClick={() => setReceiveOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              const error = validateReceive();
              setReceiveBanner(error ? { type: "error", message: error } : null);
              if (error) return;
              receiveMutation.mutate();
            }}
            isLoading={receiveMutation.isPending}
            disabled={!receiveForm.partId || receiveForm.qty <= 0 || !receiveForm.paymentMethod}
          >
            Confirm Receive
          </Button>
        </div>
      </Dialog>

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} title="Create Part">
        <div className="space-y-3">
          <Input
            placeholder="Part name"
            title="Required: descriptive item name"
            value={createForm.partName}
            onChange={(e) => setCreateForm((p) => ({ ...p, partName: e.target.value }))}
          />
          <div className="grid grid-cols-2 gap-2">
            <Input
              placeholder="SKU (unique)"
              title="Required: unique stock code"
              value={createForm.sku}
              onChange={(e) => setCreateForm((p) => ({ ...p, sku: e.target.value }))}
            />
            <Input
              placeholder="Barcode (optional)"
              title="Optional: scanned barcode value"
              value={createForm.barcode}
              onChange={(e) => setCreateForm((p) => ({ ...p, barcode: e.target.value }))}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Input
              placeholder="Category"
              title="Optional: grouping (e.g., Fluids, Brakes)"
              value={createForm.category}
              onChange={(e) => setCreateForm((p) => ({ ...p, category: e.target.value }))}
            />
            <Input
              placeholder="Vendor"
              title="Optional: supplier name"
              value={createForm.vendorName}
              onChange={(e) => setCreateForm((p) => ({ ...p, vendorName: e.target.value }))}
            />
          </div>
          <Input
            type="number"
            min={0}
            placeholder="Reorder level (units)"
            title="Alert threshold for low stock"
            value={createForm.reorderLevel}
            onChange={(e) => setCreateForm((p) => ({ ...p, reorderLevel: Number(e.target.value) }))}
          />
          <p className="text-xs text-muted-foreground">
            You can set buy/sell prices when receiving stock. Save to enable Receive Stock, Issue to Work Order, Adjust Stock.
          </p>
        </div>
        <div className="flex justify-end gap-2 mt-3">
          <Button variant="ghost" onClick={() => setCreateOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => createPartMutation.mutate()}
            isLoading={createPartMutation.isPending}
            disabled={!createForm.partName || !createForm.sku}
          >
            Save Part
          </Button>
        </div>
      </Dialog>

      <Dialog open={adjustOpen} onClose={() => setAdjustOpen(false)} title="Adjust Stock">
          {(!canAdjustAllowed) && <div className="text-sm text-amber-400 mb-2">Adjust Stock is restricted to Owner/Admin, Operations Manager, or Inventory Manager.</div>}
        <div className="space-y-3">
          {adjustBanner && (
            <div className={`rounded-md px-3 py-2 text-sm ${adjustBanner.type === "error" ? "bg-destructive/10 text-destructive" : "bg-emerald-500/10 text-emerald-200"}`}>
              {adjustBanner.message}
            </div>
          )}
          <Select value={adjustForm.partId} onChange={(e) => setAdjustForm((p) => ({ ...p, partId: e.target.value }))} disabled={!canAdjustAllowed}>
            <option value="">Select part</option>
            {parts.map((p) => (
              <option key={p._id} value={p._id}>
                {p.partName} - {p.sku}
              </option>
            ))}
          </Select>
          {adjustSelectedPart && (
            <p className="text-xs text-muted-foreground">
              Available before adjustment: {(adjustSelectedPart.availableQty ?? (adjustSelectedPart.onHandQty ?? 0) - (adjustSelectedPart.reservedQty ?? 0))}
            </p>
          )}
          <Input
            type="number"
            placeholder="Qty change (+/-)"
            title="Positive or negative units"
            value={adjustForm.qtyChange}
            onChange={(e) => setAdjustForm((p) => ({ ...p, qtyChange: Number(e.target.value) }))}
            disabled={!canAdjustAllowed}
          />
          <Textarea
            placeholder="Reason (required)"
            title="Required audit reason"
            value={adjustForm.reason}
            onChange={(e) => setAdjustForm((p) => ({ ...p, reason: e.target.value }))}
            disabled={!canAdjustAllowed}
          />
          <div className="text-xs text-muted-foreground bg-amber-500/10 border border-amber-500/40 rounded-md p-2">
            Adjustment posts immediately and is audited. Negative adjustments are blocked if stock insufficient.
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-3">
          <Button variant="ghost" onClick={() => setAdjustOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              const error = validateAdjust();
              setAdjustBanner(error ? { type: "error", message: error } : null);
              if (error) return;
              openConfirm({
                title: "Post adjustment?",
                description: "This adjustment posts immediately and cannot be undone automatically.",
                destructive: true,
                confirmText: "Post adjustment",
                onConfirm: () => adjustMutation.mutate()
              });
            }}
            isLoading={adjustMutation.isPending}
            disabled={!canAdjustAllowed || !adjustForm.partId || adjustForm.qtyChange === 0 || !adjustForm.reason}
          >
            Post Adjustment
          </Button>
        </div>
      </Dialog>

      <Dialog open={issueOpen} onClose={() => setIssueOpen(false)} title="Issue to Work Order">
        <div className="space-y-3">
          {issueBanner && (
            <div className={`rounded-md px-3 py-2 text-sm ${issueBanner.type === "error" ? "bg-destructive/10 text-destructive" : "bg-emerald-500/10 text-emerald-200"}`}>
              {issueBanner.message}
            </div>
          )}
          <Select value={issueForm.partId} onChange={(e) => setIssueForm((p) => ({ ...p, partId: e.target.value }))}>
            <option value="">Select part</option>
            {parts.map((p) => (
              <option key={p._id} value={p._id}>
                {p.partName} - {p.sku} - Avail {p.availableQty ?? (p.onHandQty ?? 0) - (p.reservedQty ?? 0)}
              </option>
            ))}
          </Select>
          <Input
            placeholder="Work Order ID"
            title="Target work order number"
            value={issueForm.workOrderId}
            onChange={(e) => setIssueForm((p) => ({ ...p, workOrderId: e.target.value }))}
          />
          <Input
            type="number"
            min={1}
            placeholder="Quantity"
            title="Units to issue"
            value={issueForm.qty}
            onChange={(e) => setIssueForm((p) => ({ ...p, qty: Number(e.target.value) }))}
          />
          {issueSelectedPart && (
            <p className="text-xs text-muted-foreground">
              Available: {(issueSelectedPart.availableQty ?? (issueSelectedPart.onHandQty ?? 0) - (issueSelectedPart.reservedQty ?? 0))}. If insufficient, try a lower qty or receive stock first.
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2 mt-3">
          <Button variant="ghost" onClick={() => setIssueOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              const error = validateIssue();
              setIssueBanner(error ? { type: "error", message: error } : null);
              if (error) return;
              openConfirm({
                title: "Issue parts?",
                description: "This will immediately issue parts to the work order.",
                confirmText: "Issue parts",
                onConfirm: () => issueMutation.mutate()
              });
            }}
            isLoading={issueMutation.isPending}
            disabled={!issueForm.partId || !issueForm.workOrderId || issueForm.qty <= 0}
          >
            Issue
          </Button>
        </div>
      </Dialog>

      <Dialog open={priceOpen} onClose={() => setPriceOpen(false)} title="Update Sell Price">
        <div className="space-y-3">
          <Select value={priceForm.partId} onChange={(e) => setPriceForm((p) => ({ ...p, partId: e.target.value }))}>
            <option value="">Select part</option>
            {parts.map((p) => (
              <option key={p._id} value={p._id}>
                {p.partName} - {p.sku}
              </option>
            ))}
          </Select>
          <Input
            type="number"
            min={0}
            step="0.01"
            placeholder="New sell price"
            title="Enter new sell price"
            value={priceForm.sellingPrice}
            onChange={(e) => setPriceForm((p) => ({ ...p, sellingPrice: Number(e.target.value) }))}
          />
        </div>
        <div className="flex justify-end gap-2 mt-3">
          <Button variant="ghost" onClick={() => setPriceOpen(false)}>
            Cancel
          </Button>
          <Button onClick={() => priceMutation.mutate()} isLoading={priceMutation.isPending} disabled={!priceForm.partId}>
            Save Price
          </Button>
        </div>
      </Dialog>

      <Drawer open={ledgerOpen && !!canReport} onClose={() => setLedgerOpen(false)} title="Inventory Ledger">
        <div className="space-y-3">
          <div className="grid md:grid-cols-4 gap-2">
            <Select value={ledgerFilters.partId} onChange={(e) => setLedgerFilters((f) => ({ ...f, partId: e.target.value }))}>
              <option value="">All parts</option>
              {parts.map((p) => (
                <option key={p._id} value={p._id}>
                  {p.partName} - {p.sku}
                </option>
              ))}
            </Select>
            <Select value={ledgerFilters.type} onChange={(e) => setLedgerFilters((f) => ({ ...f, type: e.target.value }))}>
              <option value="">All types</option>
              <option value="RECEIVE">Receive</option>
              <option value="ADJUSTMENT">Adjustment</option>
              <option value="ISSUE_TO_WORK_ORDER">Issue to WO</option>
              <option value="COUNTER_SALE">Counter sale</option>
              <option value="RETURN">Return</option>
            </Select>
            <Input placeholder="Reference (WO/Invoice)" value={ledgerFilters.ref} onChange={(e) => setLedgerFilters((f) => ({ ...f, ref: e.target.value }))} />
            <Button variant="outline" onClick={exportLedgerCsv}>
              Export CSV
            </Button>
          </div>
          <div className="max-h-[60vh] overflow-auto border border-border rounded-lg">
            <Table>
              <THead>
                <TR>
                  <TH>Type</TH>
                  <TH>Qty</TH>
                  <TH>Unit Cost</TH>
                  <TH>Unit Price</TH>
                  <TH>Reference</TH>
                  <TH>Date</TH>
                </TR>
              </THead>
              <TBody>
                {ledgerQuery.isLoading &&
                  Array.from({ length: 6 }).map((_, i) => (
                    <TR key={i}>
                      <TD colSpan={6}>
                        <Skeleton className="h-5 w-full" />
                      </TD>
                    </TR>
                  ))}
                {!ledgerQuery.isLoading &&
                  filteredLedger.map((t) => (
                    <TR key={t._id}>
                      <TD>{t.type}</TD>
                      <TD className={t.qtyChange < 0 ? "text-primary" : "text-emerald-300"}>{t.qtyChange}</TD>
                      <TD>Tk. {formatMoney(t.unitCost)}</TD>
                      <TD>Tk. {formatMoney(t.unitPrice)}</TD>
                      <TD>
                        {t.referenceType} {t.referenceId || ""}
                      </TD>
                      <TD>{new Date(t.createdAt).toLocaleString()}</TD>
                    </TR>
                  ))}
              </TBody>
            </Table>
            {!ledgerQuery.isLoading && filteredLedger.length === 0 && (
              <div className="p-3 text-sm text-muted-foreground">No transactions found.</div>
            )}
          </div>
        </div>
      </Drawer>

      <Drawer open={purchasesOpen && !!canViewPurchases} onClose={() => setPurchasesOpen(false)} title="Purchases">
        <div className="space-y-3">
          <div className="grid md:grid-cols-6 gap-2">
            <Select value={purchaseFilters.partId} onChange={(e) => setPurchaseFilters((f) => ({ ...f, partId: e.target.value }))}>
              <option value="">All parts</option>
              {parts.map((p) => (
                <option key={p._id} value={p._id}>
                  {p.partName} - {p.sku}
                </option>
              ))}
            </Select>
            <Select
              value={purchaseFilters.paymentMethod}
              onChange={(e) => setPurchaseFilters((f) => ({ ...f, paymentMethod: e.target.value }))}
            >
              <option value="">All payments</option>
              <option value="CASH">Cash</option>
              <option value="CREDIT">Credit</option>
            </Select>
            <Input
              placeholder="Vendor"
              value={purchaseFilters.vendor}
              onChange={(e) => setPurchaseFilters((f) => ({ ...f, vendor: e.target.value }))}
            />
            <Input
              placeholder="Purchased by"
              value={purchaseFilters.purchaser}
              onChange={(e) => setPurchaseFilters((f) => ({ ...f, purchaser: e.target.value }))}
            />
            <Input
              type="date"
              value={purchaseFilters.from}
              onChange={(e) => setPurchaseFilters((f) => ({ ...f, from: e.target.value }))}
            />
            <Input
              type="date"
              value={purchaseFilters.to}
              onChange={(e) => setPurchaseFilters((f) => ({ ...f, to: e.target.value }))}
            />
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Total purchases: Tk. {formatMoney(purchasesTotal)}</span>
            <span>{filteredPurchases.length} records</span>
          </div>
          <div className="max-h-[60vh] overflow-auto border border-border rounded-lg">
            <Table>
              <THead>
                <TR>
                  <TH>Date</TH>
                  <TH>Part</TH>
                  <TH>Qty</TH>
                  <TH>Unit Cost</TH>
                  <TH>Total</TH>
                  <TH>Payment</TH>
                  <TH>Vendor</TH>
                  <TH>Purchased by</TH>
                  <TH>Notes</TH>
                </TR>
              </THead>
              <TBody>
                {purchasesQuery.isLoading &&
                  Array.from({ length: 6 }).map((_, i) => (
                    <TR key={i}>
                      <TD colSpan={9}>
                        <Skeleton className="h-5 w-full" />
                      </TD>
                    </TR>
                  ))}
                {!purchasesQuery.isLoading &&
                  filteredPurchases.map((t) => {
                    const part = partsById.get(t.partId);
                    const qty = Math.abs(t.qtyChange);
                    const total = qty * (t.unitCost ?? 0);
                    return (
                      <TR key={t._id}>
                        <TD>{new Date(t.createdAt).toLocaleString()}</TD>
                        <TD>{part ? `${part.partName} (${part.sku})` : t.partId}</TD>
                        <TD>{qty}</TD>
                        <TD>Tk. {formatMoney(t.unitCost)}</TD>
                        <TD>Tk. {formatMoney(total)}</TD>
                        <TD>
                          {t.paymentMethod ? <Badge variant="secondary">{t.paymentMethod}</Badge> : "--"}
                        </TD>
                        <TD>{t.vendorName || "--"}</TD>
                        <TD>
                          {t.performedByName
                            ? `${t.performedByName}${t.performedByRole ? ` (${t.performedByRole})` : ""}`
                            : "--"}
                        </TD>
                        <TD className="max-w-[240px] truncate" title={t.notes || ""}>
                          {t.notes || "--"}
                        </TD>
                      </TR>
                    );
                  })}
              </TBody>
            </Table>
            {!purchasesQuery.isLoading && filteredPurchases.length === 0 && (
              <div className="p-3 text-sm text-muted-foreground">No purchases found for the selected filters.</div>
            )}
          </div>
        </div>
      </Drawer>

      <Drawer open={payablesOpen && !!canViewPayables} onClose={() => setPayablesOpen(false)} title="Payables">
        <div className="space-y-3">
          <div className="grid md:grid-cols-6 gap-2">
            <Select value={payableFilters.partId} onChange={(e) => setPayableFilters((f) => ({ ...f, partId: e.target.value }))}>
              <option value="">All parts</option>
              {parts.map((p) => (
                <option key={p._id} value={p._id}>
                  {p.partName} - {p.sku}
                </option>
              ))}
            </Select>
            <Select value={payableFilters.status} onChange={(e) => setPayableFilters((f) => ({ ...f, status: e.target.value }))}>
              <option value="">All status</option>
              <option value="OPEN">Open</option>
              <option value="PAID">Paid</option>
            </Select>
            <Input
              placeholder="Vendor"
              value={payableFilters.vendor}
              onChange={(e) => setPayableFilters((f) => ({ ...f, vendor: e.target.value }))}
            />
            <Input
              placeholder="Purchased by"
              value={payableFilters.purchaser}
              onChange={(e) => setPayableFilters((f) => ({ ...f, purchaser: e.target.value }))}
            />
            <Input
              type="date"
              value={payableFilters.from}
              onChange={(e) => setPayableFilters((f) => ({ ...f, from: e.target.value }))}
            />
            <Input
              type="date"
              value={payableFilters.to}
              onChange={(e) => setPayableFilters((f) => ({ ...f, to: e.target.value }))}
            />
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Total payables: Tk. {formatMoney(payablesTotal)}</span>
            <span>{filteredPayables.length} records</span>
          </div>
          <div className="max-h-[60vh] overflow-auto border border-border rounded-lg">
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
                  filteredPayables.map((p) => {
                    const part = p.partId ? partsById.get(p.partId) : undefined;
                    return (
                      <TR key={p._id}>
                        <TD>{new Date(p.purchaseDate).toLocaleString()}</TD>
                        <TD>{part ? `${part.partName} (${part.sku})` : p.partId || "--"}</TD>
                        <TD>{p.qty}</TD>
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
                        <TD className="max-w-[240px] truncate" title={p.note || ""}>
                          {p.note || "--"}
                        </TD>
                        <TD>
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={!canUpdatePayables || p.status === "PAID" || payablesUpdate.isPending}
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
            {!payablesQuery.isLoading && filteredPayables.length === 0 && (
              <div className="p-3 text-sm text-muted-foreground">No payables found for the selected filters.</div>
            )}
          </div>
        </div>
      </Drawer>

      <div className="glass p-4 rounded-xl space-y-3">
        <div className="flex items-center justify-between">
          <p className="font-semibold text-foreground">Recent activity</p>
          <Badge variant="secondary">Last 10 transactions</Badge>
        </div>
        <div className="space-y-2">
          {(activity || []).map((t) => (
            <div key={t._id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">
              <div>
                <p className="font-semibold">{t.type}</p>
                <p className="text-xs text-muted-foreground">
                  Qty {t.qtyChange} - Ref {t.referenceType || "-"} {t.referenceId || ""}
                </p>
              </div>
              <div className="text-xs text-muted-foreground">{new Date(t.createdAt).toLocaleString()}</div>
            </div>
          ))}
          {activity && activity.length === 0 && <p className="text-sm text-muted-foreground">No recent activity.</p>}
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
