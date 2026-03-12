"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Shell from "../../components/shell";
import api from "../../lib/api-client";
import { useAuth } from "../../lib/auth-context";
import { SegmentedControl } from "../../components/ui/segmented-control";
import { EmptyState } from "../../components/ui/empty-state";
import { ErrorState } from "../../components/ui/error-state";
import { Skeleton } from "../../components/ui/skeleton";
import { Dialog } from "../../components/ui/dialog";
import { Textarea } from "../../components/ui/textarea";
import { Table, TBody, TD, TH, THead, TR } from "../../components/ui/table";
import { Input } from "../../components/ui/input";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { PageHeader } from "../../components/page-header";
import { PageToolbar, PageToolbarSection } from "../../components/page-toolbar";

const statuses = ["All", "Scheduled", "In Progress", "Closed", "Canceled"] as const;

type WorkOrder = {
  _id: string;
  workOrderNumber?: string;
  complaint?: string;
  status?: string;
  createdAt?: string;
  dateIn?: string;
  deliveredAt?: string | null;
  isHistorical?: boolean;
  assignedEmployees?: { employeeId?: string }[];
  customer?: { name?: string; phone?: string };
  vehicle?: { make?: string; model?: string; plate?: string };
  invoice?: {
    invoiceNumber?: string;
    status?: string;
    total?: number;
    totalPaid?: number;
    outstandingAmount?: number;
  };
};

const normalizeId = (val?: string | { toString?: () => string }) => {
  if (!val) return "";
  if (typeof val === "string") return val;
  if (typeof val.toString === "function") return val.toString();
  return "";
};

const formatMoney = (val: number | string | null | undefined) => {
  if (val === null || val === undefined) return "--";
  const num = typeof val === "number" ? val : Number(val);
  return Number.isFinite(num) ? num.toFixed(2) : "--";
};

const statusBadgeVariant = (status?: string) => {
  if (status === "Closed") return "success";
  if (status === "Canceled") return "warning";
  if (status === "In Progress") return "default";
  return "secondary";
};

const getDateIn = (wo: WorkOrder) => wo.dateIn || wo.createdAt || "";
const getDateOut = (wo: WorkOrder) => wo.deliveredAt || "";

const getRowWarnings = (wo: WorkOrder) => {
  const warnings: string[] = [];
  const due = Number(wo.invoice?.outstandingAmount || 0);
  const assignedCount = wo.assignedEmployees?.length || 0;
  const ageMs = Date.now() - new Date(getDateIn(wo) || 0).getTime();
  const ageDays = Number.isFinite(ageMs) ? ageMs / 86400000 : 0;
  if (due > 0) warnings.push("Due");
  if (assignedCount === 0 && wo.status !== "Closed" && wo.status !== "Canceled") warnings.push("Unassigned");
  if (wo.status === "Scheduled" && ageDays >= 2) warnings.push("Aging");
  if (wo.status === "Closed" && due > 0) warnings.push("Closed unpaid");
  return warnings;
};

const getPrimaryAction = (wo: WorkOrder) => {
  const due = Number(wo.invoice?.outstandingAmount || 0);
  if (wo.status === "Scheduled") return { label: "Start", status: "In Progress" };
  if (wo.status === "In Progress") return { label: "Close", status: "Closed" };
  if (wo.status === "Closed" && due > 0) return { label: "Take payment", status: null };
  return { label: "Open", status: null };
};

