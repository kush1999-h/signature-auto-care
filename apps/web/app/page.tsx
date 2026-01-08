"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../lib/auth-context";
import Shell from "../components/shell";
import { MetricCard } from "../components/metric-card";
import { BreakdownPie, RevenueLine, BarTrend } from "../components/report-charts";
import { useMutation, useQuery } from "@tanstack/react-query";
import api from "../lib/api-client";
import { Button } from "../components/ui/button";
import { useDebounce } from "../lib/use-debounce";
import { SegmentedControl } from "../components/ui/segmented-control";
import { EmptyState } from "../components/ui/empty-state";
import { ErrorState } from "../components/ui/error-state";
import { ChartSkeleton } from "../components/ui/chart-skeleton";
import { MetricSkeletonGrid } from "../components/ui/metric-skeleton";
import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";
import { Input } from "../components/ui/input";
import { calcInvoiceCogs, calcInvoiceRevenue, sumByDate, sumByMonth } from "../lib/finance";

type ProfitReport = {
  revenue?: number;
  cogs?: number;
  grossProfit?: number;
  expenses?: number;
  cashExpenses?: number;
  creditPurchases?: number;
  openPayables?: number;
  netProfit?: number;
  expensesBreakdown?: { amount?: number; expenseDate?: string }[];
  payablesBreakdown?: { amount?: number; purchaseDate?: string; status?: string }[];
};

type InvoiceSummary = {
  _id: string;
  createdAt: string;
  total: number;
  tax?: number;
  lineItems?: { type?: string; total?: number; quantity?: number; costAtTime?: number }[];
};

