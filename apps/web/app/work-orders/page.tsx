"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Shell from "../../components/shell";
import api from "../../lib/api-client";
import { useMemo, useState } from "react";
import clsx from "clsx";
import { useAuth } from "../../lib/auth-context";
import Link from "next/link";
import { SegmentedControl } from "../../components/ui/segmented-control";
import { EmptyState } from "../../components/ui/empty-state";
import { ErrorState } from "../../components/ui/error-state";
import { Skeleton } from "../../components/ui/skeleton";

const statuses = ["Scheduled", "In Progress", "Waiting Parts", "Completed", "Closed"];

type WorkOrder = {
  _id: string;
  complaint?: string;
  status?: string;
  vehicleId?: string;
  createdAt?: string;
  billableLaborAmount?: number;
  partsUsed?: { sellingPriceAtTime?: number; qty?: number }[];
  otherCharges?: { amount?: number }[];
  assignedEmployees?: { employeeId?: string }[];
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

const summarizeWorkOrder = (wo: WorkOrder) => {
  const labor = Number(wo.billableLaborAmount || 0);
  const partsTotal = (wo.partsUsed || []).reduce((sum, part) => sum + Number(part.sellingPriceAtTime || 0) * (part.qty || 0), 0);
  const otherTotal = (wo.otherCharges || []).reduce((sum, charge) => sum + Number(charge?.amount || 0), 0);
  return {
    labor,
    partsTotal,
    otherTotal,
    total: labor + partsTotal + otherTotal,
  };
};

export default function WorkOrdersPage() {
  const { session } = useAuth();
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>();
  const [search, setSearch] = useState("");
  const [assignedOnly, setAssignedOnly] = useState(false);
  const [sortBy, setSortBy] = useState<"recent" | "oldest" | "amount" | "status">("recent");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [page, setPage] = useState(1);
  const pageSize = 12;

  const role = session?.user?.role;
  const rawUserId = session?.user?.userId || (session?.user as { _id?: string } | undefined)?._id;
  const userId = useMemo(() => normalizeId(rawUserId), [rawUserId]);
  const canReadAll = session?.user?.permissions?.includes("WORKORDERS_READ_ALL");
  const canReadAssigned = session?.user?.permissions?.includes("WORKORDERS_READ_ASSIGNED");
  const canUpdateStatus = session?.user?.permissions?.includes("WORKORDERS_UPDATE_STATUS");
  const isTechOrPainter = role === "TECHNICIAN" || role === "PAINTER";
  const filterStatuses = isTechOrPainter
    ? ["Scheduled", "In Progress", "Waiting Parts"]
    : statuses;
  const updateStatuses = isTechOrPainter
    ? ["In Progress", "Waiting Parts", "Completed"]
    : statuses;
  const showBoard = canReadAll || canReadAssigned;

  const workOrders = useQuery({
    queryKey: ["work-orders", statusFilter],
    queryFn: async () => {
      const res = await api.get("/work-orders", {
        params: { status: statusFilter },
      });
      return res.data;
    },
    enabled: showBoard,
  });

  const updateStatus = useMutation({
    mutationFn: (payload: { id: string; status: string }) =>
      api.patch(`/work-orders/${payload.id}/status`, {
        status: payload.status,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["work-orders"] }),
  });

  // Additional filters are applied client-side to avoid changing backend query semantics (status is server-filtered).
  const filtered = useMemo(() => {
    const items: WorkOrder[] = (workOrders.data as WorkOrder[]) || [];
    const term = search.trim().toLowerCase();
    const start = startDate ? new Date(startDate) : null;
    const end = endDate ? new Date(endDate) : null;

    const bySearch = term
      ? items.filter((wo) => {
          const haystack = `${wo.complaint || ""} ${wo.vehicleId || ""} ${wo._id}`.toLowerCase();
          return haystack.includes(term);
        })
      : items;

    const byAssigned =
      assignedOnly && userId
        ? bySearch.filter((wo) =>
          (wo.assignedEmployees || []).some(
            (a) =>
                a.employeeId &&
                normalizeId(a.employeeId) === userId
          )
        )
        : bySearch;

    const byDate = byAssigned.filter((wo) => {
      if (!wo.createdAt || (!start && !end)) return true;
      const created = new Date(wo.createdAt);
      if (start && created < start) return false;
      if (end) {
        const endOfDay = new Date(end);
        endOfDay.setHours(23, 59, 59, 999);
        if (created > endOfDay) return false;
      }
      return true;
    });

    const sorted = [...byDate].sort((a, b) => {
      if (sortBy === "amount") {
        return summarizeWorkOrder(b).total - summarizeWorkOrder(a).total;
      }
      if (sortBy === "status") {
        return (a.status || "").localeCompare(b.status || "");
      }
      if (sortBy === "oldest") {
        return new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
      }
      // recent default
      return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
    });

    return sorted;
  }, [workOrders.data, search, assignedOnly, startDate, endDate, sortBy, userId]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const paged = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  return (
    <Shell>
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Work Orders</h1>
          <p className="text-muted-foreground text-sm">
            Track assignments, billing, and progress in one place.
          </p>
        </div>
        {showBoard && (
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-xs text-muted-foreground">Status</span>
            <SegmentedControl
              aria-label="Status filter"
              options={filterStatuses.map((s) => ({ value: s, label: s }))}
              value={statusFilter || ""}
              onChange={(val) => {
                setStatusFilter(val === statusFilter ? undefined : val);
                setPage(1);
              }}
            />
          </div>
        )}
      </div>

      {!showBoard ? (
        <div className="glass p-6 rounded-xl">
          <p className="font-semibold">View-only</p>
          <p className="text-sm text-white/60">You do not have work order access for this board.</p>
        </div>
      ) : (
        <>
          <div className="glass p-4 rounded-xl mb-4 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              <label className="flex flex-col gap-1 text-sm text-muted-foreground">
                <span>Search</span>
                <input
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(1);
                  }}
                  placeholder="Search complaint, vehicle, or WO #"
                  className="rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-muted-foreground">
                <span>Sort</span>
                <select
                  value={sortBy}
                  onChange={(e) => {
                    setSortBy(e.target.value as typeof sortBy);
                    setPage(1);
                  }}
                  className="rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                >
                  <option value="recent">Recent</option>
                  <option value="oldest">Oldest</option>
                  <option value="amount">Amount (high to low)</option>
                  <option value="status">Status</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm text-muted-foreground">
                <span>Start date</span>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => {
                    setStartDate(e.target.value);
                    setPage(1);
                  }}
                  className="rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-muted-foreground">
                <span>End date</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => {
                    setEndDate(e.target.value);
                    setPage(1);
                  }}
                  className="rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                />
              </label>
            </div>
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
          </div>

          {workOrders.isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {Array.from({ length: 6 }).map((_, idx) => (
                <div key={idx} className="glass p-4 rounded-xl space-y-3 border border-border/60">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-6 w-32" />
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ))}
            </div>
          ) : workOrders.isError ? (
            <ErrorState
              message={(workOrders.error as Error)?.message || "Unable to load work orders."}
              onRetry={() => workOrders.refetch()}
            />
          ) : filtered.length === 0 ? (
            <EmptyState title="No work orders" description="Try adjusting filters or date range." />
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {paged.map((wo) => {
                  const summary = summarizeWorkOrder(wo);
                  const assignedCount = wo.assignedEmployees?.length || 0;
                  return (
                    <div key={wo._id} className="glass p-4 rounded-xl space-y-3 border border-border/60">
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1">
                          <Link href={`/work-orders/${wo._id}`} className="block hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary rounded">
                            <p className="font-semibold">{wo.complaint || "General service"}</p>
                          </Link>
                          <p className="text-xs text-muted-foreground">WO #{wo._id}</p>
                          <p className="text-xs text-muted-foreground">Vehicle #{wo.vehicleId || "N/A"}</p>
                          {wo.createdAt && (
                            <p className="text-[11px] text-muted-foreground">
                              Created {new Date(wo.createdAt).toLocaleDateString()}
                            </p>
                          )}
                        </div>
                        <div className="text-right space-y-1">
                          <span className="text-[11px] px-2 py-1 rounded bg-white/10 inline-block">{wo.status}</span>
                          <p className="text-lg font-semibold text-foreground">Tk. {formatMoney(summary.total)}</p>
                          <p className="text-[11px] text-muted-foreground">
                            Parts Tk. {formatMoney(summary.partsTotal)} | Labor Tk. {formatMoney(summary.labor)}
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                        <span className="rounded-full border border-border px-2 py-1">Parts {wo.partsUsed?.length || 0}</span>
                        <span className="rounded-full border border-border px-2 py-1">
                          Other Tk. {formatMoney(summary.otherTotal)}
                        </span>
                        <span className="rounded-full border border-border px-2 py-1">Assigned {assignedCount}</span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Link
                          href={`/work-orders/${wo._id}`}
                          className="px-3 py-2 rounded-md bg-white/10 text-sm font-semibold hover:bg-white/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                        >
                          Open
                        </Link>
                        {updateStatuses.map((s) => (
                          <button
                            key={s}
                            disabled={!canUpdateStatus || updateStatus.isPending}
                            onClick={() => updateStatus.mutate({ id: wo._id, status: s })}
                            className={clsx(
                              "px-2 py-1 rounded text-[11px] disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary",
                              wo.status === s ? "bg-brand.red/80 text-white" : "bg-white/10 hover:bg-white/15"
                            )}
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
              {pageCount > 1 && (
                <div className="flex items-center justify-between mt-4 text-sm text-muted-foreground">
                  <span>
                    Page {currentPage} of {pageCount}
                  </span>
                  <div className="flex gap-2">
                    <button
                      className="px-3 py-1 rounded border border-border bg-muted hover:bg-border focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50"
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                    >
                      Previous
                    </button>
                    <button
                      className="px-3 py-1 rounded border border-border bg-muted hover:bg-border focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50"
                      onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                      disabled={currentPage === pageCount}
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}
    </Shell>
  );
}
