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
import { Input } from "../../../components/ui/input";
import { Dialog } from "../../../components/ui/dialog";
import { Textarea } from "../../../components/ui/textarea";
import { Table, THead, TBody, TR, TH, TD } from "../../../components/ui/table";
import {
  AlertCircle,
  Clock4,
  Lock,
  PauseCircle,
  PlayCircle,
  XCircle
} from "lucide-react";
import { useToast } from "../../../components/ui/toast";
import { useDebounce } from "../../../lib/use-debounce";
import { PageHeader } from "../../../components/page-header";
import { PageToolbar, PageToolbarSection } from "../../../components/page-toolbar";

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

type WorkOrderService = {
  serviceId: string;
  nameAtTime?: string;
  qty?: number;
  unitPriceAtTime?: number;
  unitCostAtTime?: number;
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
    workOrderNumber?: string;
    complaint?: string;
    reference?: string;
    status?: string;
    dateIn?: string;
    isHistorical?: boolean;
    historicalSource?: string;
    createdAt?: string;
    updatedAt?: string;
    deliveredAt?: string | null;
    notes?: WorkOrderNote[];
    billableLaborAmount?: number;
    advanceAmount?: number;
    advanceAppliedAmount?: number;
    servicesUsed?: WorkOrderService[];
    otherCharges?: { name?: string; amount?: number; costAtTime?: number }[];
  };
  assignedEmployees?: { _id?: string; employeeId?: string; id?: string; name?: string; email?: string; role?: string }[];
  invoice?: {
    _id?: string;
    invoiceNumber?: string;
    status?: string;
    total?: number;
    totalPaid?: number;
    outstandingAmount?: number;
    issuedAt?: string;
  };
  payments?: {
    _id?: string;
    method?: string;
    amount?: number;
    paidAt?: string;
    note?: string;
  }[];
  partsUsed?: WorkOrderPart[];
  servicesUsed?: WorkOrderService[];
  timeLogs?: WorkOrderTimeLog[];
  isAssigned?: boolean;
  activeLog?: WorkOrderTimeLog | null;
  runningMinutes?: number;
  totalMinutes?: number;
  financials?: {
    labor?: number;
    partsTotal?: number;
    servicesTotal?: number;
    otherTotal?: number;
    subtotal?: number;
    tax?: number;
    total?: number;
    advanceReceived?: number;
    advanceApplied?: number;
    amountDue?: number;
    totalPaid?: number;
    outstandingAmount?: number;
    overpayment?: number;
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
  visitSummary?: {
    vehicleVisitCount?: number;
    vehicleFirstVisit?: string;
    vehicleLastVisit?: string;
    customerVisitCount?: number;
    customerDistinctVehicles?: number;
  };
};

type EmployeeLite = { _id?: string; name?: string; email?: string; role?: string; employeeId?: string; id?: string };
type PartSearchItem = { _id: string; partName?: string; sku?: string; onHandQty?: number };
type ServiceCatalogItem = {
  _id: string;
  name: string;
  code: string;
  category?: string;
  defaultPrice?: number;
  defaultCost?: number;
  isActive?: boolean;
};

const formatMoney = (val: unknown) => {
  if (val === null || val === undefined) return "--";
  const num = toNumeric(val);
  return Number.isFinite(num) ? num.toFixed(2) : "--";
};

