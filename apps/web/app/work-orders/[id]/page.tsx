"use client";

import { useParams, useRouter } from "next/navigation";
import { ReactNode, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Shell from "../../../components/shell";
import api from "../../../lib/api-client";
import { useAuth } from "../../../lib/auth-context";
import Link from "next/link";
import { Badge } from "../../../components/ui/badge";
import { SegmentedControl } from "../../../components/ui/segmented-control";
import { CurrencyInput } from "../../../components/ui/number-input";
import {
  AlertCircle,
  CheckCircle2,
  Clock4,
  Hourglass,
  Lock,
  PauseCircle,
  PlayCircle
} from "lucide-react";
import { useToast } from "../../../components/ui/toast";
import { useDebounce } from "../../../lib/use-debounce";

type WorkOrderNote = {
  message: string;
  createdAt?: string;
};

type WorkOrderPart = {
  partId: string;
  partName?: string;
  sku?: string;
  qty?: number;
  sellingPriceAtTime?: number;
  costAtTime?: number;
  issuedAt?: string;
  createdAt?: string;
  updatedAt?: string;
};

type WorkOrderTimeLog = {
  _id: string;
  employeeId?: string;
  employeeName?: string;
  employeeEmail?: string;
  clockInAt?: string;
  clockOutAt?: string | null;
  durationMinutes?: number;
};

type WorkOrderDetail = {
  workOrder?: {
    _id?: string;
    complaint?: string;
    status?: string;
    notes?: WorkOrderNote[];
    billableLaborAmount?: number;
    otherCharges?: { name?: string; amount?: number }[];
  };
  assignedEmployees?: { _id?: string; employeeId?: string; id?: string; name?: string; email?: string; role?: string }[];
  invoice?: { invoiceNumber?: string; status?: string };
  partsUsed?: WorkOrderPart[];
  timeLogs?: WorkOrderTimeLog[];
  isAssigned?: boolean;
  activeLog?: WorkOrderTimeLog | null;
  runningMinutes?: number;
  totalMinutes?: number;
  financials?: {
    labor?: number;
    partsTotal?: number;
    otherTotal?: number;
    subtotal?: number;
    tax?: number;
    total?: number;
  };
  customer?: { name?: string; phone?: string; email?: string };
  vehicle?: { make?: string; model?: string; year?: string | number; plate?: string; vin?: string };
  audit?: {
    createdBy?: { name?: string; role?: string; at?: string };
    billedBy?: { name?: string; role?: string; at?: string };
    billingUpdatedBy?: { name?: string; role?: string; at?: string };
  };
  auditTrail?: {
    actionType: string;
    by?: { name?: string; role?: string; at?: string };
    assignees?: { id: string; name?: string; role?: string; roleType?: string }[];
    autoAssigned?: boolean;
  }[];
};

type EmployeeLite = { _id?: string; name?: string; email?: string; role?: string; employeeId?: string; id?: string };
type PartSearchItem = { _id: string; partName?: string; sku?: string; onHandQty?: number };

const formatMoney = (val: unknown) => {
  if (val === null || val === undefined) return "--";
  const num =
    typeof val === "number"
      ? val
      : Number(typeof val === "string" ? val : (val as { toString?: () => string })?.toString?.());
  return Number.isFinite(num) ? num.toFixed(2) : "--";
};

const calculateFinancials = (workOrder?: WorkOrderDetail["workOrder"], partsUsed: WorkOrderPart[] = []) => {
  const labor = Number(workOrder?.billableLaborAmount || 0);
  const partsTotal = partsUsed.reduce((sum, part) => {
    const qty = Number(part.qty) || 0;
    const priceEach = Number(part.sellingPriceAtTime || 0);
    return sum + qty * priceEach;
  }, 0);
  const otherTotal = (workOrder?.otherCharges || []).reduce((sum: number, charge) => sum + Number(charge?.amount || 0), 0);
  const subtotal = labor + partsTotal + otherTotal;
  const tax = 0;
  return {
    labor,
    partsTotal,
    otherTotal,
    subtotal,
    tax,
    total: subtotal + tax,
  };
};

const normalizeId = (val: unknown) => {
  if (!val) return "";
  if (typeof val === "string") return val;
  if (typeof val === "number") return String(val);
  if (typeof val === "object" && (val as { toString?: () => string }).toString) {
    return (val as { toString: () => string }).toString();
  }
  return "";
};

const formatDateTime = (value?: string | number | Date) => {
  if (!value) return "Not set";
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZoneName: "short"
    }).format(new Date(value));
  } catch {
    return String(value);
  }
};

const getStatusMeta = (status?: string) => {
  const meta: Record<string, { color: "default" | "secondary" | "warning" | "success"; icon: ReactNode }> = {
    Scheduled: { color: "secondary", icon: <Clock4 className="h-3.5 w-3.5" aria-hidden /> },
    "In Progress": { color: "default", icon: <PlayCircle className="h-3.5 w-3.5" aria-hidden /> },
    "Waiting Parts": { color: "warning", icon: <Hourglass className="h-3.5 w-3.5" aria-hidden /> },
    Completed: { color: "success", icon: <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> },
    Closed: { color: "success", icon: <Lock className="h-3.5 w-3.5" aria-hidden /> }
  };
  return meta[status || ""] || { color: "secondary", icon: <PauseCircle className="h-3.5 w-3.5" aria-hidden /> };
};

const StatusBadge = ({ status }: { status?: string }) => {
  const meta = getStatusMeta(status);
  return (
    <Badge variant={meta.color} className="gap-1">
      {meta.icon}
      <span>{status || "Unknown"}</span>
    </Badge>
  );
};

const formatEmployeeName = (log: WorkOrderTimeLog) =>
  log.employeeName || log.employeeEmail || (log.employeeId ? `ID ${log.employeeId}` : "Unknown user");

