"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Shell from "../../components/shell";
import api from "../../lib/api-client";
import { useAuth } from "../../lib/auth-context";
import { Input } from "../../components/ui/input";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "../../components/ui/table";
import { PageHeader } from "../../components/page-header";
import { PageToolbar, PageToolbarSection } from "../../components/page-toolbar";

type ExpenseRow = {
  _id: string;
  category?: string;
  amount?: number;
  expenseDate?: string;
  note?: string;
};

const money = (value?: number | string | null) => `Tk. ${Number(value || 0).toFixed(2)}`;

export default function ExpensesPage() {
  const qc = useQueryClient();
  const { session } = useAuth();
  const permissions = session?.user?.permissions || [];
  const canRead = permissions.includes("EXPENSES_READ");
  const canCreate = permissions.includes("EXPENSES_CREATE");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [expense, setExpense] = useState({
    category: "Supplies",
    amount: "",
    expenseDate: new Date().toISOString().slice(0, 10),
    note: "",
  });

  const expenses = useQuery({
    queryKey: ["expenses"],
    queryFn: async () => (await api.get("/expenses")).data as ExpenseRow[],
    enabled: canRead,
  });

  const create = useMutation({
    mutationFn: async () =>
      api.post("/expenses", {
        ...expense,
        amount: Number(expense.amount || 0),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["expenses"] });
      setExpense({
        category: "Supplies",
        amount: "",
        expenseDate: new Date().toISOString().slice(0, 10),
        note: "",
      });
    },
  });

  const categories = useMemo(() => {
    const values = new Set<string>();
    (expenses.data || []).forEach((item) => {
      if (item.category) values.add(item.category);
    });
    return Array.from(values).sort();
  }, [expenses.data]);

  const filteredExpenses = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (expenses.data || []).filter((item) => {
      const matchesSearch = !term
        ? true
        : `${item.category || ""} ${item.note || ""}`.toLowerCase().includes(term);
      const matchesCategory = categoryFilter === "ALL" ? true : item.category === categoryFilter;
      return matchesSearch && matchesCategory;
    });
  }, [categoryFilter, expenses.data, search]);

  const total = filteredExpenses.reduce((sum, item) => sum + Number(item.amount || 0), 0);

  return (
    <Shell>
      <PageHeader
        title="Expenses"
        description="Review operating costs and log new expenses from one place."
        badge={<Badge variant="secondary">{money(total)}</Badge>}
      />

      {!canRead && !canCreate ? (
        <div className="glass rounded-xl p-6">
          <p className="font-semibold text-foreground">No access</p>
          <p className="text-sm text-muted-foreground">Expense access requires the matching finance permissions.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="glass rounded-xl p-4 lg:col-span-2 space-y-4">
            <div className="flex items-center justify-between">
              <p className="font-semibold text-foreground">Expense Ledger</p>
              {expenses.isLoading && <span className="text-xs text-muted-foreground">Loading...</span>}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="rounded-lg border border-border bg-card/50 px-3 py-2">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Filtered total</p>
                <p className="font-semibold text-foreground">{money(total)}</p>
              </div>
              <div className="rounded-lg border border-border bg-card/50 px-3 py-2">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Rows</p>
                <p className="font-semibold text-foreground">{filteredExpenses.length}</p>
              </div>
            </div>
            <PageToolbar className="p-0 bg-transparent border-0 shadow-none">
              <PageToolbarSection>
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Category or note"
                  className="md:max-w-xs"
                />
                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  className="w-full rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground md:max-w-[220px]"
                >
                  <option value="ALL">All categories</option>
                  {categories.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
              </PageToolbarSection>
            </PageToolbar>

            <div className="overflow-x-auto rounded-xl border border-border">
              <Table>
                <THead>
                  <TR>
                    <TH>Date</TH>
                    <TH>Category</TH>
                    <TH>Note</TH>
                    <TH className="text-right">Amount</TH>
                  </TR>
                </THead>
                <TBody>
                  {filteredExpenses.map((item) => (
                    <TR key={item._id}>
                      <TD>{item.expenseDate ? new Date(item.expenseDate).toLocaleDateString() : "--"}</TD>
                      <TD>{item.category || "--"}</TD>
                      <TD className="max-w-[320px] truncate">{item.note || "--"}</TD>
                      <TD className="text-right font-medium">{money(item.amount)}</TD>
                    </TR>
                  ))}
                  {!expenses.isLoading && filteredExpenses.length === 0 && (
                    <TR>
                      <TD colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                        No expenses match the current filters.
                      </TD>
                    </TR>
                  )}
                </TBody>
              </Table>
            </div>
          </div>

          <div className="glass rounded-xl p-4 space-y-3">
            <p className="font-semibold text-foreground">Log Expense</p>
            {!canCreate && <p className="text-sm text-muted-foreground">You need EXPENSES_CREATE permission.</p>}
            <Input
              disabled={!canCreate}
              placeholder="Category"
              value={expense.category}
              onChange={(e) => setExpense((prev) => ({ ...prev, category: e.target.value }))}
            />
            <Input
              disabled={!canCreate}
              type="text"
              inputMode="decimal"
              placeholder="Amount"
              value={expense.amount}
              onChange={(e) => setExpense((prev) => ({ ...prev, amount: e.target.value }))}
            />
            <Input
              disabled={!canCreate}
              type="date"
              value={expense.expenseDate}
              onChange={(e) => setExpense((prev) => ({ ...prev, expenseDate: e.target.value }))}
            />
            <Input
              disabled={!canCreate}
              placeholder="Note"
              value={expense.note}
              onChange={(e) => setExpense((prev) => ({ ...prev, note: e.target.value }))}
            />
            <Button
              className="w-full"
              disabled={!canCreate}
              isLoading={create.isPending}
              onClick={() => create.mutate()}
            >
              Save Expense
            </Button>
            {create.isSuccess && <p className="text-xs text-[var(--success-text)]">Expense saved.</p>}
            {create.isError && (
              <p className="text-xs text-[var(--danger-text)]">{(create.error as Error)?.message || "Failed to save expense."}</p>
            )}
          </div>
        </div>
      )}
    </Shell>
  );
}
