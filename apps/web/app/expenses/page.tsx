"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import Shell from "../../components/shell";
import api from "../../lib/api-client";

export default function ExpensesPage() {
  const qc = useQueryClient();
  const [expense, setExpense] = useState({ category: "Supplies", amount: 0, expenseDate: new Date().toISOString().slice(0, 10), note: "" });
  const expenses = useQuery({
    queryKey: ["expenses"],
    queryFn: async () => (await api.get("/expenses")).data
  });

  const create = useMutation({
    mutationFn: async () => api.post("/expenses", expense),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["expenses"] });
      setExpense({ category: "Supplies", amount: 0, expenseDate: new Date().toISOString().slice(0, 10), note: "" });
    }
  });

  return (
    <Shell>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold">Expenses</h1>
          <p className="text-white/60 text-sm">Track shop costs for profit clarity.</p>
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="glass p-4 rounded-xl lg:col-span-2 space-y-3">
          {(expenses.data || []).map((exp: any) => (
            <div key={exp._id} className="flex items-center justify-between bg-white/5 rounded-lg px-3 py-2">
              <div>
                <p className="font-semibold">{exp.category}</p>
                <p className="text-xs text-white/60">{new Date(exp.expenseDate).toLocaleDateString()}</p>
              </div>
              <div className="text-right">
                <p className="text-sm">Tk. {exp.amount?.toFixed(2) ?? "--"}</p>
                <p className="text-xs text-white/60">{exp.note}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="glass p-4 rounded-xl space-y-3">
          <p className="font-semibold">Log Expense</p>
          <input
            placeholder="Category"
            value={expense.category}
            onChange={(e) => setExpense({ ...expense, category: e.target.value })}
            className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 w-full"
          />
          <input
            type="number"
            placeholder="Amount"
            value={expense.amount}
            onChange={(e) => setExpense({ ...expense, amount: Number(e.target.value) })}
            className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 w-full"
          />
          <input
            type="date"
            value={expense.expenseDate}
            onChange={(e) => setExpense({ ...expense, expenseDate: e.target.value })}
            className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 w-full"
          />
          <input
            placeholder="Note"
            value={expense.note}
            onChange={(e) => setExpense({ ...expense, note: e.target.value })}
            className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 w-full"
          />
          <button
            onClick={() => create.mutate()}
            className="w-full py-2 rounded-lg bg-gradient-to-r from-brand.red to-brand.blue font-semibold"
          >
            Save Expense
          </button>
        </div>
      </div>
    </Shell>
  );
}