function formatRelative(date: Date) {
  const diffSeconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diffSeconds < 60) return "just now";
  if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)}m ago`;
  if (diffSeconds < 86400) return `${Math.floor(diffSeconds / 3600)}h ago`;
  return `${Math.floor(diffSeconds / 86400)}d ago`;
}

const parseDateInput = (value: string, endOfDay: boolean) => {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (endOfDay) {
    date.setUTCHours(23, 59, 59, 999);
  } else {
    date.setUTCHours(0, 0, 0, 0);
  }
  return date;
};

const formatMoney = (value?: number) => {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num.toFixed(2) : "0.00";
};

export default function Dashboard() {
  const { session } = useAuth();
  const router = useRouter();
  const role = session?.user?.role;
  const permissions = session?.user?.permissions || [];
  const canReadProfit = permissions.includes("REPORTS_READ_PROFIT");
  const canReadSales = permissions.includes("REPORTS_READ_SALES");
  const canReadPayables = permissions.includes("PAYABLES_READ");
  const canViewReports = canReadProfit || canReadSales;
  const isAdminLike = ["OWNER_ADMIN", "OPS_MANAGER"].includes(role || "");
  const isAccountant = role === "ACCOUNTANT";
  const canShowAdminDashboard = isAdminLike || isAccountant || canViewReports;
  const isServiceAdvisor = role === "SERVICE_ADVISOR";
  const isInventoryManager = role === "INVENTORY_MANAGER";
  const isTechOrPainter = role === "TECHNICIAN" || role === "PAINTER";
  const isOwner = role === "OWNER_ADMIN";

  useEffect(() => {
    if (!session?.accessToken) {
      router.push("/login");
    }
  }, [session, router]);

  const [range, setRange] = useState<"day" | "month" | "year" | "all" | "custom">("month");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const rangeDates = useMemo(() => {
    const now = new Date();
    if (range === "day") {
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      return { from: start.toISOString(), to: now.toISOString(), label: "Today" };
    }
    if (range === "month") {
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      return { from: start.toISOString(), to: now.toISOString(), label: "This Month" };
    }
    if (range === "year") {
      const start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
      return { from: start.toISOString(), to: now.toISOString(), label: "This Year" };
    }
    if (range === "custom") {
      const fromDate = parseDateInput(customFrom, false);
      const toDate = parseDateInput(customTo || customFrom, true);
      const label = fromDate
        ? customTo
          ? `${customFrom} to ${customTo}`
          : customFrom
        : "Custom";
      return { from: fromDate?.toISOString(), to: toDate?.toISOString(), label };
    }
    return { from: undefined, to: undefined, label: "All Time" };
  }, [customFrom, customTo, range]);

  const profitQuery = useQuery({
    queryKey: ["profit", rangeDates.from, rangeDates.to],
    queryFn: async () => {
      const res = await api.get("/reports/profit", { params: { from: rangeDates.from, to: rangeDates.to } });
      return res.data as ProfitReport;
    },
    enabled: canShowAdminDashboard && canReadProfit
  });

  const salesQuery = useQuery({
    queryKey: ["sales", rangeDates.from, rangeDates.to],
    queryFn: async () => {
      const res = await api.get("/reports/sales", { params: { from: rangeDates.from, to: rangeDates.to } });
      return res.data as { invoices: InvoiceSummary[]; partsRevenue?: number; laborRevenue?: number; otherRevenue?: number; revenue?: number };
    },
    enabled: canShowAdminDashboard && canReadSales
  });

  useEffect(() => {
    if ((canReadProfit && profitQuery.data) || (canReadSales && salesQuery.data)) {
      setLastUpdated(new Date());
    }
  }, [canReadProfit, canReadSales, profitQuery.data, salesQuery.data]);

  const reportRaw = canReadProfit && profitQuery.data ? profitQuery.data : {};
  const revenueVal = reportRaw.revenue ?? 0;
  const cogsVal = reportRaw.cogs ?? 0;
  const grossVal = reportRaw.grossProfit ?? revenueVal - cogsVal;
  const cashExpensesVal =
    typeof reportRaw.cashExpenses === "number" ? reportRaw.cashExpenses : 0;
  const creditPurchasesVal =
    typeof reportRaw.creditPurchases === "number" ? reportRaw.creditPurchases : 0;
  const openPayablesVal =
    typeof reportRaw.openPayables === "number" ? reportRaw.openPayables : creditPurchasesVal;
  const expensesVal =
    typeof reportRaw.expenses === "number" ? reportRaw.expenses : cashExpensesVal;
  const netVal = reportRaw.netProfit ?? grossVal - expensesVal;
  const report = {
    revenue: revenueVal,
    cogs: cogsVal,
    grossProfit: grossVal,
    expenses: expensesVal,
    cashExpenses: cashExpensesVal,
    creditPurchases: creditPurchasesVal,
    openPayables: openPayablesVal,
    netProfit: netVal
  };

  const invoices = useMemo(
    () => (canReadSales ? (salesQuery.data?.invoices || []) : []),
    [canReadSales, salesQuery.data]
  );
  const pieData = [
    { name: "Parts", value: salesQuery.data?.partsRevenue || 0 },
    { name: "Labor", value: salesQuery.data?.laborRevenue || 0 },
    {
      name: "Other",
      value: salesQuery.data?.otherRevenue || 0
    }
  ];

  const expenseItems = useMemo(() => {
    return (reportRaw.expensesBreakdown || []).map((e) => ({
      date: e.expenseDate || "",
      amount: Number(e.amount || 0)
    }));
  }, [reportRaw.expensesBreakdown]);

  const revenueSeries = useMemo(() => {
    const revenueItems = invoices.map((inv) => ({
      date: inv.createdAt,
      amount: calcInvoiceRevenue(inv)
    }));
    const revenueMap = sumByDate(revenueItems);
    return Object.entries(revenueMap)
      .map(([date, revenue]) => ({ date, revenue }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [invoices]);

  const expensesByDateMap = useMemo(() => sumByDate(expenseItems), [expenseItems]);
  const revenueByDateMap = useMemo(
    () => sumByDate(invoices.map((inv) => ({ date: inv.createdAt, amount: calcInvoiceRevenue(inv) }))),
    [invoices]
  );
  const revenueVsExpenses = useMemo(() => {
    const dates = Array.from(
      new Set([...Object.keys(revenueByDateMap), ...Object.keys(expensesByDateMap)])
    ).sort();
    return dates.map((date) => ({
      date,
      revenue: revenueByDateMap[date] || 0,
      expenses: expensesByDateMap[date] || 0
    }));
  }, [expensesByDateMap, revenueByDateMap]);

  const trendByMonth = useMemo(() => {
    const revenueMap = sumByMonth(
      invoices.map((inv) => ({ date: inv.createdAt, amount: calcInvoiceRevenue(inv) }))
    );
    const cogsMap = sumByMonth(
      invoices.map((inv) => ({ date: inv.createdAt, amount: calcInvoiceCogs(inv) }))
    );
    const expenseMap = sumByMonth(expenseItems);
    const months = Array.from(
      new Set([...Object.keys(revenueMap), ...Object.keys(cogsMap), ...Object.keys(expenseMap)])
    ).sort();
    return months.map((name) => ({
      name,
      net: (revenueMap[name] || 0) - (cogsMap[name] || 0) - (expenseMap[name] || 0)
    }));
  }, [expenseItems, invoices]);

  const hasSalesData = invoices.length > 0 || pieData.some((p) => p.value > 0);
  const hasLineData = revenueVsExpenses.some((row) => row.revenue > 0 || row.expenses > 0);
  const salesBusy = canReadSales && (salesQuery.isLoading || salesQuery.isFetching);
  const profitBusy = canReadProfit && (profitQuery.isLoading || profitQuery.isFetching);
  const isInitialLoadingCharts = salesBusy || profitBusy;
  const isFetchingCharts = (canReadSales && salesQuery.isFetching) || (canReadProfit && profitQuery.isFetching);
  const isBusyCharts = isInitialLoadingCharts || isFetchingCharts;
  const isErrorCharts = (canReadSales && salesQuery.isError) || (canReadProfit && profitQuery.isError);
  const chartErrorMessage =
    (canReadProfit ? (profitQuery.error as Error | undefined)?.message : undefined) ||
    (canReadSales ? (salesQuery.error as Error | undefined)?.message : undefined) ||
    "Unable to load reports.";
  const canViewCharts = canReadSales && canReadProfit;

  const kpiTrend = useMemo(() => {
    if (revenueSeries.length < 2) return { direction: "flat" as const, change: 0 };
    const current = revenueSeries[revenueSeries.length - 1]?.revenue ?? 0;
    const previous = revenueSeries[revenueSeries.length - 2]?.revenue ?? 0;
    if (previous === 0) return { direction: "up" as const, change: 100 };
    const change = ((current - previous) / previous) * 100;
    if (Math.abs(change) < 1) return { direction: "flat" as const, change };
    return { direction: change > 0 ? ("up" as const) : ("down" as const), change };
  }, [revenueSeries]);

  const [woStatusFilter] = useState("Scheduled");
  const workOrders = useQuery({
    queryKey: ["wo-scheduled-mini", woStatusFilter],
    queryFn: async () => (await api.get("/work-orders", { params: { status: woStatusFilter } })).data,
    enabled: isTechOrPainter || isServiceAdvisor
  });

  const [inventorySearch, setInventorySearch] = useState("");
  const debouncedInv = useDebounce(inventorySearch, 250);
  const inventoryLookup = useQuery({
    queryKey: ["inventory-mini", debouncedInv],
    queryFn: async () => (await api.get("/parts", { params: { search: debouncedInv, limit: 5 } })).data,
    enabled: isTechOrPainter && debouncedInv.length > 1
  });

  const [purgeConfirm, setPurgeConfirm] = useState("");
  const purgeData = useMutation({
    mutationFn: async () => (await api.post("/admin/purge")).data
  });

  const renderTrendIcon = () => {
    if (kpiTrend.direction === "up") return <ArrowUpRight className="h-4 w-4 text-green-400" aria-hidden />;
    if (kpiTrend.direction === "down") return <ArrowDownRight className="h-4 w-4 text-destructive" aria-hidden />;
    return <ArrowRight className="h-4 w-4 text-muted-foreground" aria-hidden />;
  };

  const adminDashboard = (
    <>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <SegmentedControl
          aria-label="Dashboard range"
          options={[
            { value: "day", label: "Today" },
            { value: "month", label: "This Month" },
            { value: "year", label: "This Year" },
            { value: "all", label: "All Time" },
            { value: "custom", label: "Custom" }
          ]}
          value={range}
          onChange={(val) => setRange(val as typeof range)}
          disabled={isBusyCharts}
        />
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-[11px] text-muted-foreground">
            <span>From</span>
            <Input
              type="date"
              value={customFrom}
              onChange={(e) => {
                setCustomFrom(e.target.value);
                setRange("custom");
              }}
              className="mt-1 h-8"
              disabled={isBusyCharts}
            />
          </label>
          <label className="text-[11px] text-muted-foreground">
            <span>To</span>
            <Input
              type="date"
              value={customTo}
              onChange={(e) => {
                setCustomTo(e.target.value);
                setRange("custom");
              }}
              className="mt-1 h-8"
              disabled={isBusyCharts}
            />
          </label>
          {(customFrom || customTo) && (
            <Button
              variant="ghost"
              className="h-8"
              onClick={() => {
                setCustomFrom("");
                setCustomTo("");
                setRange("month");
              }}
              disabled={isBusyCharts}
            >
              Reset dates
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Range: {rangeDates.label}</span>
          {lastUpdated && (
            <span title={lastUpdated.toLocaleString()}>
              Last updated {formatRelative(lastUpdated)}
            </span>
          )}
          {isBusyCharts && <span className="text-primary">Loading...</span>}
        </div>
      </div>

      {!canReadProfit ? (
        <EmptyState title="Profit data restricted" description="Profit KPIs require profit report access." />
      ) : isInitialLoadingCharts ? (
        <MetricSkeletonGrid />
      ) : profitQuery.isError ? (
        <ErrorState message={chartErrorMessage} onRetry={() => profitQuery.refetch()} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard
            title="Revenue"
            value={`Tk. ${formatMoney(report.revenue || 0)}`}
            subtitle="Labor + parts + other"
            meta={
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                {renderTrendIcon()}
                <span>{kpiTrend.change.toFixed(1)}%</span>
              </div>
            }
          />
          <MetricCard title="COGS" value={`Tk. ${formatMoney(report.cogs || 0)}`} accent="gray" />
          <MetricCard title="Gross Profit" value={`Tk. ${formatMoney(report.grossProfit || 0)}`} accent="blue" />
          <MetricCard title="Net Profit" value={`Tk. ${formatMoney(report.netProfit || 0)}`} />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
        {!canViewCharts ? (
          <>
            <EmptyState
              title="Charts restricted"
              description="Revenue/expense charts require sales + profit report access."
            />
            <EmptyState title="Breakdown restricted" description="Revenue breakdown requires sales access." />
          </>
        ) : isErrorCharts ? (
          <ErrorState
            message={chartErrorMessage}
            onRetry={() => {
              if (canReadProfit) profitQuery.refetch();
              if (canReadSales) salesQuery.refetch();
            }}
          />
        ) : isInitialLoadingCharts ? (
          <>
            <ChartSkeleton />
            <ChartSkeleton />
          </>
        ) : !hasLineData ? (
          <>
            <EmptyState title="No data for selected range" description="Try a different date range or create new work orders." />
            <EmptyState title="No breakdown available" description="Revenue breakdown will appear once invoices are created." />
          </>
        ) : (
          <>
            <div className={isBusyCharts ? "opacity-60 pointer-events-none" : ""}>
              <RevenueLine data={revenueVsExpenses} />
            </div>
            {hasSalesData ? (
              <div className={isBusyCharts ? "opacity-60 pointer-events-none" : ""}>
                <BreakdownPie data={pieData} />
              </div>
            ) : (
              <EmptyState title="No breakdown available" description="Revenue breakdown will appear once invoices are created." />
            )}
          </>
        )}
      </div>
      <div className="mt-4">
        {!canViewCharts ? (
          <EmptyState title="Trend restricted" description="Net trend requires sales + profit access." />
        ) : isErrorCharts ? null : isInitialLoadingCharts ? (
          <ChartSkeleton />
        ) : trendByMonth.length === 0 ? (
          <EmptyState title="No trend yet" description="Net trend will appear after invoices are closed." />
        ) : (
          <div className={isBusyCharts ? "opacity-60 pointer-events-none" : ""}>
            <BarTrend data={trendByMonth} />
          </div>
        )}
      </div>

      {canShowAdminDashboard && (
        <div className="glass mt-6 p-4 rounded-xl space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold text-foreground">Accounts</p>
              <p className="text-sm text-muted-foreground">Receivables, expenses, and closures</p>
            </div>
            <div className="flex gap-2">
              <Button asChild variant="secondary">
                <a href="/expenses">Expenses</a>
              </Button>
              <Button asChild variant="secondary">
                <a href="/reports">Reports</a>
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Expenses are cash-basis. Payables track credit purchases separately.
            {canReadPayables && report.openPayables > 0
              ? ` Open payables: Tk. ${formatMoney(report.openPayables)}.`
              : ""}
          </p>
        </div>
      )}
      {isOwner && (
        <div className="glass mt-4 p-4 rounded-xl space-y-3 border border-red-900/60 bg-red-950/20">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold text-foreground">Danger zone</p>
              <p className="text-sm text-muted-foreground">Delete all business data except users.</p>
            </div>
            {purgeData.isSuccess && <span className="text-xs text-green-400">Purged</span>}
          </div>
          <p className="text-xs text-red-200">
            This removes customers, vehicles, parts, work orders, time logs, invoices, payments, expenses, audit logs, and inventory transactions.
            Users are preserved.
          </p>
          <input
            value={purgeConfirm}
            onChange={(e) => setPurgeConfirm(e.target.value)}
            placeholder='Type "DELETE" to confirm'
            className="w-full rounded-md border border-red-800 bg-red-900/30 px-3 py-2 text-sm"
          />
          <Button
            variant="danger"
            className="w-full"
            disabled={purgeConfirm !== "DELETE" || purgeData.isPending}
            onClick={() => purgeData.mutate()}
          >
            {purgeData.isPending ? "Purging..." : "Delete all data (keep users)"}
          </Button>
          {purgeData.isError && (
            <p className="text-xs text-red-300">
              {(purgeData.error as Error)?.message || "Purge failed. Only OWNER_ADMIN may run this."}
            </p>
          )}
        </div>
      )}
    </>
  );

  const serviceAdvisorDashboard = (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="glass p-4 rounded-xl space-y-2">
          <p className="font-semibold text-foreground">Counter Sales</p>
          <p className="text-sm text-muted-foreground">Quick checkout for walk-ins.</p>
          <Button asChild className="w-full">
            <a href="/counter-sale">Open counter sale</a>
          </Button>
        </div>
        <div className="glass p-4 rounded-xl space-y-2">
          <p className="font-semibold text-foreground">Intake</p>
          <p className="text-sm text-muted-foreground">Create intake; new WO auto-scheduled.</p>
          <Button asChild variant="secondary" className="w-full">
            <a href="/intake">Start intake</a>
          </Button>
        </div>
        <div className="glass p-4 rounded-xl space-y-2">
          <p className="font-semibold text-foreground">Service Orders</p>
          <p className="text-sm text-muted-foreground">Manage scheduled & completed jobs; bill to close.</p>
          <Button asChild variant="outline" className="w-full">
            <a href="/work-orders">Go to work orders</a>
          </Button>
        </div>
      </div>
      <div className="glass p-4 rounded-xl space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-semibold text-foreground">Scheduled Work Orders</p>
            <p className="text-sm text-muted-foreground">Stay ahead of today&apos;s visits.</p>
          </div>
          <Button asChild variant="secondary">
            <a href="/work-orders">View board</a>
          </Button>
        </div>
        <div className="space-y-2">
          {(workOrders.data || []).slice(0, 5).map((wo: { _id: string; complaint?: string; status?: string }) => (
            <a key={wo._id} href={`/work-orders/${wo._id}`} className="block rounded-lg border border-border px-3 py-2 hover:bg-card">
              <p className="font-semibold text-foreground">{wo.complaint || "Service order"}</p>
              <p className="text-xs text-muted-foreground">WO #{wo._id} - Status: {wo.status}</p>
            </a>
          ))}
          {workOrders.isLoading && <p className="text-sm text-muted-foreground">Loading work orders...</p>}
          {!workOrders.isLoading && (workOrders.data || []).length === 0 && (
            <p className="text-sm text-muted-foreground">No scheduled work orders.</p>
          )}
        </div>
      </div>
      <div className="glass p-4 rounded-xl space-y-3">
        <p className="font-semibold text-foreground">Inventory lookup</p>
        <p className="text-sm text-muted-foreground">Search and view availability.</p>
        <Button asChild variant="outline" className="w-full">
          <a href="/inventory">Open inventory</a>
        </Button>
      </div>
    </div>
  );

  const techDashboard = (
    <div className="space-y-6">
      <div className="glass p-4 rounded-xl space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-semibold text-foreground">Assigned / Scheduled</p>
            <p className="text-sm text-muted-foreground">Update to In Progress, Waiting Parts, or Completed.</p>
          </div>
          <Button asChild size="sm" variant="secondary">
            <a href="/work-orders">Work orders</a>
          </Button>
        </div>
      </div>
      <div className="glass p-4 rounded-xl space-y-3">
        <p className="font-semibold text-foreground">Tech view</p>
        <p className="text-sm text-muted-foreground">Status and clock-in/out controls are inside each work order.</p>
        <Button asChild variant="outline">
          <a href="/inventory">View inventory</a>
        </Button>
      </div>
    </div>
  );

  const inventoryManagerDashboard = (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="glass p-4 rounded-xl space-y-2">
          <p className="font-semibold text-foreground">Create Parts</p>
          <p className="text-sm text-muted-foreground">Maintain SKUs and pricing.</p>
          <Button asChild className="w-full">
            <a href="/inventory">Open inventory</a>
          </Button>
        </div>
        <div className="glass p-4 rounded-xl space-y-2">
          <p className="font-semibold text-foreground">Receive Stock</p>
          <p className="text-sm text-muted-foreground">Post vendor receipts.</p>
          <Button asChild variant="secondary" className="w-full">
            <a href="/inventory">Receive items</a>
          </Button>
        </div>
        <div className="glass p-4 rounded-xl space-y-2">
          <p className="font-semibold text-foreground">Adjust / Issue</p>
          <p className="text-sm text-muted-foreground">Adjust, issue to WO, or view ledger.</p>
          <Button asChild variant="outline" className="w-full">
            <a href="/inventory">Adjust stock</a>
          </Button>
        </div>
      </div>
      <div className="glass p-4 rounded-xl space-y-3">
        <p className="font-semibold text-foreground">Inventory lookup</p>
        <input
          value={inventorySearch}
          onChange={(e) => setInventorySearch(e.target.value)}
          placeholder="Search SKU or name"
          className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground"
        />
        <div className="space-y-2">
          {inventoryLookup.isLoading && <p className="text-sm text-muted-foreground">Searching...</p>}
          {(inventoryLookup.data?.items || []).map((p: { _id: string; partName: string; sku: string; availableQty?: number }) => {
            const available = p.availableQty ?? 0;
            return (
              <div key={p._id} className="rounded-lg border border-border px-3 py-2 text-sm">
                <p className="font-semibold text-foreground">{p.partName}</p>
                <p className="text-xs text-muted-foreground">SKU {p.sku} - Available {available}</p>
              </div>
            );
          })}
          {debouncedInv.length > 1 && !inventoryLookup.isLoading && (inventoryLookup.data?.items || []).length === 0 && (
            <p className="text-sm text-muted-foreground">No parts found.</p>
          )}
        </div>
      </div>
    </div>
  );

  let content = adminDashboard;
  if (isServiceAdvisor) content = serviceAdvisorDashboard;
  if (isTechOrPainter) content = techDashboard;
  if (isInventoryManager) content = inventoryManagerDashboard;
  if (!canShowAdminDashboard && !isServiceAdvisor && !isInventoryManager && !isTechOrPainter) {
    content = (
      <div className="glass p-6 rounded-xl">
        <p className="font-semibold text-foreground">Welcome</p>
        <p className="text-sm text-muted-foreground">Select a module from the left to get started.</p>
      </div>
    );
  }

  return <Shell>{content}</Shell>;
}