const toNumeric = (val: unknown) => {
  if (val === null || val === undefined) return 0;
  if (typeof val === "number") return Number.isFinite(val) ? val : 0;
  if (typeof val === "string") {
    const parsed = Number(val);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (
    typeof val === "object" &&
    val !== null &&
    "$numberDecimal" in (val as Record<string, unknown>)
  ) {
    const parsed = Number((val as { $numberDecimal?: string }).$numberDecimal || 0);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (typeof val === "object" && "toString" in val) {
    const parsed = Number((val as { toString: () => string }).toString());
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

const calculateFinancials = (
  workOrder?: WorkOrderDetail["workOrder"],
  partsUsed: WorkOrderPart[] = [],
  servicesUsed: WorkOrderService[] = []
) => {
  const labor = Number(workOrder?.billableLaborAmount || 0);
  const partsTotal = partsUsed.reduce((sum, part) => {
    const qty = Number(part.qty) || 0;
    const priceEach = Number(part.sellingPriceAtTime || 0);
    return sum + qty * priceEach;
  }, 0);
  const servicesTotal = servicesUsed.reduce((sum, service) => {
    const qty = Number(service.qty) || 0;
    const priceEach = Number(service.unitPriceAtTime || 0);
    return sum + qty * priceEach;
  }, 0);
  const otherTotal = (workOrder?.otherCharges || []).reduce((sum: number, charge) => sum + Number(charge?.amount || 0), 0);
  const subtotal = labor + partsTotal + servicesTotal + otherTotal;
  const tax = 0;
  const total = subtotal + tax;
  const advanceReceived = Number(workOrder?.advanceAmount || 0);
  const advanceAppliedStored = Number(workOrder?.advanceAppliedAmount || 0);
  const advanceApplied = Math.min(
    Math.max(0, advanceAppliedStored),
    Math.max(0, advanceReceived),
    total
  );
  return {
    labor,
    partsTotal,
    servicesTotal,
    otherTotal,
    subtotal,
    tax,
    total,
    advanceReceived,
    advanceApplied,
    amountDue: Math.max(total - advanceApplied, 0),
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
    Closed: { color: "success", icon: <Lock className="h-3.5 w-3.5" aria-hidden /> },
    Canceled: { color: "warning", icon: <XCircle className="h-3.5 w-3.5" aria-hidden /> }
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
    return {
      role: sessionUser?.role,
      canReadAll: p.includes("WORKORDERS_READ_ALL"),
      canUpdateStatus: p.includes("WORKORDERS_UPDATE_STATUS"),
      canAssign: p.includes("WORKORDERS_ASSIGN_EMPLOYEE"),
      canIssue: p.includes("INVENTORY_ISSUE_TO_WORKORDER"),
      canAddNotes: p.includes("WORKORDERS_ADD_NOTES"),
      canEditBilling: p.includes("WORKORDERS_BILLING_EDIT"),
      canCreateInvoice: p.includes("INVOICES_CREATE"),
      canTakePayment: p.includes("PAYMENTS_CREATE") || p.includes("INVOICES_CLOSE"),
      canReadServices: p.includes("SERVICES_READ"),
      canReadAllLogs: p.includes("TIMELOGS_READ_ALL"),
      canReadSelfLogs: p.includes("TIMELOGS_READ_SELF"),
      canCreateLogs: p.includes("TIMELOGS_CREATE_SELF"),
    };
  }, [sessionUser]);

  const detail = useQuery<WorkOrderDetail>({
    queryKey: ["work-order-detail", id],
    queryFn: async () => (await api.get(`/work-orders/${id}/detail`)).data,
  });

  const canEditBilling = perms.canEditBilling;
  const [activeSection, setActiveSection] = useState<
    "overview" | "billing" | "payments" | "activity" | "inventory"
  >("overview");

  const statusMutation = useMutation({
    mutationFn: (payload: { status: string; note?: string }) =>
      api.patch(`/work-orders/${id}/status`, payload),
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
    { name: string; amount: string; costAtTime: string }[]
  >([{ name: "", amount: "", costAtTime: "" }]);
  const [serviceRows, setServiceRows] = useState<
    { serviceId: string; qty: string; unitPriceAtTime: string; unitCostAtTime: string; nameAtTime: string }[]
  >([]);
  const [paymentMethod, setPaymentMethod] = useState("CASH");
  const [paymentAmountInput, setPaymentAmountInput] = useState("");
  const [workOrderNumberInput, setWorkOrderNumberInput] = useState("");
  const [billingError, setBillingError] = useState("");
  const [laborError, setLaborError] = useState<string | null>(null);
  const [chargeErrors, setChargeErrors] = useState<Record<number, string>>({});
  const [serviceErrors, setServiceErrors] = useState<Record<number, string>>({});
  const [selectedAssignees, setSelectedAssignees] = useState<string[]>([]);
  const [issueForm, setIssueForm] = useState({ partId: "", qty: 1 });
  const [partSearch, setPartSearch] = useState("");
  const debouncedPartSearch = useDebounce(partSearch, 250);
  const [partsSort, setPartsSort] = useState<"recent" | "qty" | "name">("recent");
  const [notesSort, setNotesSort] = useState<"recent" | "oldest">("recent");
  const [logsSort, setLogsSort] = useState<"recent" | "oldest" | "duration">("recent");
  const [logAssigneeFilter, setLogAssigneeFilter] = useState<"all" | "mine">("all");
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancelNote, setCancelNote] = useState("");
  const [cancelError, setCancelError] = useState("");
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

  const canIssueHere = perms.canIssue;
  const canOverrideClosedBilling = perms.role === "OWNER_ADMIN";

  const partSearchQuery = useQuery<{ items?: PartSearchItem[] }>({
    queryKey: ["part-search", debouncedPartSearch],
    queryFn: async () =>
      (await api.get("/parts", { params: { search: debouncedPartSearch, limit: 20 } })).data,
    enabled: canIssueHere,
  });

  const servicesCatalogQuery = useQuery<ServiceCatalogItem[]>({
    queryKey: ["service-catalog", "active"],
    queryFn: async () =>
      (await api.get("/services", { params: { activeOnly: true } })).data as ServiceCatalogItem[],
    enabled: perms.canReadServices && canEditBilling,
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
      otherCharges: { name: string; amount: number; costAtTime?: number }[];
      servicesUsed: {
        serviceId: string;
        qty: number;
        unitPriceAtTime?: number;
        unitCostAtTime?: number;
        nameAtTime?: string;
      }[];
      paymentMethod?: string;
      paymentAmount?: number;
      issueInvoice?: boolean;
      closeWorkOrder?: boolean;
    }) => api.patch(`/work-orders/${id}/billing`, payload),
    onSuccess: () => {
      setBillingError("");
      setPaymentAmountInput("");
      qc.invalidateQueries({ queryKey: ["work-order-detail", id] });
    },
  });

  const workOrderNumberMutation = useMutation({
    mutationFn: (payload: { workOrderNumber: string }) =>
      api.patch(`/work-orders/${id}/meta`, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["work-order-detail", id] });
      showToast({
        title: "Work order number updated",
        variant: "success",
      });
    },
    onError: (err: unknown) => {
      const message =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        "Unable to update work order number.";
      showToast({
        title: "Update failed",
        description: String(message),
        variant: "error",
      });
    },
  });

  const isAssignedToWorkOrder = detail.data?.isAssigned ?? false;
  const issueRestrictionText = !canIssueHere
    ? "Missing permission to issue parts for this work order."
    : "";

  useEffect(() => {
    if (detail.isError) {
      router.push("/work-orders");
    }
  }, [detail.isError, router]);

  useEffect(() => {
    if (!detail.data?.workOrder) return;
    const wo = detail.data.workOrder;
    setWorkOrderNumberInput(wo.workOrderNumber || "");
    const laborValue = toNumeric(wo.billableLaborAmount);
    setLaborInput(
      laborValue > 0 ? String(laborValue) : ""
    );
    const charges = (wo.otherCharges || []).map((c) => ({
      name: c?.name || "",
      amount: toNumeric(c?.amount) > 0 ? String(toNumeric(c?.amount)) : "",
      costAtTime:
        toNumeric(c?.costAtTime) > 0 ? String(toNumeric(c?.costAtTime)) : "",
    }));
    setChargeRows(charges.length ? charges : [{ name: "", amount: "", costAtTime: "" }]);
    const services = (wo.servicesUsed || []).map((s) => ({
      serviceId: s?.serviceId ? String(s.serviceId) : "",
      qty: toNumeric(s?.qty) > 0 ? String(toNumeric(s?.qty)) : "1",
      unitPriceAtTime:
        toNumeric(s?.unitPriceAtTime) > 0 ? String(toNumeric(s?.unitPriceAtTime)) : "",
      unitCostAtTime:
        toNumeric(s?.unitCostAtTime) > 0 ? String(toNumeric(s?.unitCostAtTime)) : "",
      nameAtTime: s?.nameAtTime || "",
    }));
    setServiceRows(services);
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
  const servicesUsed = useMemo(() => detail.data?.workOrder?.servicesUsed ?? [], [detail.data?.workOrder?.servicesUsed]);
  const otherCharges = useMemo(() => detail.data?.workOrder?.otherCharges ?? [], [detail.data?.workOrder?.otherCharges]);
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

  const financials: NonNullable<WorkOrderDetail["financials"]> =
    detail.data?.financials || calculateFinancials(wo, partsUsed, servicesUsed);
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
  const servicesDraft = serviceRows.reduce((sum, row) => {
    const qty = parseAmount(row.qty || "1");
    const unitPrice = parseAmount(row.unitPriceAtTime || "0");
    if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(unitPrice) || unitPrice < 0) return sum;
    return sum + qty * unitPrice;
  }, 0);
  const partsTotal = Number(financials.partsTotal || 0);
  const taxPlaceholder = 0;
  const draftSubtotal = laborAmountDraft + partsTotal + servicesDraft + otherChargesDraft;
  const draftGrandTotal = draftSubtotal + taxPlaceholder;
  const advanceReceived = Number(wo?.advanceAmount || financials.advanceReceived || 0);
  const advanceAppliedDraft = Math.min(advanceReceived, draftGrandTotal);
  const paymentCollectedDraft = (() => {
    const parsed = parseAmount(paymentAmountInput);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  })();
  const draftAmountDueBeforePayment = Math.max(draftGrandTotal - advanceAppliedDraft, 0);
  const draftAmountDue = Math.max(draftAmountDueBeforePayment - paymentCollectedDraft, 0);
  const closeBlockedByDue = draftAmountDue > 0.0001;
  const billingLocked = wo?.status === "Closed" && !canOverrideClosedBilling;
  const billingDisabledReason = !canEditBilling
    ? "Missing billing edit permission."
    : billingLocked
    ? "Only owner admin can edit closed work orders."
    : undefined;
  const billingDisabled =
    billingLocked ||
    !canEditBilling ||
    billingMutation.isPending;

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
        return { employeeId: match._id, roleType: match.role || "SERVICE_ADVISOR" };
      })
      .filter((item): item is { employeeId: string; roleType: string } => Boolean(item));
    assignMutation.mutate({ assignedEmployees: payload });
  };

  const addChargeRow = () =>
    setChargeRows((rows) => [...rows, { name: "", amount: "", costAtTime: "" }]);
  const removeChargeRow = (idx: number) =>
    setChargeRows((rows) =>
      rows.length === 1 ? rows : rows.filter((_, i) => i !== idx)
    );
  const addServiceRow = () =>
    setServiceRows((rows) => [
      ...rows,
      { serviceId: "", qty: "1", unitPriceAtTime: "", unitCostAtTime: "", nameAtTime: "" },
    ]);
  const removeServiceRow = (idx: number) =>
    setServiceRows((rows) => rows.filter((_, i) => i !== idx));
  const serviceCatalogById = useMemo(() => {
    const map = new Map<string, ServiceCatalogItem>();
    (servicesCatalogQuery.data || []).forEach((item) => map.set(item._id, item));
    return map;
  }, [servicesCatalogQuery.data]);

  const submitBilling = (options?: { issueInvoice?: boolean; closeWorkOrder?: boolean }) => {
    if (!canEditBilling) {
      setBillingError("Missing billing edit permission.");
      return;
    }
    if (billingLocked && !canOverrideClosedBilling) {
      setBillingError("Only owner admin can edit closed billing.");
      return;
    }
    setBillingError("");
    let nextLaborError: string | null = null;
    const nextChargeErrors: Record<number, string> = {};
    const nextServiceErrors: Record<number, string> = {};

    const laborVal = laborInput.trim() === "" ? 0 : Number(laborInput);
    if (!Number.isFinite(laborVal) || laborVal < 0) {
      nextLaborError = "Enter a valid non-negative labor amount.";
    }
    const normalizedCharges: { name: string; amount: number; costAtTime?: number }[] = [];
    chargeRows.forEach((row, idx) => {
      const hasContent =
        row.name.trim() !== "" || row.amount.trim() !== "" || row.costAtTime.trim() !== "";
      if (!hasContent) return;
      const amount = Number(row.amount || 0);
      const costAtTime = Number(row.costAtTime || 0);
      if (!Number.isFinite(amount) || amount < 0) {
        nextChargeErrors[idx] = "Enter a valid non-negative amount.";
        return;
      }
      if (!Number.isFinite(costAtTime) || costAtTime < 0) {
        nextChargeErrors[idx] = "Enter a valid non-negative cost.";
        return;
      }
      normalizedCharges.push({
        name: row.name.trim() || "Charge",
        amount,
        costAtTime,
      });
    });

    const normalizedServices: {
      serviceId: string;
      qty: number;
      unitPriceAtTime?: number;
      unitCostAtTime?: number;
      nameAtTime?: string;
    }[] = [];
    serviceRows.forEach((row, idx) => {
      const hasContent =
        row.serviceId.trim() !== "" ||
        row.qty.trim() !== "" ||
        row.unitPriceAtTime.trim() !== "" ||
        row.unitCostAtTime.trim() !== "" ||
        row.nameAtTime.trim() !== "";
      if (!hasContent) return;
      if (!row.serviceId) {
        nextServiceErrors[idx] = "Select a service.";
        return;
      }
      const qty = Number(row.qty || "1");
      if (!Number.isFinite(qty) || qty <= 0) {
        nextServiceErrors[idx] = "Qty must be greater than zero.";
        return;
      }
      const serviceMeta = serviceCatalogById.get(row.serviceId);
      const unitPriceRaw =
        row.unitPriceAtTime.trim() !== ""
          ? Number(row.unitPriceAtTime)
          : Number(serviceMeta?.defaultPrice || 0);
      const unitCostRaw =
        row.unitCostAtTime.trim() !== ""
          ? Number(row.unitCostAtTime)
          : Number(serviceMeta?.defaultCost || 0);
      if (!Number.isFinite(unitPriceRaw) || unitPriceRaw < 0) {
        nextServiceErrors[idx] = "Unit price must be a non-negative number.";
        return;
      }
      if (!Number.isFinite(unitCostRaw) || unitCostRaw < 0) {
        nextServiceErrors[idx] = "Unit cost must be a non-negative number.";
        return;
      }
      normalizedServices.push({
        serviceId: row.serviceId,
        qty,
        unitPriceAtTime: unitPriceRaw,
        unitCostAtTime: unitCostRaw,
        nameAtTime: row.nameAtTime.trim() || serviceMeta?.name,
      });
    });

    const hasErrors =
      Boolean(nextLaborError) ||
      Object.keys(nextChargeErrors).length > 0 ||
      Object.keys(nextServiceErrors).length > 0;
    setLaborError(nextLaborError);
    setChargeErrors(nextChargeErrors);
    setServiceErrors(nextServiceErrors);
    if (hasErrors) return;
    if (options?.closeWorkOrder && closeBlockedByDue) {
      setBillingError("Full payment is required before closing this work order.");
      return;
    }

    billingMutation.mutate(
      {
        billableLaborAmount: laborVal,
        otherCharges: normalizedCharges,
        servicesUsed: normalizedServices,
        paymentMethod,
        paymentAmount: paymentCollectedDraft > 0 ? paymentCollectedDraft : undefined,
        issueInvoice: options?.issueInvoice,
        closeWorkOrder: options?.closeWorkOrder,
      },
      {
        onSuccess: () => {
          showToast({
            title: options?.closeWorkOrder
              ? "Billing saved and work order closed"
              : options?.issueInvoice
              ? "Billing saved and invoice issued"
              : "Billing draft saved",
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

  const handleBillingSave = () => submitBilling();
  const handleIssueInvoice = () => submitBilling({ issueInvoice: true });
  const handleCloseWorkOrder = () => submitBilling({ issueInvoice: true, closeWorkOrder: true });
  const nextActions = (() => {
    if (!perms.canUpdateStatus) return [];
    if (wo?.status === "Scheduled") {
      return [{ label: "Start work", onClick: () => statusMutation.mutate({ status: "In Progress" }), tone: "primary" }];
    }
    if (wo?.status === "In Progress") {
      return [
        {
          label: "Cancel",
          onClick: () => {
            setCancelDialogOpen(true);
            setCancelError("");
          },
          tone: "muted",
        },
        {
          label: closeBlockedByDue ? "Collect full payment" : "Close work order",
          onClick: () => {
            setActiveSection("billing");
            if (closeBlockedByDue) {
              setPaymentAmountInput(draftAmountDueBeforePayment ? String(draftAmountDueBeforePayment) : "");
              setBillingError("Full payment is required before closing this work order.");
              return;
            }
            handleCloseWorkOrder();
          },
          tone: "primary",
        },
      ];
    }
    if (wo?.status === "Closed" && Number(detail.data?.invoice?.outstandingAmount || 0) > 0) {
      return [{ label: "Record payment", onClick: () => setActiveSection("payments"), tone: "primary" }];
    }
    return [];
  })();
  const isSectionVisible = (...sections: typeof activeSection[]) =>
    sections.includes(activeSection) || activeSection === "overview";

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
      <PageHeader
        title={wo?.workOrderNumber || wo?._id || "Work Order"}
        description={wo?.complaint || "General service"}
        badge={<StatusBadge status={wo?.status} />}
        meta={
          <>
            <span>Date in {formatDateTime(wo?.dateIn || wo?.createdAt)}</span>
            <span>Date out {wo?.deliveredAt ? formatDateTime(wo.deliveredAt) : "--"}</span>
            <span>Reference {wo?.reference?.trim() ? wo.reference : "--"}</span>
            {wo?.isHistorical && <span>Historical{wo?.historicalSource ? ` | ${wo.historicalSource}` : ""}</span>}
          </>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {nextActions.map((action) => (
              <button
                key={action.label}
                onClick={action.onClick}
                className={`text-xs px-3 py-2 rounded font-semibold disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${
                  action.tone === "muted"
                    ? "bg-muted hover:bg-border"
                    : "bg-primary/80 hover:bg-primary text-foreground"
                }`}
                disabled={statusMutation.isPending || billingMutation.isPending}
              >
                {action.label}
              </button>
            ))}
          </div>
        }
      />

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-4">
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-card/40 p-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="space-y-1 text-sm text-muted-foreground">
                <p className="font-semibold text-foreground">Customer</p>
                <p>{detail.data?.customer?.name || "--"}</p>
                <p>{detail.data?.customer?.phone || "--"}</p>
                {detail.data?.customer?.email && <p>{detail.data.customer.email}</p>}
              </div>
              <div className="space-y-1 text-sm text-muted-foreground">
                <p className="font-semibold text-foreground">Vehicle</p>
                <p>{[detail.data?.vehicle?.make, detail.data?.vehicle?.model, detail.data?.vehicle?.year].filter(Boolean).join(" ") || "--"}</p>
                <p>Plate {detail.data?.vehicle?.plate || "--"}</p>
                <p>VIN {detail.data?.vehicle?.vin || "--"}</p>
              </div>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p className="font-semibold text-foreground">Operational summary</p>
                <p>Assigned {assigned.length === 0 ? "Unassigned" : assigned.map((a) => a.name || a.email).join(", ")}</p>
                {detail.data?.visitSummary && (
                  <div className="rounded-lg border border-border bg-background/40 px-3 py-2 text-[11px]">
                    <p className="font-semibold text-foreground">Returning vehicle</p>
                    <p>Same vehicle visits {detail.data.visitSummary.vehicleVisitCount || 0}</p>
                    <p>Customer visits {detail.data.visitSummary.customerVisitCount || 0}</p>
                    <p>First {formatDateTime(detail.data.visitSummary.vehicleFirstVisit)} | Last {formatDateTime(detail.data.visitSummary.vehicleLastVisit)}</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {canOverrideClosedBilling && (
            <div className="rounded-xl border border-border bg-card/40 p-4 max-w-xl">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Edit Work Order Number</p>
              <div className="mt-2 flex gap-2">
                <Input
                  value={workOrderNumberInput}
                  onChange={(e) => setWorkOrderNumberInput(e.target.value)}
                  placeholder="WO-2026-001"
                  disabled={workOrderNumberMutation.isPending}
                />
                <button
                  type="button"
                  className="text-xs px-3 py-2 rounded bg-muted hover:bg-border disabled:opacity-60"
                  disabled={
                    workOrderNumberMutation.isPending ||
                    !workOrderNumberInput.trim() ||
                    workOrderNumberInput.trim() === (wo?.workOrderNumber || "")
                  }
                  onClick={() =>
                    workOrderNumberMutation.mutate({
                      workOrderNumber: workOrderNumberInput.trim(),
                    })
                  }
                >
                  {workOrderNumberMutation.isPending ? "Saving..." : "Save"}
                </button>
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">Must be unique across all work orders.</p>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-border bg-muted/30 px-4 py-3">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Charge summary</p>
          <p className="text-xl font-semibold text-foreground">Tk. {formatMoney(financials.total)}</p>
          <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
            <div className="rounded-lg border border-border/60 bg-background/30 px-3 py-2">
              <p className="uppercase tracking-wide text-muted-foreground">Labor</p>
              <p className="font-semibold text-foreground">Tk. {formatMoney(financials.labor)}</p>
            </div>
            <div className="rounded-lg border border-border/60 bg-background/30 px-3 py-2">
              <p className="uppercase tracking-wide text-muted-foreground">Parts</p>
              <p className="font-semibold text-foreground">Tk. {formatMoney(financials.partsTotal)}</p>
            </div>
            <div className="rounded-lg border border-border/60 bg-background/30 px-3 py-2">
              <p className="uppercase tracking-wide text-muted-foreground">Services</p>
              <p className="font-semibold text-foreground">Tk. {formatMoney(financials.servicesTotal)}</p>
            </div>
            <div className="rounded-lg border border-border/60 bg-background/30 px-3 py-2">
              <p className="uppercase tracking-wide text-muted-foreground">Other charges</p>
              <p className="font-semibold text-foreground">Tk. {formatMoney(financials.otherTotal)}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="sticky top-0 z-10 mb-4 rounded-xl border border-border bg-background/95 backdrop-blur">
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 px-4 py-3">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Total billed</p>
            <p className="font-semibold text-foreground">Tk. {formatMoney(detail.data?.invoice?.total ?? financials.total)}</p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Advance applied</p>
            <p className="font-semibold text-foreground">Tk. {formatMoney(financials.advanceApplied)}</p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Total paid</p>
            <p className="font-semibold text-foreground">Tk. {formatMoney(detail.data?.invoice?.totalPaid ?? financials.totalPaid)}</p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Outstanding due</p>
            <p className="font-semibold text-[var(--warning-text)]">Tk. {formatMoney(detail.data?.invoice?.outstandingAmount ?? financials.outstandingAmount)}</p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Invoice status</p>
            <p className="font-semibold text-foreground">{detail.data?.invoice?.status || "Draft"}</p>
          </div>
        </div>
        <div className="border-t border-border px-4 py-2">
          <PageToolbar className="p-0 bg-transparent">
            <PageToolbarSection>
              <SegmentedControl
                aria-label="Work order sections"
                options={[
                  { value: "overview", label: "Overview" },
                  { value: "billing", label: "Billing" },
                  { value: "payments", label: "Payments" },
                  { value: "activity", label: "Activity" },
                  { value: "inventory", label: "Inventory / Parts" },
                ]}
                value={activeSection}
                onChange={(val) => setActiveSection(val as typeof activeSection)}
              />
            </PageToolbarSection>
            <PageToolbarSection align="end">
              <div className="text-xs text-muted-foreground">
                {activeSection === "billing"
                  ? "Review charges, collect payment, then issue or close."
                  : activeSection === "payments"
                  ? "Use this view to review what has already been collected."
                  : activeSection === "inventory"
                  ? "Issued parts, service lines, and extra charges."
                  : activeSection === "activity"
                  ? "Logs, notes, and audit trail."
                  : "Customer, vehicle, and invoice context."}
              </div>
            </PageToolbarSection>
          </PageToolbar>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="glass p-4 rounded-xl space-y-3 lg:col-span-2">
          <div className={`space-y-4 text-sm text-muted-foreground ${isSectionVisible("overview", "payments", "activity") ? "" : "hidden"}`}>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div>
              <p className="text-foreground font-semibold">Customer</p>
              <p>{detail.data?.customer?.name}</p>
              <p className="text-muted-foreground">{detail.data?.customer?.phone}</p>
              {detail.data?.customer?.email && (
                <p className="text-muted-foreground">{detail.data.customer.email}</p>
              )}
            </div>
            <div>
              <p className="text-foreground font-semibold">Vehicle</p>
              <p>
                {detail.data?.vehicle?.make} {detail.data?.vehicle?.model}{" "}
                {detail.data?.vehicle?.year || ""}
              </p>
              <p className="text-muted-foreground">
                Plate: {detail.data?.vehicle?.plate || "--"}
              </p>
              <p className="text-muted-foreground">
                VIN: {detail.data?.vehicle?.vin || "--"}
              </p>
              {detail.data?.visitSummary && (
                <div className="mt-2 rounded-lg border border-border bg-card/40 px-3 py-2 text-[11px] text-muted-foreground">
                  <p className="font-semibold text-foreground">Returning vehicle</p>
                  <p>
                    Same vehicle visits: {detail.data.visitSummary.vehicleVisitCount || 0}
                    {" | "}Customer visits: {detail.data.visitSummary.customerVisitCount || 0}
                  </p>
                  <p>
                    First {formatDateTime(detail.data.visitSummary.vehicleFirstVisit)}
                    {" | "}Last {formatDateTime(detail.data.visitSummary.vehicleLastVisit)}
                  </p>
                  <p>
                    Customer has used {detail.data.visitSummary.customerDistinctVehicles || 0} vehicle
                    {(detail.data.visitSummary.customerDistinctVehicles || 0) === 1 ? "" : "s"} here.
                  </p>
                </div>
              )}
            </div>
            <div>
              <p className="text-foreground font-semibold">Assigned</p>
              <div className="text-muted-foreground">
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
              <p className="text-muted-foreground">
                  {detail.data.invoice.invoiceNumber}
                </p>
                <p className="text-muted-foreground">
                  Status: {detail.data.invoice.status}
                </p>
                <p className="text-muted-foreground">
                  Total: Tk. {formatMoney(detail.data.invoice.total)}
                </p>
                <p className="text-muted-foreground">
                  Paid: Tk. {formatMoney(detail.data.invoice.totalPaid)}
                </p>
                <p className="text-muted-foreground">
                  Due: Tk. {formatMoney(detail.data.invoice.outstandingAmount)}
                </p>
                {detail.data.payments && detail.data.payments.length > 0 && (
                  <div className="mt-2 space-y-1 text-muted-foreground">
                    <p className="font-semibold text-foreground">Payment history</p>
                    {detail.data.payments.map((payment) => (
                      <p key={payment._id || `${payment.paidAt}-${payment.amount}`}>
                        {formatDateTime(payment.paidAt)} | {payment.method || "--"} | Tk.{" "}
                        {formatMoney(payment.amount)}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}
            {(auditTrail.length > 0 ||
              detail.data?.audit?.createdBy ||
              detail.data?.audit?.billedBy ||
              detail.data?.audit?.billingUpdatedBy) && (
              <div>
                <p className="text-foreground font-semibold">Activity</p>
                {auditTrail.length > 0 ? (
                  <div className="space-y-1 text-muted-foreground">
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
                      <p className="text-muted-foreground">
                        Intake: {detail.data.audit.createdBy.name || "Unknown"}{" "}
                        {detail.data.audit.createdBy.role ? `(${detail.data.audit.createdBy.role})` : ""}
                        {detail.data.audit.createdBy.at ? ` | ${formatDateTime(detail.data.audit.createdBy.at)}` : ""}
                      </p>
                    )}
                    {detail.data?.audit?.billingUpdatedBy && (
                      <p className="text-muted-foreground">
                        Billing update: {detail.data.audit.billingUpdatedBy.name || "Unknown"}{" "}
                        {detail.data.audit.billingUpdatedBy.role ? `(${detail.data.audit.billingUpdatedBy.role})` : ""}
                        {detail.data.audit.billingUpdatedBy.at ? ` | ${formatDateTime(detail.data.audit.billingUpdatedBy.at)}` : ""}
                      </p>
                    )}
                    {detail.data?.audit?.billedBy && (
                      <p className="text-muted-foreground">
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
          </div>

          <div className={`mt-4 ${isSectionVisible("inventory") ? "" : "hidden"}`}>
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
            <div className="overflow-x-auto">
              <Table>
                <THead>
                  <TR>
                    <TH>Part</TH>
                    <TH>SKU</TH>
                    <TH>Qty</TH>
                    <TH>Selling</TH>
                    <TH>Cost</TH>
                    <TH>Issued</TH>
                  </TR>
                </THead>
                <TBody>
                  {sortedPartsUsed.map((p) => {
                    const issuedTime = p.issuedAt || p.updatedAt || p.createdAt;
                    return (
                      <TR key={p.partId}>
                        <TD className="font-semibold text-foreground">
                          {p.partName || p.partId}
                        </TD>
                        <TD className="text-muted-foreground">{p.sku || "--"}</TD>
                        <TD>{p.qty ?? 0}</TD>
                        <TD>Tk. {formatMoney(p.sellingPriceAtTime)}</TD>
                        <TD className="text-muted-foreground">
                          Tk. {formatMoney(p.costAtTime)}
                        </TD>
                        <TD className="text-muted-foreground">
                          {issuedTime ? formatDateTime(issuedTime) : "--"}
                        </TD>
                      </TR>
                    );
                  })}
                  {sortedPartsUsed.length === 0 && (
                    <TR>
                      <TD colSpan={6} className="text-center text-muted-foreground">
                        No parts issued yet.
                      </TD>
                    </TR>
                  )}
                </TBody>
              </Table>
            </div>
          </div>

          <div className={`mt-4 ${isSectionVisible("inventory") ? "" : "hidden"}`}>
            <div className="flex items-center justify-between gap-2 mb-2">
              <p className="font-semibold text-foreground">Services Used</p>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <THead>
                  <TR>
                    <TH>Service</TH>
                    <TH>Qty</TH>
                    <TH>Unit Price</TH>
                    <TH>Unit Cost</TH>
                    <TH>Total</TH>
                  </TR>
                </THead>
                <TBody>
                  {servicesUsed.map((service, index) => {
                    const qty = toNumeric(service.qty);
                    const unitPrice = toNumeric(service.unitPriceAtTime);
                    const total = qty * unitPrice;
                    return (
                      <TR key={index}>
                        <TD className="font-semibold text-foreground">
                          {service.nameAtTime || service.serviceId}
                        </TD>
                        <TD>{qty}</TD>
                        <TD>Tk. {formatMoney(unitPrice)}</TD>
                        <TD className="text-muted-foreground">
                          Tk. {formatMoney(service.unitCostAtTime)}
                        </TD>
                        <TD>Tk. {formatMoney(total)}</TD>
                      </TR>
                    );
                  })}
                  {servicesUsed.length === 0 && (
                    <TR>
                      <TD colSpan={5} className="text-center text-muted-foreground">
                        No service lines yet.
                      </TD>
                    </TR>
                  )}
                </TBody>
              </Table>
            </div>
          </div>

          <div className={`mt-4 ${isSectionVisible("inventory") ? "" : "hidden"}`}>
            <div className="flex items-center justify-between gap-2 mb-2">
              <p className="font-semibold text-foreground">Other Charges</p>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <THead>
                  <TR>
                    <TH>Label</TH>
                    <TH>Selling</TH>
                    <TH>Cost</TH>
                    <TH>Margin</TH>
                  </TR>
                </THead>
                <TBody>
                  {otherCharges.map((charge, index) => {
                    const amount = toNumeric(charge?.amount);
                    const cost = toNumeric(charge?.costAtTime);
                    return (
                      <TR key={index}>
                        <TD className="font-semibold text-foreground">
                          {charge?.name || "Charge"}
                        </TD>
                        <TD>Tk. {formatMoney(amount)}</TD>
                        <TD className="text-muted-foreground">
                          Tk. {formatMoney(cost)}
                        </TD>
                        <TD>Tk. {formatMoney(amount - cost)}</TD>
                      </TR>
                    );
                  })}
                  {otherCharges.length === 0 && (
                    <TR>
                      <TD colSpan={4} className="text-center text-muted-foreground">
                        No other charge lines yet.
                      </TD>
                    </TR>
                  )}
                </TBody>
              </Table>
            </div>
          </div>

          <div className={`mt-4 space-y-2 ${isSectionVisible("activity") ? "" : "hidden"}`}>
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
              <div className="overflow-x-auto">
                <Table>
                  <THead>
                    <TR>
                      <TH>Employee</TH>
                      <TH>Clock in</TH>
                      <TH>Clock out</TH>
                      <TH>Duration</TH>
                      <TH>Status</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {sortedTimeLogs.map((l) => {
                      const isRunning = !l.clockOutAt;
                      const duration = computeDurationMinutes(l);
                      const started = formatDateTime(l.clockInAt);
                      const ended = l.clockOutAt ? formatDateTime(l.clockOutAt) : "In progress";
                      const actor = formatEmployeeName(l);
                      return (
                        <TR key={l._id}>
                          <TD className="font-semibold text-foreground">{actor}</TD>
                          <TD className="text-muted-foreground">{started}</TD>
                          <TD className="text-muted-foreground">{ended}</TD>
                          <TD>{duration} min</TD>
                          <TD>
                            {isRunning ? (
                              <span className="inline-flex items-center gap-1 rounded-full border border-green-500/40 bg-green-500/10 px-2 py-0.5 text-[11px] text-green-200">
                                <Clock4 className="h-3 w-3" aria-hidden />
                                Running
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground">Stopped</span>
                            )}
                          </TD>
                        </TR>
                      );
                    })}
                    {sortedTimeLogs.length === 0 && (
                      <TR>
                        <TD colSpan={5} className="text-center text-muted-foreground">
                          No time logs yet.
                        </TD>
                      </TR>
                    )}
                  </TBody>
                </Table>
              </div>
            </div>
          </div>

          <div className={`mt-4 ${isSectionVisible("activity") ? "" : "hidden"}`}>
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
            <div className="overflow-x-auto">
              <Table>
                <THead>
                  <TR>
                    <TH>Note</TH>
                    <TH>Created</TH>
                  </TR>
                </THead>
                <TBody>
                  {sortedNotes.map((n, idx) => (
                    <TR key={idx}>
                      <TD className="text-foreground">{n.message}</TD>
                      <TD className="text-muted-foreground">{formatDateTime(n.createdAt)}</TD>
                    </TR>
                  ))}
                  {sortedNotes.length === 0 && (
                    <TR>
                      <TD colSpan={2} className="text-center text-muted-foreground">
                        No notes yet.
                      </TD>
                    </TR>
                  )}
                </TBody>
              </Table>
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
          {/* Billing view */}
          {
            <div className={`glass p-4 rounded-xl space-y-3 ${isSectionVisible("billing", "payments") ? "" : "hidden"}`}>
              <div className="flex items-center justify-between gap-2">
                <p className="font-semibold text-foreground">
                  Billing & Charges
                </p>
                <span className="text-xs text-muted-foreground">
                  Current total billed Tk. {formatMoney(draftGrandTotal)}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Save charges first, then issue invoice, collect payment, and close only when the due reaches zero.
              </p>
              <div className="grid grid-cols-2 gap-2 rounded-lg border border-border bg-background/40 p-3 text-xs md:grid-cols-4">
                <div>
                  <p className="uppercase tracking-wide text-muted-foreground">Total billed</p>
                  <p className="font-semibold text-foreground">Tk. {formatMoney(draftGrandTotal)}</p>
                </div>
                <div>
                  <p className="uppercase tracking-wide text-muted-foreground">Advance applied</p>
                  <p className="font-semibold text-foreground">Tk. {formatMoney(advanceAppliedDraft)}</p>
                </div>
                <div>
                  <p className="uppercase tracking-wide text-muted-foreground">Payment now</p>
                  <p className="font-semibold text-foreground">Tk. {formatMoney(paymentCollectedDraft)}</p>
                </div>
                <div>
                  <p className="uppercase tracking-wide text-muted-foreground">Outstanding due</p>
                  <p className="font-semibold text-[var(--warning-text)]">Tk. {formatMoney(draftAmountDue)}</p>
                </div>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Payment method</p>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  disabled={billingDisabled}
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
                  Advance (auto-applied)
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Received Tk. {formatMoney(advanceReceived)} | Applied Tk.{" "}
                  {formatMoney(advanceAppliedDraft)}
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Payment collected now</p>
                <CurrencyInput
                  value={paymentAmountInput}
                  onChange={setPaymentAmountInput}
                  placeholder="0"
                  allowEmpty
                  min={0}
                  disabled={billingDisabled || !perms.canTakePayment}
                  title={
                    !perms.canTakePayment
                      ? "Missing payment permission."
                      : billingDisabledReason
                  }
                />
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setPaymentAmountInput(
                        draftAmountDueBeforePayment > 0 ? String(draftAmountDueBeforePayment) : ""
                      )
                    }
                    disabled={billingDisabled || !perms.canTakePayment}
                    className="rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted disabled:opacity-50"
                  >
                    Full due
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaymentAmountInput("")}
                    disabled={billingDisabled || !perms.canTakePayment}
                    className="rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted disabled:opacity-50"
                  >
                    Custom amount
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaymentAmountInput("")}
                    disabled={billingDisabled || !perms.canTakePayment}
                    className="rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted disabled:opacity-50"
                  >
                    Clear
                  </button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Remaining due after this payment: Tk. {formatMoney(draftAmountDue)}
                </p>
                {!perms.canTakePayment && (
                  <p className="text-[11px] text-muted-foreground">
                    You can still save billing or issue invoice without collecting money.
                  </p>
                )}
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
                  disabled={billingDisabled}
                  title={billingDisabledReason}
                />
                {laborError && <p className="text-[11px] text-[var(--danger-text)]">{laborError}</p>}
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-foreground">Services</p>
                  <button
                    type="button"
                    onClick={addServiceRow}
                    disabled={billingDisabled || !perms.canReadServices}
                    title={billingDisabledReason}
                    className="text-xs text-accent underline disabled:opacity-50"
                  >
                    Add service
                  </button>
                </div>
                {!perms.canReadServices && (
                  <p className="text-[11px] text-muted-foreground">
                    Missing service catalog read permission.
                  </p>
                )}
                {serviceRows.length === 0 && (
                  <p className="text-[11px] text-muted-foreground">
                    No services added. Leave this section empty if not needed.
                  </p>
                )}
                <div className="hidden md:grid md:grid-cols-12 gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                  <span className="md:col-span-4">Service</span>
                  <span className="md:col-span-1">Qty</span>
                  <span className="md:col-span-2">Unit Price</span>
                  <span className="md:col-span-2">Unit Cost</span>
                  <span className="md:col-span-2 text-right">Line</span>
                  <span className="md:col-span-1 text-right">Action</span>
                </div>
                {serviceRows.map((row, idx) => {
                  const rowLineTotal =
                    (Number(row.qty || "0") || 0) * (Number(row.unitPriceAtTime || "0") || 0);
                  return (
                    <div key={idx} className="grid grid-cols-1 md:grid-cols-12 gap-2 items-start rounded-md border border-border/40 p-2 md:p-0 md:border-0">
                      <select
                        value={row.serviceId}
                        onChange={(e) => {
                          const serviceId = e.target.value;
                          const service = serviceCatalogById.get(serviceId);
                          setServiceRows((rows) =>
                            rows.map((r, i) =>
                              i === idx
                                ? {
                                    ...r,
                                    serviceId,
                                    nameAtTime: service?.name || r.nameAtTime,
                                    unitPriceAtTime:
                                      service && r.unitPriceAtTime.trim() === ""
                                        ? String(service.defaultPrice ?? 0)
                                        : r.unitPriceAtTime,
                                    unitCostAtTime:
                                      service && r.unitCostAtTime.trim() === ""
                                        ? String(service.defaultCost ?? 0)
                                        : r.unitCostAtTime,
                                  }
                                : r
                            )
                          );
                          setServiceErrors((prev) => {
                            const next = { ...prev };
                            delete next[idx];
                            return next;
                          });
                        }}
                        disabled={billingDisabled || !perms.canReadServices}
                        className="md:col-span-4 bg-muted border border-border rounded-lg px-3 py-2 w-full text-foreground text-sm disabled:opacity-60"
                        title={billingDisabledReason}
                      >
                        <option value="">Select service</option>
                        {(servicesCatalogQuery.data || []).map((service) => (
                          <option key={service._id} value={service._id}>
                            {service.name} ({service.code})
                          </option>
                        ))}
                      </select>
                      <input
                        value={row.qty}
                        onChange={(e) => {
                          const value = e.target.value;
                          setServiceRows((rows) => rows.map((r, i) => (i === idx ? { ...r, qty: value } : r)));
                          setServiceErrors((prev) => {
                            const next = { ...prev };
                            delete next[idx];
                            return next;
                          });
                        }}
                        placeholder="Qty"
                        className="md:col-span-1 bg-muted border border-border rounded-lg px-3 py-2 w-full text-foreground text-sm disabled:opacity-60"
                        disabled={billingDisabled}
                        title={billingDisabledReason}
                      />
                      <CurrencyInput
                        value={row.unitPriceAtTime}
                        onChange={(val) => {
                          setServiceRows((rows) =>
                            rows.map((r, i) => (i === idx ? { ...r, unitPriceAtTime: val } : r))
                          );
                          setServiceErrors((prev) => {
                            const next = { ...prev };
                            delete next[idx];
                            return next;
                          });
                        }}
                        placeholder="Unit price"
                        allowEmpty
                        min={0}
                        disabled={billingDisabled}
                        title={billingDisabledReason}
                        className="md:col-span-2"
                      />
                      <CurrencyInput
                        value={row.unitCostAtTime}
                        onChange={(val) => {
                          setServiceRows((rows) =>
                            rows.map((r, i) => (i === idx ? { ...r, unitCostAtTime: val } : r))
                          );
                          setServiceErrors((prev) => {
                            const next = { ...prev };
                            delete next[idx];
                            return next;
                          });
                        }}
                        placeholder="Unit cost"
                        allowEmpty
                        min={0}
                        disabled={billingDisabled}
                        title={billingDisabledReason}
                        className="md:col-span-2"
                      />
                      <div className="md:col-span-2 text-[11px] text-muted-foreground text-right">
                        Line Tk. {formatMoney(rowLineTotal)}
                      </div>
                      <button
                        type="button"
                        onClick={() => removeServiceRow(idx)}
                        disabled={billingDisabled}
                        title={billingDisabledReason}
                        className="md:col-span-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-40 text-right"
                      >
                        Remove
                      </button>
                      {serviceErrors[idx] && (
                        <p className="col-span-12 text-[11px] text-[var(--danger-text)]">{serviceErrors[idx]}</p>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-foreground">
                    Other charges
                  </p>
                  <button
                    type="button"
                    onClick={addChargeRow}
                    disabled={billingDisabled}
                    title={billingDisabledReason}
                    className="text-xs text-accent underline"
                  >
                    Add
                  </button>
                </div>
                <div className="hidden md:grid md:grid-cols-12 gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                  <span className="md:col-span-4">Label</span>
                  <span className="md:col-span-3">Selling</span>
                  <span className="md:col-span-3">Cost</span>
                  <span className="md:col-span-1 text-right">Line</span>
                  <span className="md:col-span-1 text-right">Action</span>
                </div>
                {chargeRows.map((row, idx) => (
                  <div
                    key={idx}
                    className="grid grid-cols-1 md:grid-cols-12 gap-2 items-center rounded-md border border-border/40 p-2 md:p-0 md:border-0"
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
                      placeholder="Label (e.g., Fuel line service)"
                      className="md:col-span-4 bg-muted border border-border rounded-lg px-3 py-2 w-full text-foreground text-sm disabled:opacity-60"
                      disabled={billingDisabled}
                      title={billingDisabledReason}
                    />
                    <div className="md:col-span-3">
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
                        disabled={billingDisabled}
                        title={billingDisabledReason}
                      />
                      {chargeErrors[idx] && (
                        <p className="mt-1 text-[11px] text-[var(--danger-text)]">{chargeErrors[idx]}</p>
                      )}
                    </div>
                    <div className="md:col-span-3">
                      <CurrencyInput
                        value={row.costAtTime}
                        onChange={(val) => {
                          setChargeRows((rows) =>
                            rows.map((r, i) =>
                              i === idx ? { ...r, costAtTime: val } : r
                            )
                          );
                          setChargeErrors((prev) => {
                            const next = { ...prev };
                            delete next[idx];
                            return next;
                          });
                        }}
                        placeholder="Cost"
                        allowEmpty
                        min={0}
                        disabled={billingDisabled}
                        title={billingDisabledReason}
                      />
                    </div>
                    <div className="md:col-span-1 text-[11px] text-muted-foreground text-right">
                      Tk. {formatMoney(parseAmount(row.amount))}
                    </div>
                    <button
                      type="button"
                      onClick={() => removeChargeRow(idx)}
                      disabled={chargeRows.length === 1 || billingDisabled}
                      title={billingDisabledReason}
                      className="md:col-span-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-40 text-right"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
              {billingError && (
                <p className="text-xs text-[var(--danger-text)]">{billingError}</p>
              )}
              <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground space-y-1">
                <p>Labor Tk. {formatMoney(laborAmountDraft)}</p>
                <p>Parts Tk. {formatMoney(partsTotal)}</p>
                <p>Services Tk. {formatMoney(servicesDraft)}</p>
                <p>Other Tk. {formatMoney(otherChargesDraft)}</p>
                <p>
                  Advance applied Tk. {formatMoney(advanceAppliedDraft)}
                </p>
                <p>Tax (placeholder) Tk. {formatMoney(taxPlaceholder)}</p>
                <p className="text-foreground font-semibold">
                  Total Tk. {formatMoney(draftGrandTotal)}
                </p>
                <p>Payment now Tk. {formatMoney(paymentCollectedDraft)}</p>
                <p className="text-foreground font-semibold">
                  Remaining due Tk. {formatMoney(draftAmountDue)}
                </p>
                <p>Current invoice due Tk. {formatMoney(detail.data?.invoice?.outstandingAmount ?? financials.outstandingAmount)}</p>
                <p>Current paid Tk. {formatMoney(detail.data?.invoice?.totalPaid ?? financials.totalPaid)}</p>
              </div>
              <div className="grid gap-2 md:grid-cols-3">
                <button
                  onClick={handleBillingSave}
                  disabled={billingDisabled}
                  title={billingDisabledReason}
                  className="w-full py-2 rounded-lg bg-muted font-semibold text-foreground disabled:opacity-50 hover:bg-border focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                >
                  {billingMutation.isPending ? "Saving..." : "Save draft"}
                </button>
                <button
                  onClick={handleIssueInvoice}
                  disabled={billingDisabled || !perms.canCreateInvoice}
                  title={!perms.canCreateInvoice ? "Missing invoice create permission." : billingDisabledReason}
                  className="w-full py-2 rounded-lg bg-primary/80 font-semibold text-foreground disabled:opacity-50 hover:bg-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                >
                  {billingMutation.isPending ? "Working..." : "Issue invoice"}
                </button>
                <button
                  onClick={handleCloseWorkOrder}
                  disabled={billingDisabled || closeBlockedByDue}
                  title={closeBlockedByDue ? "Full payment is required before closing this work order." : billingDisabledReason}
                  className="w-full py-2 rounded-lg bg-accent font-semibold text-background disabled:opacity-50 hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                >
                  {billingMutation.isPending ? "Working..." : "Save, take payment & close"}
                </button>
              </div>
              {closeBlockedByDue && (
                <p className="text-[11px] text-[var(--warning-text)]">
                  Work order closes only after the bill is fully paid. Use “Use full due” to autofill the remaining amount.
                </p>
              )}
              {billingLocked && (
                <p className="text-[11px] text-muted-foreground">
                  Closed billing edits are restricted to owner admin.
                </p>
              )}
              {!canEditBilling && (
                <p className="text-[11px] text-muted-foreground">
                  Missing billing edit permission.
                </p>
              )}
              {wo?.status === "Closed" && (
                <div className="w-full rounded-lg bg-muted py-2 text-center font-semibold text-[var(--success-text)]">
                  Work order closed & fully settled
                </div>
              )}
            </div>
          }

          {perms.canAssign && (
            <div className={`glass p-4 rounded-xl space-y-3 ${isSectionVisible("activity") ? "" : "hidden"}`}>
              <div className="flex items-center justify-between gap-2">
                <p className="font-semibold text-foreground">Assignments</p>
                <span className="text-xs text-muted-foreground">
                  {assignMutation.isPending
                    ? "Updating..."
                    : `${selectedAssignees.length} selected`}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Choose assignees for this job.
              </p>
              {assignableEmployees.isLoading && (
                <p className="text-sm text-muted-foreground">Loading team...</p>
              )}
              {assignableEmployees.isError && (
                <p className="text-sm text-[var(--danger-text)]">
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

          {
            <div className={`glass p-4 rounded-xl space-y-3 ${isSectionVisible("inventory") ? "" : "hidden"}`}>
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
                type="text"
                inputMode="numeric"
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
          }

          <div className={`glass p-4 rounded-xl space-y-3 ${isSectionVisible("activity") ? "" : "hidden"}`}>
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
      <Dialog
        open={cancelDialogOpen}
        onClose={() => {
          setCancelDialogOpen(false);
          setCancelNote("");
          setCancelError("");
        }}
        title="Cancel work order"
        footer={
          <div className="flex gap-2">
            <button
              className="px-3 py-2 rounded-md border border-border text-sm"
              onClick={() => {
                setCancelDialogOpen(false);
                setCancelNote("");
                setCancelError("");
              }}
            >
              Keep open
            </button>
            <button
              className="px-3 py-2 rounded-md bg-primary text-sm font-semibold text-foreground disabled:opacity-60"
              disabled={statusMutation.isPending}
              onClick={() => {
                const message = cancelNote.trim();
                if (!message) {
                  setCancelError("Cancellation note is required.");
                  return;
                }
                statusMutation.mutate(
                  { status: "Canceled", note: message },
                  {
                    onSuccess: () => {
                      setCancelDialogOpen(false);
                      setCancelNote("");
                      setCancelError("");
                    }
                  }
                );
              }}
            >
              {statusMutation.isPending ? "Canceling..." : "Confirm cancel"}
            </button>
          </div>
        }
      >
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            A cancellation note is required. Any issued parts will be returned to inventory.
          </p>
          <Textarea
            value={cancelNote}
            onChange={(e) => {
              setCancelNote(e.target.value);
              setCancelError("");
            }}
            placeholder="Why was this work order canceled?"
          />
          {cancelError && <p className="text-xs text-[var(--danger-text)]">{cancelError}</p>}
        </div>
      </Dialog>
    </Shell>
  );
}