export default function WorkOrderDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const qc = useQueryClient();
  const { session } = useAuth();
  const { show: showToast } = useToast();
  const workOrderId = Array.isArray(id) ? id[0] : id;
  const sessionUser = session?.user as { userId?: string; _id?: string; role?: string; permissions?: string[] } | undefined;
  const rawUserId = sessionUser?.userId || sessionUser?._id;
  const userId = useMemo(() => normalizeId(rawUserId), [rawUserId]);

  const perms = useMemo(() => {
    const p = sessionUser?.permissions || [];
    const role = sessionUser?.role;
    return {
      role,
      canReadAll: p.includes("WORKORDERS_READ_ALL"),
      canUpdateStatus: p.includes("WORKORDERS_UPDATE_STATUS"),
      canAssign:
        p.includes("WORKORDERS_ASSIGN_EMPLOYEE") ||
        role === "OWNER_ADMIN" ||
        role === "OPS_MANAGER" ||
        role === "SERVICE_ADVISOR",
      canIssue: p.includes("INVENTORY_ISSUE_TO_WORKORDER") && role !== "TECHNICIAN" && role !== "PAINTER",
      canAddNotes: p.includes("WORKORDERS_ADD_NOTES") && role !== "TECHNICIAN" && role !== "PAINTER",
      canReadAllLogs: p.includes("TIMELOGS_READ_ALL"),
      canReadSelfLogs: p.includes("TIMELOGS_READ_SELF"),
      canCreateLogs: p.includes("TIMELOGS_CREATE_SELF") || role === "TECHNICIAN" || role === "PAINTER",
    };
  }, [sessionUser]);

  const detail = useQuery<WorkOrderDetail>({
    queryKey: ["work-order-detail", id],
    queryFn: async () => (await api.get(`/work-orders/${id}/detail`)).data,
  });

  const isTechOrPainter =
    perms.role === "TECHNICIAN" || perms.role === "PAINTER";
  const isServiceAdvisor = perms.role === "SERVICE_ADVISOR";
  const statusOptions = ["Scheduled", "In Progress", "Waiting Parts", "Completed", "Closed"];

  const statusMutation = useMutation({
    mutationFn: (status: string) =>
      api.patch(`/work-orders/${id}/status`, { status }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["work-order-detail", id] }),
  });

  const issueMutation = useMutation({
    mutationFn: (payload: { partId: string; qty: number }) =>
      api.post(`/work-orders/${id}/issue-part`, payload),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["work-order-detail", id] }),
  });

  const clockIn = useMutation({
    mutationFn: () => api.post(`/work-orders/${id}/time-logs/clock-in`, {}),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["work-order-detail", id] }),
  });
  const clockOut = useMutation({
    mutationFn: () => api.post(`/work-orders/${id}/time-logs/clock-out`, {}),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["work-order-detail", id] }),
  });

  const noteMutation = useMutation({
    mutationFn: (message: string) =>
      api.post(`/work-orders/${id}/notes`, { message }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["work-order-detail", id] }),
  });

  const [note, setNote] = useState("");
  const [laborInput, setLaborInput] = useState("");
  const [chargeRows, setChargeRows] = useState<
    { name: string; amount: string }[]
  >([{ name: "", amount: "" }]);
  const [paymentMethod, setPaymentMethod] = useState("CASH");
  const [billingError, setBillingError] = useState("");
  const [laborError, setLaborError] = useState<string | null>(null);
  const [chargeErrors, setChargeErrors] = useState<Record<number, string>>({});
  const [selectedAssignees, setSelectedAssignees] = useState<string[]>([]);
  const [issueForm, setIssueForm] = useState({ partId: "", qty: 1 });
  const [partSearch, setPartSearch] = useState("");
  const debouncedPartSearch = useDebounce(partSearch, 250);
  const [partsSort, setPartsSort] = useState<"recent" | "qty" | "name">("recent");
  const [notesSort, setNotesSort] = useState<"recent" | "oldest">("recent");
  const [logsSort, setLogsSort] = useState<"recent" | "oldest" | "duration">("recent");
  const [logAssigneeFilter, setLogAssigneeFilter] = useState<"all" | "mine">("all");
  const [timeTick, setTimeTick] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setTimeTick((tick) => tick + 1), 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!perms.canReadAllLogs) {
      setLogAssigneeFilter("mine");
    }
  }, [perms.canReadAllLogs]);

  const canIssueHere = perms.canIssue && !isTechOrPainter;

  const partSearchQuery = useQuery<{ items?: PartSearchItem[] }>({
    queryKey: ["part-search", debouncedPartSearch],
    queryFn: async () =>
      (await api.get("/parts", { params: { search: debouncedPartSearch, limit: 20 } })).data,
    enabled: canIssueHere,
  });

  const assignableEmployees = useQuery<EmployeeLite[]>({
    queryKey: ["assignable-employees"],
    queryFn: async () =>
      (await api.get("/work-orders/assignable-employees")).data,
    enabled: perms.canAssign,
  });

  const assignMutation = useMutation({
    mutationFn: (payload: {
      assignedEmployees: { employeeId: string; roleType: string }[];
    }) => api.post(`/work-orders/${id}/assign`, payload),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["work-order-detail", id] }),
  });

  const billingMutation = useMutation({
    mutationFn: (payload: {
      billableLaborAmount: number;
      otherCharges: { name: string; amount: number }[];
      paymentMethod?: string;
    }) => api.patch(`/work-orders/${id}/billing`, payload),
    onSuccess: () => {
      setBillingError("");
      qc.invalidateQueries({ queryKey: ["work-order-detail", id] });
    },
  });

  const isAssignedToWorkOrder = detail.data?.isAssigned ?? false;
  const issueRestrictionText = !canIssueHere
    ? "Only Service Advisors or managers can issue parts for this work order."
    : "";

  useEffect(() => {
    if (detail.isError) {
      router.push("/work-orders");
    }
  }, [detail.isError, router]);

  useEffect(() => {
    if (!detail.data?.workOrder) return;
    const wo = detail.data.workOrder;
    setLaborInput(
      wo.billableLaborAmount !== null && wo.billableLaborAmount !== undefined
        ? String(wo.billableLaborAmount)
        : ""
    );
    const charges = (wo.otherCharges || []).map((c) => ({
      name: c?.name || "",
      amount: c?.amount !== undefined && c?.amount !== null ? String(c.amount) : "",
    }));
    setChargeRows(charges.length ? charges : [{ name: "", amount: "" }]);
    setSelectedAssignees(
      (detail.data.assignedEmployees || [])
        .map((a) => {
          const val = a?._id || a?.employeeId || a?.id;
          return val && val.toString ? val.toString() : val;
        })
        .filter((id): id is string => Boolean(id))
    );
  }, [detail.data?.workOrder, detail.data?.assignedEmployees]);

  const wo = detail.data?.workOrder;
  const partsUsed = useMemo(() => detail.data?.partsUsed ?? [], [detail.data?.partsUsed]);
  const timeLogs = useMemo(() => detail.data?.timeLogs ?? [], [detail.data?.timeLogs]);
  const assigned = useMemo(() => detail.data?.assignedEmployees ?? [], [detail.data?.assignedEmployees]);
  const notes = useMemo(() => wo?.notes ?? [], [wo?.notes]);
  const auditTrail = useMemo(() => detail.data?.auditTrail ?? [], [detail.data?.auditTrail]);

  const computeDurationMinutes = (log: WorkOrderTimeLog) => {
    if (log.durationMinutes && log.clockOutAt) return Number(log.durationMinutes) || 0;
    if (log.clockInAt && log.clockOutAt) {
      return Math.max(0, Math.round((new Date(log.clockOutAt).getTime() - new Date(log.clockInAt).getTime()) / 60000));
    }
    if (log.clockInAt && !log.clockOutAt) {
      return Math.max(0, Math.round((Date.now() - new Date(log.clockInAt).getTime()) / 60000));
    }
    return 0;
  };

  const effectiveLogFilter = perms.canReadAllLogs ? logAssigneeFilter : "mine";
  const logFilterOptions = perms.canReadAllLogs
    ? [
        { value: "all", label: "All users" },
        { value: "mine", label: "My logs" }
      ]
    : [{ value: "mine", label: "My logs" }];
  const filteredLogs = useMemo(
    () =>
      timeLogs.filter((log) =>
        effectiveLogFilter === "mine" && userId ? normalizeId(log.employeeId) === userId : true
      ),
    [timeLogs, effectiveLogFilter, userId]
  );

  const sortedTimeLogs = useMemo(() => {
    void timeTick;
    const list = [...filteredLogs];
    list.sort((a, b) => {
      if (logsSort === "duration") {
        return computeDurationMinutes(b) - computeDurationMinutes(a);
      }
      const aDate = new Date(a.clockInAt || 0).getTime();
      const bDate = new Date(b.clockInAt || 0).getTime();
      return logsSort === "oldest" ? aDate - bDate : bDate - aDate;
    });
    return list;
  }, [filteredLogs, logsSort, timeTick]);

  const activeLogs = sortedTimeLogs.filter((l) => !l.clockOutAt);
  const myActiveLog =
    ((detail.data?.activeLog && normalizeId(detail.data.activeLog.employeeId) === userId) ? detail.data.activeLog : null) ||
    activeLogs.find((l) => normalizeId(l.employeeId) === userId) ||
    null;

  const totalMinutes = useMemo(
    () => sortedTimeLogs.reduce((sum, log) => sum + computeDurationMinutes(log), 0),
    [sortedTimeLogs]
  );
  const runningMinutesAll = useMemo(
    () => activeLogs.reduce((sum, log) => sum + computeDurationMinutes(log), 0),
    [activeLogs]
  );

  const financials = detail.data?.financials || calculateFinancials(wo, partsUsed);
  const parseAmount = (val: string) => {
    if (val.trim() === "") return 0;
    const num = Number(val);
    return Number.isFinite(num) ? num : NaN;
  };
  const laborAmountDraft = (() => {
    const parsed = parseAmount(laborInput);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  })();
  const otherChargesDraft = chargeRows.reduce((sum, row) => {
    const parsed = parseAmount(row.amount);
    if (!Number.isFinite(parsed) || parsed < 0) return sum;
    return sum + parsed;
  }, 0);
  const partsTotal = Number(financials.partsTotal || 0);
  const taxPlaceholder = 0;
  const draftSubtotal = laborAmountDraft + partsTotal + otherChargesDraft;
  const draftGrandTotal = draftSubtotal + taxPlaceholder;
  const billingLocked = wo?.status !== "Completed";
  const billingDisabledReason = billingLocked ? "Complete work order first" : undefined;

  const partTimestamp = (part: WorkOrderPart) =>
    new Date(part.issuedAt || part.updatedAt || part.createdAt || 0).getTime();

  const sortedPartsUsed = useMemo(() => {
    const list = [...partsUsed];
    list.sort((a, b) => {
      if (partsSort === "qty") {
        return Number(b.qty || 0) - Number(a.qty || 0);
      }
      if (partsSort === "name") {
        return (a.partName || "").localeCompare(b.partName || "");
      }
      return partTimestamp(b) - partTimestamp(a);
    });
    return list;
  }, [partsSort, partsUsed]);

  const sortedNotes = useMemo(() => {
    const list = [...notes];
    list.sort((a, b) => {
      const aDate = new Date(a.createdAt || 0).getTime();
      const bDate = new Date(b.createdAt || 0).getTime();
      return notesSort === "oldest" ? aDate - bDate : bDate - aDate;
    });
    return list;
  }, [notes, notesSort]);

  const toggleAssignee = (empId: string) => {
    setSelectedAssignees((prev) =>
      prev.includes(empId)
        ? prev.filter((id) => id !== empId)
        : [...prev, empId]
    );
  };

  const handleAssignmentsSave = () => {
    if (!assignableEmployees.data) return;
    const payload = selectedAssignees
      .map((id: string) => {
        const match = (assignableEmployees.data || []).find((e) => e?._id === id);
        if (!match || !match._id) return null;
        return { employeeId: match._id, roleType: match.role || "TECHNICIAN" };
      })
      .filter((item): item is { employeeId: string; roleType: string } => Boolean(item));
    assignMutation.mutate({ assignedEmployees: payload });
  };

  const addChargeRow = () =>
    setChargeRows((rows) => [...rows, { name: "", amount: "" }]);
  const removeChargeRow = (idx: number) =>
    setChargeRows((rows) =>
      rows.length === 1 ? rows : rows.filter((_, i) => i !== idx)
    );

  const handleBillingSave = () => {
    if (billingLocked) {
      setBillingError("Complete work order first.");
      return;
    }
    setBillingError("");
    let nextLaborError: string | null = null;
    const nextChargeErrors: Record<number, string> = {};

    const laborVal = laborInput.trim() === "" ? 0 : Number(laborInput);
    if (!Number.isFinite(laborVal) || laborVal < 0) {
      nextLaborError = "Enter a valid non-negative labor amount.";
    }

    const normalizedCharges: { name: string; amount: number }[] = [];
    chargeRows.forEach((row, idx) => {
      const hasContent = row.name.trim() !== "" || row.amount.trim() !== "";
      if (!hasContent) return;
      const amount = Number(row.amount || 0);
      if (!Number.isFinite(amount) || amount < 0) {
        nextChargeErrors[idx] = "Enter a valid non-negative amount.";
        return;
      }
      normalizedCharges.push({ name: row.name.trim() || "Charge", amount });
    });

    const hasErrors = Boolean(nextLaborError) || Object.keys(nextChargeErrors).length > 0;
    setLaborError(nextLaborError);
    setChargeErrors(nextChargeErrors);
    if (hasErrors) return;

    billingMutation.mutate(
      {
        billableLaborAmount: laborVal,
        otherCharges: normalizedCharges,
        paymentMethod,
      },
      {
        onSuccess: () => {
          showToast({
            title: "Billing updated",
            description: (
              <a className="underline" href={`/work-orders/${workOrderId}`}>
                View updated work order
              </a>
            ),
            variant: "success"
          });
        }
      }
    );
  };

  if (detail.isLoading) {
    return (
      <Shell>
        <div className="glass p-6 rounded-xl text-center text-muted-foreground">
          Loading work order...
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between mb-6">
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Work Order</p>
          <h1 className="text-xl font-semibold text-foreground">{wo?._id}</h1>
          <p className="text-muted-foreground text-sm">
            {wo?.complaint || "General service"}
          </p>
          {(detail.data?.audit?.createdBy || detail.data?.audit?.billedBy) && (
            <div className="text-xs text-muted-foreground space-y-1">
              {detail.data?.audit?.createdBy && (
                <p>
                  Created by: {detail.data.audit.createdBy.name || "Unknown"}
                  {detail.data.audit.createdBy.role ? ` (${detail.data.audit.createdBy.role})` : ""}
                  {detail.data.audit.createdBy.at ? ` | ${formatDateTime(detail.data.audit.createdBy.at)}` : ""}
                </p>
              )}
              {detail.data?.audit?.billedBy && (
                <p>
                  Billed by: {detail.data.audit.billedBy.name || "Unknown"}
                  {detail.data.audit.billedBy.role ? ` (${detail.data.audit.billedBy.role})` : ""}
                  {detail.data.audit.billedBy.at ? ` | ${formatDateTime(detail.data.audit.billedBy.at)}` : ""}
                </p>
              )}
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3 justify-start xl:justify-end">
          <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 min-w-[220px]">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Total
            </p>
            <p className="text-xl font-semibold text-foreground">
              Tk. {formatMoney(financials.total)}
            </p>
            <p className="text-[11px] text-muted-foreground">
              Labor Tk. {formatMoney(financials.labor)} | Parts Tk.{" "}
              {formatMoney(financials.partsTotal)} | Other Tk.{" "}
              {formatMoney(financials.otherTotal)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={wo?.status} />
            <div className="flex flex-wrap gap-2">
              {statusOptions.map((s) => {
                const disabled = statusMutation.isPending || !perms.canUpdateStatus;
                return (
                  <button
                    key={s}
                    onClick={() => statusMutation.mutate(s)}
                    className="text-xs px-2 py-1 rounded bg-muted hover:bg-border disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                    disabled={disabled}
                    title={
                      !perms.canUpdateStatus
                        ? "You do not have permission to update status."
                        : undefined
                    }
                  >
                    {statusMutation.isPending ? "Updating..." : s}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="glass p-4 rounded-xl space-y-3 lg:col-span-2">
          <div className="flex flex-wrap gap-3 text-sm text-white/70">
            <div>
              <p className="text-foreground font-semibold">Customer</p>
              <p>{detail.data?.customer?.name}</p>
              <p className="text-white/60">{detail.data?.customer?.phone}</p>
              {detail.data?.customer?.email && (
                <p className="text-white/60">{detail.data.customer.email}</p>
              )}
            </div>
            <div>
              <p className="text-foreground font-semibold">Vehicle</p>
              <p>
                {detail.data?.vehicle?.make} {detail.data?.vehicle?.model}{" "}
                {detail.data?.vehicle?.year || ""}
              </p>
              <p className="text-white/60">
                Plate: {detail.data?.vehicle?.plate || "--"}
              </p>
              <p className="text-white/60">
                VIN: {detail.data?.vehicle?.vin || "--"}
              </p>
            </div>
            <div>
              <p className="text-foreground font-semibold">Assigned</p>
              <div className="text-white/60">
                {assigned.length === 0 && "Unassigned"}
                {assigned.map((a) => (
                  <p key={a._id || a.email}>
                    {a.name || a.email} | {a.role}
                  </p>
                ))}
              </div>
            </div>
            {detail.data?.invoice && (
              <div>
                <p className="text-foreground font-semibold">Invoice</p>
                <p className="text-white/60">
                  {detail.data.invoice.invoiceNumber}
                </p>
                <p className="text-white/60">
                  Status: {detail.data.invoice.status}
                </p>
              </div>
            )}
            {(auditTrail.length > 0 ||
              detail.data?.audit?.createdBy ||
              detail.data?.audit?.billedBy ||
              detail.data?.audit?.billingUpdatedBy) && (
              <div>
                <p className="text-foreground font-semibold">Activity</p>
                {auditTrail.length > 0 ? (
                  <div className="space-y-1 text-white/60">
                    {auditTrail.map((entry, idx) => {
                      const actorName = entry.by?.name || "Unknown";
                      const actorRole = entry.by?.role ? ` (${entry.by.role})` : "";
                      const actorTime = entry.by?.at ? ` | ${formatDateTime(entry.by.at)}` : "";
                      if (entry.actionType === "WORK_ORDER_CREATED") {
                        return (
                          <p key={`${entry.actionType}-${idx}`}>
                            Intake: {actorName}{actorRole}{actorTime}
                          </p>
                        );
                      }
                      if (entry.actionType === "WORK_ORDER_BILLING_UPDATE") {
                        return (
                          <p key={`${entry.actionType}-${idx}`}>
                            Billing update: {actorName}{actorRole}{actorTime}
                          </p>
                        );
                      }
                      if (entry.actionType === "WORK_ORDER_BILLING_SUBMIT") {
                        return (
                          <p key={`${entry.actionType}-${idx}`}>
                            Billing submitted: {actorName}{actorRole}{actorTime}
                          </p>
                        );
                      }
                      if (entry.actionType === "WORK_ORDER_ASSIGN") {
                        const assignees =
                          entry.assignees?.length
                            ? entry.assignees
                                .map((assignee) => {
                                  const roleLabel = assignee.roleType || assignee.role;
                                  return `${assignee.name || assignee.id}${roleLabel ? ` (${roleLabel})` : ""}`;
                                })
                                .join(", ")
                            : "None";
                        const assignmentLabel = entry.autoAssigned ? "Self-assigned" : "Assignment";
                        return (
                          <p key={`${entry.actionType}-${idx}`}>
                            {assignmentLabel}: {assignees} | By {actorName}{actorRole}{actorTime}
                          </p>
                        );
                      }
                      return null;
                    })}
                  </div>
                ) : (
                  <>
                    {detail.data?.audit?.createdBy && (
                      <p className="text-white/60">
                        Intake: {detail.data.audit.createdBy.name || "Unknown"}{" "}
                        {detail.data.audit.createdBy.role ? `(${detail.data.audit.createdBy.role})` : ""}
                        {detail.data.audit.createdBy.at ? ` | ${formatDateTime(detail.data.audit.createdBy.at)}` : ""}
                      </p>
                    )}
                    {detail.data?.audit?.billingUpdatedBy && (
                      <p className="text-white/60">
                        Billing update: {detail.data.audit.billingUpdatedBy.name || "Unknown"}{" "}
                        {detail.data.audit.billingUpdatedBy.role ? `(${detail.data.audit.billingUpdatedBy.role})` : ""}
                        {detail.data.audit.billingUpdatedBy.at ? ` | ${formatDateTime(detail.data.audit.billingUpdatedBy.at)}` : ""}
                      </p>
                    )}
                    {detail.data?.audit?.billedBy && (
                      <p className="text-white/60">
                        Billing submitted: {detail.data.audit.billedBy.name || "Unknown"}{" "}
                        {detail.data.audit.billedBy.role ? `(${detail.data.audit.billedBy.role})` : ""}
                        {detail.data.audit.billedBy.at ? ` | ${formatDateTime(detail.data.audit.billedBy.at)}` : ""}
                      </p>
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          <div className="mt-4">
            <div className="flex items-center justify-between gap-2 mb-2">
              <p className="font-semibold text-foreground">Parts Used</p>
              <label className="text-xs text-muted-foreground flex items-center gap-1">
                <span>Sort</span>
                <select
                  value={partsSort}
                  onChange={(e) => setPartsSort(e.target.value as typeof partsSort)}
                  className="rounded border border-border bg-card px-2 py-1 text-foreground text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                >
                  <option value="recent">Recent</option>
                  <option value="qty">Qty</option>
                  <option value="name">Name</option>
                </select>
              </label>
            </div>
            <div className="space-y-2">
              {sortedPartsUsed.map((p) => {
                const issuedTime = p.issuedAt || p.updatedAt || p.createdAt;
                return (
                  <div
                    key={p.partId}
                    className="flex items-center justify-between bg-card rounded-lg border border-border px-3 py-2"
                  >
                    <div>
                      <p className="font-semibold text-foreground">
                        {p.partName || p.partId}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        SKU {p.sku || "--"} | Qty {p.qty}
                      </p>
                      {issuedTime && (
                        <p className="text-[11px] text-muted-foreground">
                          Issued {formatDateTime(issuedTime)}
                        </p>
                      )}
                    </div>
                    <div className="text-right text-xs text-muted-foreground">
                      <p>Selling: Tk. {formatMoney(p.sellingPriceAtTime)}</p>
                      <p>Cost: Tk. {formatMoney(p.costAtTime)}</p>
                    </div>
                  </div>
                );
              })}
              {sortedPartsUsed.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No parts issued yet.
                </p>
              )}
            </div>
          </div>

          <div className="mt-4 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold text-foreground">Time Logs</p>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <SegmentedControl
                  aria-label="Time log filter"
                  options={logFilterOptions}
                  value={effectiveLogFilter}
                  onChange={(val) => setLogAssigneeFilter(val as typeof logAssigneeFilter)}
                />
                <label className="flex items-center gap-1">
                  <span>Sort</span>
                  <select
                    value={logsSort}
                    onChange={(e) => setLogsSort(e.target.value as typeof logsSort)}
                    className="rounded border border-border bg-card px-2 py-1 text-foreground text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                  >
                    <option value="recent">Recent</option>
                    <option value="oldest">Oldest</option>
                    <option value="duration">Duration</option>
                  </select>
                </label>
              </div>
            </div>

            {myActiveLog && (
              <div className="rounded-lg border border-green-500/40 bg-green-900/10 px-3 py-2 text-sm text-foreground">
                You are clocked in. Started at {formatDateTime(myActiveLog.clockInAt)}.
              </div>
            )}

            <div className="flex items-center gap-2 mb-2 text-sm flex-wrap">
              <span>
                Total: {(totalMinutes / 60).toFixed(1)}h ({totalMinutes} min) -{" "}
                {effectiveLogFilter === "all" ? "all users" : "your logs"}
              </span>
              <>
                <button
                  onClick={() => clockIn.mutate()}
                  className="px-3 py-1 rounded bg-muted hover:bg-border text-xs disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                  disabled={clockIn.isPending || !!myActiveLog || !perms.canCreateLogs}
                  title={
                    !perms.canCreateLogs
                      ? "You do not have permission to clock in."
                      : myActiveLog
                        ? "Already clocked in."
                        : undefined
                  }
                >
                  {clockIn.isPending ? "Clocking..." : "Clock in"}
                </button>
                <button
                  onClick={() => clockOut.mutate()}
                  className="px-3 py-1 rounded bg-primary text-xs disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                  disabled={clockOut.isPending || !myActiveLog || !perms.canCreateLogs}
                  title={
                    !perms.canCreateLogs
                      ? "You do not have permission to clock out."
                      : !myActiveLog
                        ? "Not clocked in."
                        : undefined
                  }
                >
                  {clockOut.isPending ? "Clocking..." : "Clock out"}
                </button>
              </>
              {activeLogs.length > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-green-500/15 px-2 py-0.5 text-[11px] text-green-200">
                  Running {runningMinutesAll} min
                </span>
              )}
            </div>
            <div className="space-y-2">
              {sortedTimeLogs.map((l) => {
                const isRunning = !l.clockOutAt;
                const duration = computeDurationMinutes(l);
                const started = formatDateTime(l.clockInAt);
                const ended = l.clockOutAt ? formatDateTime(l.clockOutAt) : "In progress";
                const actor = formatEmployeeName(l);
                return (
                  <div
                    key={l._id}
                    className="bg-card rounded-lg border border-border px-3 py-2 text-xs space-y-1"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-foreground">
                        <p className="font-semibold">{actor}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {started} {"->"} {ended}
                        </p>
                      </div>
                      <div className="text-right text-muted-foreground flex items-center gap-2">
                        <span>Duration: {duration} min</span>
                        {isRunning && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-green-500/40 bg-green-500/10 px-2 py-0.5 text-[11px] text-green-200">
                            <Clock4 className="h-3 w-3" aria-hidden />
                            Running
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              {sortedTimeLogs.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No time logs yet.
                </p>
              )}
            </div>
          </div>

          <div className="mt-4">
            <div className="flex items-center justify-between gap-2 mb-2">
              <p className="font-semibold text-foreground">Notes</p>
              <label className="text-xs text-muted-foreground flex items-center gap-1">
                <span>Sort</span>
                <select
                  value={notesSort}
                  onChange={(e) => setNotesSort(e.target.value as typeof notesSort)}
                  className="rounded border border-border bg-card px-2 py-1 text-foreground text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                >
                  <option value="recent">Recent</option>
                  <option value="oldest">Oldest</option>
                </select>
              </label>
            </div>
            <div className="space-y-2">
              {sortedNotes.map((n, idx) => (
                <div
                  key={idx}
                  className="bg-card rounded-lg border border-border px-3 py-2 text-sm text-foreground"
                >
                  <p>{n.message}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDateTime(n.createdAt)}
                  </p>
                </div>
              ))}
              {sortedNotes.length === 0 && (
                <p className="text-sm text-muted-foreground">No notes yet.</p>
              )}
            </div>
            <div className="mt-2 flex gap-2">
              <input
                placeholder="Add a note..."
                value={note}
                onChange={(e) => setNote(e.target.value)}
                disabled={!perms.canAddNotes}
                title={
                  perms.canAddNotes ? undefined : "You do not have permission to add notes."
                }
                className="flex-1 bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground disabled:opacity-60"
              />
              <button
                onClick={() => {
                  if (!note.trim()) return;
                  noteMutation.mutate(note);
                  setNote("");
                }}
                disabled={!perms.canAddNotes}
                title={
                  perms.canAddNotes ? undefined : "You do not have permission to add notes."
                }
                className="px-3 py-2 rounded-lg bg-primary text-sm text-foreground disabled:opacity-60"
              >
                Add
              </button>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          {/* TECHNICIAN/PAINTER VIEW: Only show Clock In/Out and Issue Parts */}
          {isTechOrPainter && (
            <div className="glass p-4 rounded-xl space-y-3">
              <p className="font-semibold text-foreground text-center">
                Technician Dashboard
              </p>
              <div className="flex flex-col gap-2">
                <div>
                  <p className="text-xs text-muted-foreground mb-2">
                    Time tracking
                  </p>
                  <div className="flex gap-2">
                    {!myActiveLog ? (
                      <button
                        onClick={() => clockIn.mutate()}
                        className="flex-1 px-3 py-2 rounded bg-primary hover:bg-primary/80 text-foreground font-semibold disabled:opacity-60"
                        disabled={clockIn.isPending || !!myActiveLog || !perms.canCreateLogs}
                        title={
                          !perms.canCreateLogs
                            ? "You do not have permission to clock in."
                            : myActiveLog
                              ? "Already clocked in."
                              : undefined
                        }
                      >
                        {clockIn.isPending ? "Clocking in..." : "Clock In"}
                      </button>
                    ) : (
                      <button
                        onClick={() => clockOut.mutate()}
                        className="flex-1 px-3 py-2 rounded bg-green-600 hover:bg-green-700 text-foreground font-semibold disabled:opacity-60"
                        disabled={clockOut.isPending || !perms.canCreateLogs}
                        title={
                          !perms.canCreateLogs
                            ? "You do not have permission to clock out."
                            : undefined
                        }
                      >
                        {clockOut.isPending ? "Clocking out..." : "Clock Out"}
                      </button>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Total time: {(totalMinutes / 60).toFixed(1)}h ({totalMinutes} min) -{" "}
                    {effectiveLogFilter === "all" ? "All users" : "Your logs"}
                    {activeLogs.length > 0 && (
                      <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-green-500/20 px-2 py-0.5 text-[11px] text-green-200">
                        Running {runningMinutesAll} min
                      </span>
                    )}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-2">Status</p>
                  <StatusBadge status={wo?.status} />
                </div>
              </div>
            </div>
          )}

          {/* SERVICE ADVISOR VIEW: Show full billing and payment section */}
          {!isTechOrPainter && (
            <div className="glass p-4 rounded-xl space-y-3">
              <div className="flex items-center justify-between gap-2">
                <p className="font-semibold text-foreground">
                  Billing & Charges
                </p>
                <span className="text-xs text-muted-foreground">
                  Draft total Tk. {formatMoney(draftGrandTotal)}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {wo?.status === "Completed"
                  ? "Submit billing to close the work order and invoice."
                  : "Complete the work order first to enable billing submission."}
              </p>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Payment method</p>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  disabled={billingLocked || billingMutation.isPending}
                  title={billingDisabledReason}
                  className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                >
                  <option value="CASH">Cash</option>
                  <option value="CARD">Card</option>
                  <option value="BANK_TRANSFER">Bank transfer</option>
                </select>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">
                  Labor (billable)
                </p>
                <CurrencyInput
                  value={laborInput}
                  onChange={(val) => {
                    setLaborInput(val);
                    setLaborError(null);
                  }}
                  placeholder="0"
                  allowEmpty
                  min={0}
                  disabled={billingLocked || billingMutation.isPending}
                  title={billingDisabledReason}
                />
                {laborError && <p className="text-[11px] text-red-400">{laborError}</p>}
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-foreground">
                    Other charges
                  </p>
                  <button
                    type="button"
                    onClick={addChargeRow}
                    disabled={billingLocked || billingMutation.isPending}
                    title={billingDisabledReason}
                    className="text-xs text-accent underline"
                  >
                    Add
                  </button>
                </div>
                {chargeRows.map((row, idx) => (
                  <div
                    key={`${idx}-${row.name}`}
                    className="grid grid-cols-8 gap-2 items-center"
                  >
                    <input
                      value={row.name}
                      onChange={(e) => {
                        const value = e.target.value;
                        setChargeRows((rows) =>
                          rows.map((r, i) =>
                            i === idx ? { ...r, name: value } : r
                          )
                        );
                      }}
                      placeholder="Shop supplies"
                      className="col-span-3 bg-muted border border-border rounded-lg px-3 py-2 w-full text-foreground text-sm disabled:opacity-60"
                      disabled={billingLocked || billingMutation.isPending}
                      title={billingDisabledReason}
                    />
                    <div className="col-span-3">
                      <CurrencyInput
                        value={row.amount}
                        onChange={(val) => {
                          setChargeRows((rows) =>
                            rows.map((r, i) =>
                              i === idx ? { ...r, amount: val } : r
                            )
                          );
                          setChargeErrors((prev) => {
                            const next = { ...prev };
                            delete next[idx];
                            return next;
                          });
                        }}
                        placeholder="0"
                        allowEmpty
                        min={0}
                        disabled={billingLocked || billingMutation.isPending}
                        title={billingDisabledReason}
                      />
                      {chargeErrors[idx] && (
                        <p className="text-[11px] text-red-400 mt-1">{chargeErrors[idx]}</p>
                      )}
                    </div>
                    <div className="text-[11px] text-muted-foreground text-right">
                      Line total Tk. {formatMoney(parseAmount(row.amount))}
                    </div>
                    <button
                      type="button"
                      onClick={() => removeChargeRow(idx)}
                      disabled={chargeRows.length === 1 || billingLocked || billingMutation.isPending}
                      title={billingDisabledReason}
                      className="text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-40"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
              {billingError && (
                <p className="text-xs text-red-400">{billingError}</p>
              )}
              <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground space-y-1">
                <p>Labor Tk. {formatMoney(laborAmountDraft)}</p>
                <p>Parts Tk. {formatMoney(partsTotal)}</p>
                <p>Other Tk. {formatMoney(otherChargesDraft)}</p>
                <p>Tax (placeholder) Tk. {formatMoney(taxPlaceholder)}</p>
                <p className="text-foreground font-semibold">
                  Total Tk. {formatMoney(draftGrandTotal)}
                </p>
              </div>
              <button
                onClick={handleBillingSave}
                disabled={billingMutation.isPending || billingLocked}
                title={billingDisabledReason}
                className="w-full py-2 rounded-lg bg-muted font-semibold text-foreground disabled:opacity-50 hover:bg-border focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
              >
                {billingMutation.isPending
                  ? wo?.status === "Completed"
                    ? "Submitting..."
                    : "Saving..."
                  : "Submit billing & close"}
              </button>
              {billingLocked && (
                <p className="text-[11px] text-muted-foreground">
                  Complete the work order to enable billing submission.
                </p>
              )}
              {wo?.status === "Closed" && (
                <div className="w-full py-2 rounded-lg bg-muted text-center font-semibold text-green-400">
                  Work order closed & paid
                </div>
              )}
            </div>
          )}

          {perms.canAssign && !isTechOrPainter && (
            <div className="glass p-4 rounded-xl space-y-3">
              <div className="flex items-center justify-between gap-2">
                <p className="font-semibold text-foreground">Assignments</p>
                <span className="text-xs text-muted-foreground">
                  {assignMutation.isPending
                    ? "Updating..."
                    : `${selectedAssignees.length} selected`}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Choose technicians or painters for this job.
              </p>
              {assignableEmployees.isLoading && (
                <p className="text-sm text-muted-foreground">Loading team...</p>
              )}
              {assignableEmployees.isError && (
                <p className="text-sm text-red-400">
                  Unable to load team list.
                </p>
              )}
              {assignableEmployees.data && (
                <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                  {(assignableEmployees.data || []).map((emp) => {
                    const empId = emp._id ?? "";
                    const isChecked = empId ? selectedAssignees.includes(empId) : false;
                    return (
                      <label
                        key={emp._id}
                        className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm"
                      >
                        <div>
                          <p className="font-semibold text-foreground">
                            {emp.name || emp.email}
                          </p>
                          <p className="text-[11px] text-muted-foreground uppercase">
                            {emp.role}
                          </p>
                        </div>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => empId && toggleAssignee(empId)}
                          className="h-4 w-4 accent-primary"
                        />
                      </label>
                    );
                  })}
                </div>
              )}
              <button
                onClick={handleAssignmentsSave}
                disabled={
                  assignMutation.isPending || assignableEmployees.isLoading
                }
                className="w-full py-2 rounded-lg bg-muted text-sm font-semibold text-foreground hover:bg-border disabled:opacity-50"
              >
                {assignMutation.isPending ? "Saving..." : "Update assignments"}
              </button>
            </div>
          )}

          {!isTechOrPainter && (
            <div className="glass p-4 rounded-xl space-y-3">
              <div className="flex items-center justify-between">
                <p className="font-semibold text-foreground">Issue Part</p>
                {issueMutation.isPending && (
                  <span className="text-xs text-muted-foreground">
                    Posting...
                  </span>
                )}
              </div>
              {issueRestrictionText && (
                <p className="text-xs text-muted-foreground">
                  {issueRestrictionText}
                </p>
              )}
              <input
                disabled={!canIssueHere}
                placeholder="Search name, SKU, barcode"
                value={partSearch}
                onChange={(e) => setPartSearch(e.target.value)}
                title={issueRestrictionText || undefined}
                className="bg-muted border border-border rounded-lg px-3 py-2 w-full text-foreground disabled:opacity-60"
              />
              <select
                disabled={!canIssueHere}
                value={issueForm.partId}
                onChange={(e) =>
                  setIssueForm({ ...issueForm, partId: e.target.value })
                }
                title={issueRestrictionText || undefined}
                className="bg-muted border border-border rounded-lg px-3 py-2 w-full text-foreground disabled:opacity-60"
              >
                <option value="">Select part</option>
                {(partSearchQuery.data?.items || []).map((p) => (
                  <option key={p._id} value={p._id}>
                    {p.partName} | {p.sku} | On hand {p.onHandQty ?? 0}
                  </option>
                ))}
              </select>
              <input
                disabled={!canIssueHere}
                type="number"
                min={1}
                placeholder="Qty"
                value={issueForm.qty}
                onChange={(e) =>
                  setIssueForm({ ...issueForm, qty: Number(e.target.value) })
                }
                title={issueRestrictionText || undefined}
                className="bg-muted border border-border rounded-lg px-3 py-2 w-full text-foreground disabled:opacity-60"
              />
              <button
                disabled={
                  !canIssueHere ||
                  issueMutation.isPending ||
                  !issueForm.partId ||
                  issueForm.qty <= 0
                }
                onClick={() =>
                  issueForm.partId && issueMutation.mutate(issueForm)
                }
                title={issueRestrictionText || undefined}
                className="w-full py-2 rounded-lg bg-primary font-semibold text-foreground disabled:opacity-50"
              >
                {issueMutation.isPending ? "Issuing..." : "Issue to WO"}
              </button>
            </div>
          )}

          <div className="glass p-4 rounded-xl space-y-3">
            <p className="font-semibold text-foreground">Tech View</p>
            <div className="flex items-center gap-2">
              <p className="text-sm text-muted-foreground">Status:</p>
              <StatusBadge status={wo?.status} />
            </div>
            {myActiveLog ? (
              <p className="text-sm text-muted-foreground">
                You are clocked in since{" "}
                {formatDateTime(myActiveLog.clockInAt)}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">Not clocked in</p>
            )}
            <Link href="/inventory" className="text-sm text-accent underline">
              View inventory
            </Link>
          </div>
        </div>
      </div>
    </Shell>
  );
}