export default function WorkOrdersPage() {
  const { session } = useAuth();
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<(typeof statuses)[number]>("All");
  const [search, setSearch] = useState("");
  const [assignedOnly, setAssignedOnly] = useState(false);
  const [showMoreFilters, setShowMoreFilters] = useState(false);
  const [sortBy, setSortBy] = useState<"recent" | "oldest" | "amount" | "status" | "due">("recent");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [page, setPage] = useState(1);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancelTargetId, setCancelTargetId] = useState<string | null>(null);
  const [cancelNote, setCancelNote] = useState("");
  const [cancelError, setCancelError] = useState("");
  const pageSize = 14;

  const rawUserId = session?.user?.userId || (session?.user as { _id?: string } | undefined)?._id;
  const userId = useMemo(() => normalizeId(rawUserId), [rawUserId]);
  const canReadAll = session?.user?.permissions?.includes("WORKORDERS_READ_ALL");
  const canReadAssigned = session?.user?.permissions?.includes("WORKORDERS_READ_ASSIGNED");
  const canUpdateStatus = session?.user?.permissions?.includes("WORKORDERS_UPDATE_STATUS");
  const showBoard = canReadAll || canReadAssigned;

  const workOrders = useQuery({
    queryKey: ["work-orders", statusFilter],
    queryFn: async () => {
      const res = await api.get("/work-orders", {
        params: { status: statusFilter === "All" ? undefined : statusFilter },
      });
      return res.data as WorkOrder[];
    },
    enabled: showBoard,
  });

  const updateStatus = useMutation({
    mutationFn: (payload: { id: string; status: string; note?: string }) =>
      api.patch(`/work-orders/${payload.id}/status`, {
        status: payload.status,
        note: payload.note,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["work-orders"] }),
  });

  const filtered = useMemo(() => {
    const items = workOrders.data || [];
    const term = search.trim().toLowerCase();
    const start = startDate ? new Date(startDate) : null;
    const end = endDate ? new Date(endDate) : null;

    const bySearch = term
      ? items.filter((wo) => {
          const haystack = [
            wo.workOrderNumber,
            wo._id,
            wo.complaint,
            wo.customer?.name,
            wo.customer?.phone,
            wo.vehicle?.make,
            wo.vehicle?.model,
            wo.vehicle?.plate,
            wo.invoice?.invoiceNumber,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          return haystack.includes(term);
        })
      : items;

    const byAssigned =
      assignedOnly && userId
        ? bySearch.filter((wo) =>
            (wo.assignedEmployees || []).some((a) => a.employeeId && normalizeId(a.employeeId) === userId)
          )
        : bySearch;

    const byDate = byAssigned.filter((wo) => {
      if (!start && !end) return true;
      const anchor = new Date(getDateOut(wo) || getDateIn(wo) || 0);
      if (start && anchor < start) return false;
      if (end) {
        const endOfDay = new Date(end);
        endOfDay.setHours(23, 59, 59, 999);
        if (anchor > endOfDay) return false;
      }
      return true;
    });

    return [...byDate].sort((a, b) => {
      if (sortBy === "amount") return Number(b.invoice?.total || 0) - Number(a.invoice?.total || 0);
      if (sortBy === "due") return Number(b.invoice?.outstandingAmount || 0) - Number(a.invoice?.outstandingAmount || 0);
      if (sortBy === "status") return (a.status || "").localeCompare(b.status || "");
      if (sortBy === "oldest") return new Date(getDateIn(a) || 0).getTime() - new Date(getDateIn(b) || 0).getTime();
      return new Date(getDateIn(b) || 0).getTime() - new Date(getDateIn(a) || 0).getTime();
    });
  }, [assignedOnly, endDate, search, sortBy, startDate, userId, workOrders.data]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const paged = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  return (
    <Shell>
      <PageHeader
        title="Work Orders"
        description="Scan jobs, spot due work, and move each order to its next action quickly."
        badge={<Badge variant="secondary">{filtered.length} showing</Badge>}
        actions={
          canUpdateStatus ? (
            <Button asChild size="sm">
              <Link href="/intake">New Intake</Link>
            </Button>
          ) : undefined
        }
      />

      {!showBoard ? (
        <div className="glass p-6 rounded-xl">
          <p className="font-semibold text-foreground">No access</p>
          <p className="text-sm text-muted-foreground">Work order access is required to use this board.</p>
        </div>
      ) : (
        <>
          <div className="glass p-4 rounded-xl mb-4 space-y-3">
            <PageToolbar className="p-0 bg-transparent border-0 shadow-none">
              <PageToolbarSection>
                <SegmentedControl
                  aria-label="Status filter"
                  options={statuses.map((status) => ({ value: status, label: status }))}
                  value={statusFilter}
                  onChange={(val) => {
                    setStatusFilter(val as (typeof statuses)[number]);
                    setPage(1);
                  }}
                />
                <Button
                  variant={showMoreFilters ? "secondary" : "ghost"}
                  onClick={() => setShowMoreFilters((open) => !open)}
                >
                  {showMoreFilters ? "Hide filters" : "More filters"}
                </Button>
                <label className="inline-flex items-center gap-2 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={assignedOnly}
                    onChange={(e) => {
                      setAssignedOnly(e.target.checked);
                      setPage(1);
                    }}
                    className="h-4 w-4 rounded border-border bg-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                  />
                  <span className="text-sm text-muted-foreground">Assigned to me</span>
                </label>
              </PageToolbarSection>
              <PageToolbarSection align="end">
                <Input
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(1);
                  }}
                  placeholder="WO #, complaint, customer, phone, plate, invoice"
                  className="xl:max-w-md"
                />
                <select
                  value={sortBy}
                  onChange={(e) => {
                    setSortBy(e.target.value as typeof sortBy);
                    setPage(1);
                  }}
                  className="rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary md:max-w-[180px]"
                >
                  <option value="recent">Recent</option>
                  <option value="oldest">Oldest</option>
                  <option value="amount">Highest total</option>
                  <option value="due">Highest due</option>
                  <option value="status">Status</option>
                </select>
                {showMoreFilters && (
                  <>
                    <Input
                      type="date"
                      value={startDate}
                      onChange={(e) => {
                        setStartDate(e.target.value);
                        setPage(1);
                      }}
                      className="md:max-w-[170px]"
                    />
                    <Input
                      type="date"
                      value={endDate}
                      onChange={(e) => {
                        setEndDate(e.target.value);
                        setPage(1);
                      }}
                      className="md:max-w-[170px]"
                    />
                  </>
                )}
              </PageToolbarSection>
            </PageToolbar>
          </div>

          {workOrders.isLoading ? (
            <div className="rounded-xl border border-border overflow-hidden">
              <Table>
                <THead>
                  <TR>
                    <TH>WO #</TH>
                    <TH>Customer</TH>
                    <TH>Vehicle</TH>
                    <TH>Status</TH>
                    <TH>Date in</TH>
                    <TH>Date out</TH>
                    <TH>Total</TH>
                    <TH>Due</TH>
                    <TH>Assigned</TH>
                    <TH>Action</TH>
                  </TR>
                </THead>
                <TBody>
                  {Array.from({ length: 8 }).map((_, idx) => (
                    <TR key={idx}>
                      <TD colSpan={10}>
                        <Skeleton className="h-5 w-full" />
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
          ) : workOrders.isError ? (
            <ErrorState
              message={(workOrders.error as Error)?.message || "Unable to load work orders."}
              onRetry={() => workOrders.refetch()}
            />
          ) : filtered.length === 0 ? (
            <EmptyState title="No work orders" description="Try adjusting filters or search terms." />
          ) : (
            <>
              <div className="rounded-xl border border-border overflow-hidden">
                <Table>
                  <THead>
                    <TR>
                      <TH>WO #</TH>
                      <TH>Customer</TH>
                      <TH>Vehicle</TH>
                      <TH>Status</TH>
                      <TH>Date in</TH>
                      <TH>Date out</TH>
                      <TH>Total</TH>
                      <TH>Due</TH>
                      <TH>Assigned</TH>
                      <TH>Action</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {paged.map((wo) => {
                      const warnings = getRowWarnings(wo);
                      const primaryAction = getPrimaryAction(wo);
                      const due = Number(wo.invoice?.outstandingAmount || 0);
                      const assignedCount = wo.assignedEmployees?.length || 0;
                      return (
                        <TR key={wo._id} className={due > 0 ? "bg-amber-500/5" : undefined}>
                          <TD>
                            <div className="space-y-1">
                              <Link
                                href={`/work-orders/${wo._id}`}
                                className="font-semibold text-foreground hover:text-accent"
                              >
                                {wo.workOrderNumber || wo._id}
                              </Link>
                              {wo.isHistorical && <p className="text-[11px] text-accent">Historical</p>}
                            </div>
                          </TD>
                          <TD>
                            <div className="space-y-1">
                              <p className="font-medium text-foreground">{wo.customer?.name || "--"}</p>
                              <p className="text-xs text-muted-foreground">{wo.customer?.phone || "--"}</p>
                            </div>
                          </TD>
                          <TD>
                            <div className="space-y-1">
                              <p className="text-foreground">
                                {wo.vehicle?.make || "--"} {wo.vehicle?.model || ""}
                              </p>
                              <p className="text-xs text-muted-foreground">{wo.vehicle?.plate || "--"}</p>
                            </div>
                          </TD>
                          <TD>
                            <div className="space-y-2">
                              <Badge variant={statusBadgeVariant(wo.status)}>{wo.status || "--"}</Badge>
                              <div className="flex flex-wrap gap-1">
                                {warnings.map((warning) => (
                                  <Badge key={warning} variant="secondary">
                                    {warning}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                          </TD>
                          <TD>{getDateIn(wo) ? new Date(getDateIn(wo)).toLocaleDateString() : "--"}</TD>
                          <TD>{getDateOut(wo) ? new Date(getDateOut(wo)).toLocaleDateString() : "--"}</TD>
                          <TD>
                            <div className="space-y-1">
                              <p className="font-semibold text-foreground">Tk. {formatMoney(wo.invoice?.total)}</p>
                              <p className="text-xs text-muted-foreground">{wo.invoice?.invoiceNumber || "--"}</p>
                            </div>
                          </TD>
                          <TD className={due > 0 ? "font-semibold text-[var(--warning-text)]" : "text-muted-foreground"}>
                            Tk. {formatMoney(wo.invoice?.outstandingAmount)}
                          </TD>
                          <TD>{assignedCount}</TD>
                          <TD>
                            <div className="flex flex-wrap gap-2">
                              <Link
                                href={`/work-orders/${wo._id}`}
                                className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold shadow-sm hover:bg-muted"
                              >
                                Open
                              </Link>
                              {primaryAction.status && canUpdateStatus && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    updateStatus.mutate({ id: wo._id, status: primaryAction.status! })
                                  }
                                  className="px-3 py-1.5 rounded-md bg-primary/80 text-xs font-semibold text-foreground hover:bg-primary"
                                  disabled={updateStatus.isPending}
                                >
                                  {primaryAction.label}
                                </button>
                              )}
                              {primaryAction.label === "Take payment" && (
                                <Link
                                  href={`/work-orders/${wo._id}`}
                                  className="px-3 py-1.5 rounded-md bg-accent text-xs font-semibold text-background hover:brightness-110"
                                >
                                  Take payment
                                </Link>
                              )}
                              {wo.status !== "Closed" && wo.status !== "Canceled" && canUpdateStatus && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setCancelTargetId(wo._id);
                                    setCancelDialogOpen(true);
                                    setCancelError("");
                                  }}
                                  className="px-3 py-1.5 rounded-md bg-muted text-xs font-semibold hover:bg-border"
                                  disabled={updateStatus.isPending}
                                >
                                  Cancel
                                </button>
                              )}
                            </div>
                          </TD>
                        </TR>
                      );
                    })}
                  </TBody>
                </Table>
              </div>

              {pageCount > 1 && (
                <div className="flex items-center justify-between mt-4 text-sm text-muted-foreground">
                  <span>
                    Page {currentPage} of {pageCount}
                  </span>
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                      disabled={currentPage === pageCount}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}

      <Dialog
        open={cancelDialogOpen}
        onClose={() => {
          setCancelDialogOpen(false);
          setCancelTargetId(null);
          setCancelNote("");
          setCancelError("");
        }}
        title="Cancel work order"
        footer={
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setCancelDialogOpen(false);
                setCancelTargetId(null);
                setCancelNote("");
                setCancelError("");
              }}
            >
              Keep open
            </Button>
            <Button
              disabled={updateStatus.isPending}
              onClick={() => {
                const message = cancelNote.trim();
                if (!message) {
                  setCancelError("Cancellation note is required.");
                  return;
                }
                if (!cancelTargetId) return;
                updateStatus.mutate(
                  { id: cancelTargetId, status: "Canceled", note: message },
                  {
                    onSuccess: () => {
                      setCancelDialogOpen(false);
                      setCancelTargetId(null);
                      setCancelNote("");
                      setCancelError("");
                    },
                  }
                );
              }}
            >
              {updateStatus.isPending ? "Canceling..." : "Confirm cancel"}
            </Button>
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
