"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Shell from "../../components/shell";
import api from "../../lib/api-client";
import { useAuth } from "../../lib/auth-context";
import { Input } from "../../components/ui/input";
import { Table, THead, TBody, TR, TH, TD } from "../../components/ui/table";
import { Skeleton } from "../../components/ui/skeleton";
import { EmptyState } from "../../components/ui/empty-state";
import { ErrorState } from "../../components/ui/error-state";

type AuditLog = {
  _id: string;
  actionType: string;
  entityType: string;
  entityId: string;
  performedByName?: string;
  performedByRole?: string;
  timestamp?: string;
};

const parseDate = (value: string) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

export default function AuditLogsPage() {
  const { session } = useAuth();
  const canRead = session?.user?.permissions?.includes("AUDITLOGS_READ");
  const [filters, setFilters] = useState({
    actionType: "",
    entityType: "",
    entityId: "",
    actor: "",
    from: "",
    to: ""
  });

  const auditQuery = useQuery({
    queryKey: ["audit-logs", filters.actionType, filters.entityType, filters.entityId],
    queryFn: async () => {
      const actionTypes = filters.actionType
        ? filters.actionType
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : [];
      const params: Record<string, string | string[]> = {};
      if (filters.entityType) params.entityType = filters.entityType;
      if (filters.entityId) params.entityId = filters.entityId;
      if (actionTypes.length === 1) params.actionType = actionTypes[0];
      if (actionTypes.length > 1) params.actionType = actionTypes;
      return (await api.get("/audit-logs", { params })).data as AuditLog[];
    },
    enabled: Boolean(canRead)
  });

  const filtered = useMemo(() => {
    const list = auditQuery.data || [];
    const actor = filters.actor.trim().toLowerCase();
    const from = parseDate(filters.from);
    const to = parseDate(filters.to);
    return list.filter((log) => {
      if (actor) {
        const name = (log.performedByName || "").toLowerCase();
        const role = (log.performedByRole || "").toLowerCase();
        if (!name.includes(actor) && !role.includes(actor)) return false;
      }
      if (from || to) {
        const ts = log.timestamp ? new Date(log.timestamp) : null;
        if (!ts) return false;
        if (from && ts < from) return false;
        if (to) {
          const end = new Date(to);
          end.setHours(23, 59, 59, 999);
          if (ts > end) return false;
        }
      }
      return true;
    });
  }, [auditQuery.data, filters.actor, filters.from, filters.to]);

  if (!canRead) {
    return (
      <Shell>
        <div className="glass p-6 rounded-xl text-center">
          <p className="font-semibold text-foreground">You don&apos;t have permission to view audit logs.</p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Audit Logs</h1>
          <p className="text-sm text-muted-foreground">Track system activity by action, entity, and user.</p>
        </div>
      </div>

      <div className="glass p-4 rounded-xl space-y-3">
        <div className="grid gap-2 md:grid-cols-6">
          <Input
            placeholder="Action type (comma-separated)"
            value={filters.actionType}
            onChange={(e) => setFilters((f) => ({ ...f, actionType: e.target.value }))}
          />
          <Input
            placeholder="Entity type"
            value={filters.entityType}
            onChange={(e) => setFilters((f) => ({ ...f, entityType: e.target.value }))}
          />
          <Input
            placeholder="Entity ID"
            value={filters.entityId}
            onChange={(e) => setFilters((f) => ({ ...f, entityId: e.target.value }))}
          />
          <Input
            placeholder="Actor name/role"
            value={filters.actor}
            onChange={(e) => setFilters((f) => ({ ...f, actor: e.target.value }))}
          />
          <Input type="date" value={filters.from} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))} />
          <Input type="date" value={filters.to} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))} />
        </div>

        <div className="rounded-lg border border-border overflow-hidden">
          <Table>
            <THead>
              <TR>
                <TH>Time</TH>
                <TH>Action</TH>
                <TH>Entity</TH>
                <TH>Actor</TH>
              </TR>
            </THead>
            <TBody>
              {auditQuery.isLoading &&
                Array.from({ length: 6 }).map((_, idx) => (
                  <TR key={idx}>
                    <TD colSpan={4}>
                      <Skeleton className="h-5 w-full" />
                    </TD>
                  </TR>
                ))}
              {!auditQuery.isLoading &&
                filtered.map((log) => (
                    <TR key={log._id}>
                      <TD>{log.timestamp ? new Date(log.timestamp).toLocaleString() : "--"}</TD>
                      <TD>{log.actionType}</TD>
                      <TD>{log.entityType} - {log.entityId}</TD>
                      <TD>
                        {log.performedByName
                          ? `${log.performedByName}${log.performedByRole ? ` (${log.performedByRole})` : ""}`
                          : "--"}
                    </TD>
                  </TR>
                ))}
            </TBody>
          </Table>
          {!auditQuery.isLoading && filtered.length === 0 && (
            <div className="p-4">
              <EmptyState title="No audit logs found" description="Adjust filters or wait for new activity." />
            </div>
          )}
          {auditQuery.isError && (
            <div className="p-4">
              <ErrorState message="Unable to load audit logs." onRetry={() => auditQuery.refetch()} />
            </div>
          )}
        </div>
      </div>
    </Shell>
  );
}
