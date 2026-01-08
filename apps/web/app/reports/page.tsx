"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Shell from "../../components/shell";
import api, { getPdfBaseUrl } from "../../lib/api-client";
import { MetricCard } from "../../components/metric-card";
import { BreakdownPie, RevenueLine, BarTrend } from "../../components/report-charts";
import { SegmentedControl } from "../../components/ui/segmented-control";
import { Input } from "../../components/ui/input";
import { EmptyState } from "../../components/ui/empty-state";
import { ErrorState } from "../../components/ui/error-state";
import { ChartSkeleton } from "../../components/ui/chart-skeleton";
import { MetricSkeletonGrid } from "../../components/ui/metric-skeleton";
import { Button } from "../../components/ui/button";
import { Table, THead, TBody, TR, TH, TD } from "../../components/ui/table";
import { useToast } from "../../components/ui/toast";
import { useAuth } from "../../lib/auth-context";
import { calcInvoiceCogs, calcInvoiceRevenue, sumByDate, sumByMonth } from "../../lib/finance";

type ProfitSummary = {
  revenue?: number;
  cogs?: number;
  grossProfit?: number;
  expenses?: number;
  cashExpenses?: number;
  creditPurchases?: number;
  openPayables?: number;
  netProfit?: number;
  expensesBreakdown?: ExpenseRow[];
  payablesBreakdown?: PayableRow[];
};

type InvoiceSummary = {
  _id: string;
  invoiceNumber?: string;
  workOrderId?: string;
  createdAt: string;
  total?: number;
  lineItems?: { type?: string; total?: number }[];
};

type SalesReport = {
  invoices: InvoiceSummary[];
  partsRevenue?: number;
  laborRevenue?: number;
  otherRevenue?: number;
  revenue?: number;
};

type ExpenseRow = {
  _id: string;
  category?: string;
  amount?: number;
  expenseDate?: string;
  note?: string;
};

type PayableRow = {
  _id: string;
  category?: string;
  amount?: number;
  purchaseDate?: string;
  status?: string;
  vendorName?: string;
  qty?: number;
  unitCost?: number;
  createdByName?: string;
  createdByRole?: string;
  note?: string;
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

export default function ReportsPage() {
  const { session } = useAuth();
  const { show: showToast } = useToast();
  const permissions = session?.user?.permissions || [];
  const canReadSales = permissions.includes("REPORTS_READ_SALES");
  const canReadProfit = permissions.includes("REPORTS_READ_PROFIT");
  const canExport = permissions.includes("REPORTS_EXPORT_PDF");
  const canReadPayables = permissions.includes("PAYABLES_READ");
  const [range, setRange] = useState<"day" | "month" | "year" | "all" | "custom">("month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [pdfPending, setPdfPending] = useState(false);

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

  const sales = useQuery({
    queryKey: ["sales", rangeDates.from, rangeDates.to],
    queryFn: async () =>
      (await api.get("/reports/sales", { params: { from: rangeDates.from, to: rangeDates.to } })).data as SalesReport,
    enabled: canReadSales
  });
  const profit = useQuery({
    queryKey: ["profit", rangeDates.from, rangeDates.to],
    queryFn: async () =>
      (await api.get("/reports/profit", { params: { from: rangeDates.from, to: rangeDates.to } })).data as ProfitSummary,
    enabled: canReadProfit
  });
  const canReadExpenses = session?.user?.permissions?.includes("EXPENSES_READ");
  const expensesQuery = useQuery({
    queryKey: ["expenses"],
    queryFn: async () => (await api.get("/expenses")).data as ExpenseRow[],
    enabled: Boolean(canReadExpenses)
  });

  useEffect(() => {
    if ((canReadSales && sales.data) || (canReadProfit && profit.data)) {
      setLastUpdated(new Date());
    }
  }, [canReadProfit, canReadSales, profit.data, sales.data]);

  const salesBusy = canReadSales && (sales.isLoading || sales.isFetching);
  const profitBusy = canReadProfit && (profit.isLoading || profit.isFetching);
  const isLoading = salesBusy || profitBusy;
  const isFetching = (canReadSales && sales.isFetching) || (canReadProfit && profit.isFetching);
  const isBusy = isLoading || isFetching;
  const salesError = canReadSales && sales.isError;
  const profitError = canReadProfit && profit.isError;
  const isError = salesError || profitError;
  const errorMessage =
    (canReadSales ? (sales.error as Error | undefined)?.message : undefined) ||
    (canReadProfit ? (profit.error as Error | undefined)?.message : undefined) ||
    "Unable to load reports.";

  const summary =
    canReadProfit && profit.data
      ? profit.data
      : { revenue: 0, cogs: 0, grossProfit: 0, expenses: 0, netProfit: 0 };
  const invoices = useMemo(
    () => (canReadSales ? sales.data?.invoices || [] : []),
    [canReadSales, sales.data]
  );
  const invoiceCount = invoices.length;
  const revenueTotal = Number(summary.revenue || 0);
  const partsRevenue = Number(sales.data?.partsRevenue || 0);
  const laborRevenue = Number(sales.data?.laborRevenue || 0);
  const otherRevenue = Number(sales.data?.otherRevenue || 0);
  const avgInvoice = invoiceCount ? revenueTotal / invoiceCount : 0;
  const grossMargin = revenueTotal > 0 ? (Number(summary.grossProfit || 0) / revenueTotal) * 100 : 0;
  const cashExpensesTotal = Number(summary.cashExpenses || 0);
  const creditPurchasesTotal = Number(summary.creditPurchases || 0);
  const openPayablesTotal = Number(
    summary.openPayables !== undefined ? summary.openPayables : creditPurchasesTotal
  );
  const expenseSubtitle = canReadPayables
    ? `Cash Tk. ${formatMoney(cashExpensesTotal)} | Open payables Tk. ${formatMoney(openPayablesTotal)}`
    : `Cash Tk. ${formatMoney(cashExpensesTotal)}`;
  const canShowPayables = canReadProfit && canReadPayables;

  const expenseItems = useMemo(() => {
    return (summary.expensesBreakdown || []).map((e) => ({
      date: e.expenseDate || "",
      amount: Number(e.amount || 0)
    }));
  }, [summary.expensesBreakdown]);

  const revenueByDateMap = useMemo(
    () => sumByDate(invoices.map((inv) => ({ date: inv.createdAt, amount: calcInvoiceRevenue(inv) }))),
    [invoices]
  );
  const expensesByDateMap = useMemo(() => sumByDate(expenseItems), [expenseItems]);

  const revenueSeries = useMemo(() => {
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

  const topInvoices = useMemo(() => {
    return [...invoices]
      .sort((a, b) => calcInvoiceRevenue(b) - calcInvoiceRevenue(a))
      .slice(0, 5);
  }, [invoices]);

  const filteredExpenses = useMemo(() => {
    const allExpenses = expensesQuery.data || [];
    if (!rangeDates.from && !rangeDates.to) return allExpenses;
    const from = rangeDates.from ? new Date(rangeDates.from) : null;
    const to = rangeDates.to ? new Date(rangeDates.to) : null;
    return allExpenses.filter((exp) => {
      if (!exp.expenseDate) return false;
      const expenseDate = new Date(exp.expenseDate);
      if (from && expenseDate < from) return false;
      if (to && expenseDate > to) return false;
      return true;
    });
  }, [expensesQuery.data, rangeDates.from, rangeDates.to]);

  const filteredPayables = useMemo(() => {
    const list = summary.payablesBreakdown || [];
    if (!rangeDates.from && !rangeDates.to) return list;
    const from = rangeDates.from ? new Date(rangeDates.from) : null;
    const to = rangeDates.to ? new Date(rangeDates.to) : null;
    return list.filter((p) => {
      if (!p.purchaseDate) return false;
      const purchaseDate = new Date(p.purchaseDate);
      if (from && purchaseDate < from) return false;
      if (to && purchaseDate > to) return false;
      return true;
    });
  }, [rangeDates.from, rangeDates.to, summary.payablesBreakdown]);

  const expensesTotal = filteredExpenses.reduce((sum, exp) => sum + Number(exp.amount || 0), 0);
  const payablesTotal = filteredPayables.reduce((sum, p) => {
    const status = String(p.status || "OPEN").toUpperCase();
    return status === "PAID" ? sum : sum + Number(p.amount || 0);
  }, 0);
  const salesTotal = invoices.reduce((sum, inv) => sum + calcInvoiceRevenue(inv), 0);

  const breakdown = [
    { name: "Parts", value: partsRevenue },
    { name: "Labor", value: laborRevenue },
    { name: "Other", value: otherRevenue }
  ];

  const pdfBase = getPdfBaseUrl();
  const pdfParams = new URLSearchParams();
  if (rangeDates.from) pdfParams.set("from", rangeDates.from);
  if (rangeDates.to) pdfParams.set("to", rangeDates.to);
  const pdfLink = `${pdfBase}/reports/profit-pdf${pdfParams.toString() ? `?${pdfParams.toString()}` : ""}`;
  const exportDisabled = pdfPending || !canReadProfit || !canExport;
  const exportTitle = !canReadProfit
    ? "Profit report access required"
    : !canExport
    ? "Export permission required"
    : undefined;

  const hasData = revenueSeries.some((row) => row.revenue > 0 || row.expenses > 0);
  const hasRevenueData = revenueSeries.some((row) => row.revenue > 0);
  const handleExportPdf = async () => {
    if (pdfPending) return;
    if (!canReadProfit || !canExport) {
      showToast({
        title: "Export unavailable",
        description: "You do not have permission to export profit reports.",
        variant: "error"
      });
      return;
    }
    if (!session?.accessToken) {
      showToast({
        title: "Unable to export",
        description: "Please sign in again to download the report.",
        variant: "error"
      });
      return;
    }
    setPdfPending(true);
    try {
      const res = await fetch(pdfLink, {
        headers: { Authorization: `Bearer ${session.accessToken}` }
      });
      if (!res.ok) {
        throw new Error(`PDF export failed (${res.status})`);
      }
      const data = (await res.json()) as { base64?: string };
      if (!data?.base64) {
        throw new Error("PDF service returned no data");
      }
      const win = window.open("", "_blank");
      if (!win) {
        throw new Error("Popup blocked. Please allow popups and try again.");
      }
      win.document.write(
        `<iframe width='100%' height='100%' src='data:application/pdf;base64,${data.base64}'></iframe>`
      );
    } catch (err) {
      showToast({
        title: "Export failed",
        description: err instanceof Error ? err.message : "Unable to export PDF.",
        variant: "error"
      });
    } finally {
      setPdfPending(false);
    }
  };

  if (!canReadSales && !canReadProfit) {
    return (
      <Shell>
        <div className="glass p-6 rounded-xl text-center">
          <p className="font-semibold text-foreground">You don&apos;t have permission to view reports.</p>
          <p className="text-sm text-muted-foreground">Ask an admin to grant report access.</p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Reports</h1>
          <p className="text-muted-foreground text-sm">Sales, profit, and inventory at a glance.</p>
          <div className="text-xs text-muted-foreground mt-2 flex flex-wrap gap-2">
            <span>Range: {rangeDates.label}</span>
            {lastUpdated && <span title={lastUpdated.toLocaleString()}>Last updated {formatRelative(lastUpdated)}</span>}
            {isBusy && <span className="text-primary">Refreshing...</span>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl
            aria-label="Report range"
            options={[
              { value: "day", label: "Today" },
              { value: "month", label: "This Month" },
              { value: "year", label: "This Year" },
              { value: "all", label: "All Time" },
              { value: "custom", label: "Custom" }
            ]}
            value={range}
            onChange={(val) => setRange(val as typeof range)}
            disabled={isBusy}
          />
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
              disabled={isBusy}
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
              disabled={isBusy}
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
              disabled={isBusy}
            >
              Reset dates
            </Button>
          )}
          <Button onClick={handleExportPdf} disabled={exportDisabled} title={exportTitle}>
            {pdfPending ? "Exporting..." : "Export Profit PDF"}
          </Button>
        </div>
      </div>

      {!canReadProfit ? (
        <EmptyState
          title="Profit data restricted"
          description="Profit and expense KPIs are available to users with profit report access."
        />
      ) : profitBusy ? (
        <MetricSkeletonGrid />
      ) : profitError ? (
        <ErrorState
          message={errorMessage}
          onRetry={() => {
            if (canReadProfit) profit.refetch();
          }}
        />
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            <MetricCard title="Revenue" value={`Tk. ${formatMoney(summary.revenue)}`} />
            <MetricCard title="COGS" value={`Tk. ${formatMoney(summary.cogs)}`} accent="gray" />
            <MetricCard
              title="Expenses (cash)"
              value={`Tk. ${formatMoney(summary.expenses)}`}
              subtitle={expenseSubtitle}
              accent="gray"
            />
            <MetricCard title="Gross Profit" value={`Tk. ${formatMoney(summary.grossProfit)}`} accent="blue" />
            <MetricCard title="Net Profit" value={`Tk. ${formatMoney(summary.netProfit)}`} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="glass p-4 rounded-xl space-y-2">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Invoices closed</p>
              <p className="text-2xl font-semibold text-foreground">{invoiceCount}</p>
              <p className="text-xs text-muted-foreground">Avg invoice Tk. {avgInvoice.toFixed(2)}</p>
            </div>
            <div className="glass p-4 rounded-xl space-y-2">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Gross margin</p>
              <p className="text-2xl font-semibold text-foreground">{grossMargin.toFixed(1)}%</p>
              <p className="text-xs text-muted-foreground">Based on closed invoices</p>
            </div>
            <div className="glass p-4 rounded-xl space-y-2">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Mix</p>
              <p className="text-sm text-muted-foreground">Parts Tk. {formatMoney(partsRevenue)}</p>
              <p className="text-sm text-muted-foreground">Labor Tk. {formatMoney(laborRevenue)}</p>
              <p className="text-sm text-muted-foreground">Other Tk. {formatMoney(otherRevenue)}</p>
            </div>
          </div>
        </>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {!canReadSales || !canReadProfit ? (
          <>
            <EmptyState
              title="Trend data restricted"
              description="Revenue/expense charts require both sales and profit report access."
            />
            <EmptyState
              title="Breakdown restricted"
              description="Revenue breakdown requires sales report access."
            />
          </>
        ) : isLoading ? (
          <>
            <ChartSkeleton />
            <ChartSkeleton />
          </>
        ) : isError ? (
          <ErrorState
            message={errorMessage}
            onRetry={() => {
              if (canReadSales) sales.refetch();
              if (canReadProfit) profit.refetch();
            }}
          />
        ) : !hasData ? (
          <>
            <EmptyState title="No sales yet" description="Revenue trends will appear once invoices are closed." />
            <EmptyState title="No breakdown" description="Revenue breakdown will show after sales are recorded." />
          </>
        ) : (
          <>
            <div className={isBusy ? "opacity-60 pointer-events-none" : ""}>
              <RevenueLine data={revenueSeries} />
            </div>
            {hasRevenueData ? (
              <div className={isBusy ? "opacity-60 pointer-events-none" : ""}>
                <BreakdownPie data={breakdown} />
              </div>
            ) : (
              <EmptyState title="No breakdown" description="Revenue breakdown will show after sales are recorded." />
            )}
          </>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="glass p-4 rounded-xl space-y-3 lg:col-span-2">
          <div className="flex items-center justify-between">
            <p className="font-semibold text-foreground">Top invoices</p>
            <span className="text-xs text-muted-foreground">Highest totals in range</span>
          </div>
          {!canReadSales ? (
            <p className="text-sm text-muted-foreground">Sales data is restricted.</p>
          ) : salesBusy ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, idx) => (
                <div key={idx} className="h-8 rounded-md bg-muted/30" />
              ))}
            </div>
          ) : salesError ? (
            <ErrorState message={errorMessage} onRetry={() => sales.refetch()} />
          ) : invoices.length === 0 ? (
            <p className="text-sm text-muted-foreground">No invoices in this range.</p>
          ) : (
            <div className="space-y-2 text-sm">
              {topInvoices.map((inv) => (
                <div key={inv._id} className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                  <div>
                    <p className="font-semibold text-foreground">{inv.invoiceNumber || inv._id}</p>
                    <p className="text-xs text-muted-foreground">{new Date(inv.createdAt).toLocaleDateString()}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-foreground">Tk. {calcInvoiceRevenue(inv).toFixed(2)}</p>
                    {inv.workOrderId && <p className="text-[11px] text-muted-foreground">WO {inv.workOrderId}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div>
          {!canReadSales || !canReadProfit ? (
            <EmptyState title="Trend restricted" description="Net trends require sales + profit access." />
          ) : isLoading ? (
            <ChartSkeleton />
          ) : !hasData ? (
            <EmptyState title="No trend data yet" description="Monthly totals will appear once invoices are closed." />
          ) : (
            <div className={isBusy ? "opacity-60 pointer-events-none" : ""}>
              <BarTrend data={trendByMonth} />
            </div>
          )}
        </div>
      </div>

      <div className="glass p-4 rounded-xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
          <p className="font-semibold text-foreground">Sales & Expenses</p>
          <p className="text-xs text-muted-foreground">Tables reflect the selected range. Expenses are cash-basis.</p>
          </div>
          <span className="text-xs text-muted-foreground">Range: {rangeDates.label}</span>
        </div>

        <div className="space-y-3">
          <p className="font-semibold text-foreground">Sales</p>
          {!canReadSales ? (
            <p className="text-sm text-muted-foreground">You do not have permission to view sales.</p>
          ) : salesBusy ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, idx) => (
                <div key={idx} className="h-8 rounded-md bg-muted/30" />
              ))}
            </div>
          ) : salesError ? (
            <ErrorState message={errorMessage} onRetry={() => sales.refetch()} />
          ) : invoices.length === 0 ? (
            <EmptyState title="No sales in this range" description="Close invoices to populate sales totals." />
          ) : (
            <div className="rounded-lg border border-border overflow-hidden">
              <Table>
                <THead>
                  <TR>
                    <TH>Date</TH>
                    <TH>Invoice</TH>
                    <TH>Work Order</TH>
                    <TH>Revenue</TH>
                  </TR>
                </THead>
                <TBody>
                  {invoices.map((inv) => (
                    <TR key={inv._id}>
                      <TD>{new Date(inv.createdAt).toLocaleDateString()}</TD>
                      <TD>{inv.invoiceNumber || inv._id}</TD>
                      <TD>{inv.workOrderId || "--"}</TD>
                      <TD className="font-semibold text-foreground">Tk. {calcInvoiceRevenue(inv).toFixed(2)}</TD>
                    </TR>
                  ))}
                  <TR>
                    <TD colSpan={3} className="text-right font-semibold text-foreground">Total</TD>
                    <TD className="font-semibold text-foreground">Tk. {salesTotal.toFixed(2)}</TD>
                  </TR>
                </TBody>
              </Table>
            </div>
          )}
        </div>

        <div className="space-y-3">
          <p className="font-semibold text-foreground">Cash Expenses</p>
          {!canReadExpenses ? (
            <p className="text-sm text-muted-foreground">You do not have permission to view expenses.</p>
          ) : expensesQuery.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, idx) => (
                <div key={idx} className="h-8 rounded-md bg-muted/30" />
              ))}
            </div>
          ) : expensesQuery.isError ? (
            <ErrorState message="Unable to load expenses." onRetry={() => expensesQuery.refetch()} />
          ) : filteredExpenses.length === 0 ? (
            <EmptyState title="No expenses in this range" description="Record expenses to populate this table." />
          ) : (
            <div className="rounded-lg border border-border overflow-hidden">
              <Table>
                <THead>
                  <TR>
                    <TH>Date</TH>
                    <TH>Category</TH>
                    <TH>Note</TH>
                    <TH>Amount</TH>
                  </TR>
                </THead>
                <TBody>
                  {filteredExpenses.map((exp) => (
                    <TR key={exp._id}>
                      <TD>{exp.expenseDate ? new Date(exp.expenseDate).toLocaleDateString() : "--"}</TD>
                      <TD>{exp.category || "Expense"}</TD>
                      <TD>{exp.note || "--"}</TD>
                      <TD className="font-semibold text-foreground">Tk. {Number(exp.amount || 0).toFixed(2)}</TD>
                    </TR>
                  ))}
                  <TR>
                    <TD colSpan={3} className="text-right font-semibold text-foreground">Total</TD>
                    <TD className="font-semibold text-foreground">Tk. {expensesTotal.toFixed(2)}</TD>
                  </TR>
                </TBody>
              </Table>
            </div>
          )}
        </div>

        <div className="space-y-3">
          <p className="font-semibold text-foreground">Payables (Credit Purchases)</p>
          {!canShowPayables ? (
            <div className="glass p-4 rounded-xl text-sm text-muted-foreground">
              Payables are available for users with Payables + Profit report access.
            </div>
          ) : isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, idx) => (
                <div key={idx} className="h-8 rounded-md bg-muted/30" />
              ))}
            </div>
          ) : filteredPayables.length === 0 ? (
            <EmptyState title="No payables in this range" description="Credit purchases will appear here." />
          ) : (
            <div className="rounded-lg border border-border overflow-hidden">
              <Table>
                <THead>
                  <TR>
                    <TH>Date</TH>
                    <TH>Vendor</TH>
                    <TH>Note</TH>
                    <TH>Amount</TH>
                    <TH>Status</TH>
                  </TR>
                </THead>
                <TBody>
                  {filteredPayables.map((p) => (
                    <TR key={p._id}>
                      <TD>{p.purchaseDate ? new Date(p.purchaseDate).toLocaleDateString() : "--"}</TD>
                      <TD>{p.vendorName || "--"}</TD>
                      <TD>{p.note || "--"}</TD>
                      <TD className="font-semibold text-foreground">Tk. {Number(p.amount || 0).toFixed(2)}</TD>
                      <TD>{(p.status || "OPEN").toUpperCase()}</TD>
                    </TR>
                  ))}
                  <TR>
                    <TD colSpan={3} className="text-right font-semibold text-foreground">Open total</TD>
                    <TD className="font-semibold text-foreground">Tk. {payablesTotal.toFixed(2)}</TD>
                    <TD />
                  </TR>
                </TBody>
              </Table>
            </div>
          )}
        </div>
      </div>
    </Shell>
  );
}
