"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import Shell from "../../components/shell";
import api from "../../lib/api-client";
import { useAuth } from "../../lib/auth-context";

const roleOptions = [
  { value: "OWNER_ADMIN", label: "Owner / Admin" },
  { value: "OPS_MANAGER", label: "Operations Manager" },
  { value: "SERVICE_ADVISOR", label: "Service Advisor" },
  { value: "TECHNICIAN", label: "Technician" },
  { value: "PAINTER", label: "Painter" },
  { value: "INVENTORY_MANAGER", label: "Inventory Manager" },
  { value: "ACCOUNTANT", label: "Accountant" }
];
const allPermissions = [
  "USERS_READ",
  "USERS_CREATE",
  "USERS_UPDATE",
  "USERS_DISABLE",
  "ROLES_READ",
  "ROLES_UPDATE",
  "PERMISSIONS_READ",
  "SETTINGS_UPDATE",
  "CUSTOMERS_READ",
  "CUSTOMERS_CREATE",
  "CUSTOMERS_UPDATE",
  "VEHICLES_READ",
  "VEHICLES_CREATE",
  "VEHICLES_UPDATE",
  "APPOINTMENTS_READ",
  "APPOINTMENTS_CREATE",
  "APPOINTMENTS_UPDATE",
  "WORKORDERS_READ_ALL",
  "WORKORDERS_READ_ASSIGNED",
  "WORKORDERS_CREATE",
  "WORKORDERS_UPDATE_STATUS",
  "WORKORDERS_ASSIGN_EMPLOYEE",
  "WORKORDERS_ADD_NOTES",
  "WORKORDERS_ADD_ATTACHMENTS",
  "WORKORDERS_READ_SCHEDULED_POOL",
  "TIMELOGS_CREATE_SELF",
  "TIMELOGS_READ_SELF",
  "TIMELOGS_READ_ALL",
  "TIMELOGS_EDIT_SELF",
  "TIMELOGS_EDIT_ALL",
  "PARTS_READ",
  "PARTS_CREATE",
  "PARTS_UPDATE",
  "INVENTORY_RECEIVE",
  "INVENTORY_ADJUST",
  "INVENTORY_ISSUE_TO_WORKORDER",
  "INVENTORY_COUNTER_SALE",
  "INVENTORY_PRICE_UPDATE",
  "INVENTORY_REPORTS_READ",
  "ESTIMATES_READ",
  "ESTIMATES_CREATE",
  "ESTIMATES_UPDATE",
  "ESTIMATES_APPROVE",
  "INVOICES_READ",
  "INVOICES_CREATE",
  "INVOICES_CLOSE",
  "PAYMENTS_CREATE",
  "PAYMENTS_READ",
  "EXPENSES_READ",
  "EXPENSES_CREATE",
  "EXPENSES_UPDATE",
  "EXPENSES_DELETE",
  "PAYABLES_READ",
  "PAYABLES_UPDATE",
  "REPORTS_READ_SALES",
  "REPORTS_READ_PROFIT",
  "REPORTS_READ_INVENTORY",
  "REPORTS_EXPORT_PDF",
  "AUDITLOGS_READ"
] as const;

export default function UsersPage() {
  const { session } = useAuth();
  const qc = useQueryClient();
  const canRead = session?.user?.permissions?.includes("USERS_READ");
  const canCreate = session?.user?.permissions?.includes("USERS_CREATE");
  const isOwner = session?.user?.role === "OWNER_ADMIN";

  const users = useQuery({
    queryKey: ["users"],
    queryFn: async () => (await api.get("/users")).data,
    enabled: Boolean(canRead)
  });

  const [form, setForm] = useState({
    email: "",
    password: "",
    name: "",
    role: roleOptions[1].value
  });

  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    email: "",
    password: "",
    name: "",
    role: roleOptions[0].value,
    permissions: [] as string[]
  });

  const create = useMutation({
    mutationFn: async () => api.post("/users", form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      setForm({ email: "", password: "", name: "", role: roleOptions[1].value });
    }
  });

  const updateUser = useMutation({
    mutationFn: async () => {
      if (!editingUserId) return;
      return api.patch(`/users/${editingUserId}`, {
        email: editForm.email,
        name: editForm.name,
        password: editForm.password || undefined,
        role: editForm.role,
        permissions: editForm.permissions
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      setEditingUserId(null);
      setEditForm({ email: "", password: "", name: "", role: roleOptions[0].value, permissions: [] });
    }
  });

  const cannotAccess = useMemo(() => !canRead && !canCreate, [canRead, canCreate]);

  const startEditing = (user: any) => {
    setEditingUserId(user._id);
    setEditForm({
      email: user.email || "",
      name: user.name || "",
      password: "",
      role: user.role || roleOptions[0].value,
      permissions: (user.permissions || []) as string[]
    });
  };

  const togglePermission = (perm: string) => {
    setEditForm((prev) => {
      const exists = prev.permissions.includes(perm);
      const perms = exists ? prev.permissions.filter((p) => p !== perm) : [...prev.permissions, perm];
      return { ...prev, permissions: perms };
    });
  };

  const toggleAllPermissions = () => {
    setEditForm((prev) => {
      const hasAll = prev.permissions.length === allPermissions.length;
      return { ...prev, permissions: hasAll ? [] : [...allPermissions] };
    });
  };

  return (
    <Shell>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Users</h1>
          <p className="text-muted-foreground text-sm">Manage staff accounts and roles.</p>
        </div>
      </div>

      {cannotAccess ? (
        <div className="glass p-6 rounded-xl text-center">
          <p className="font-semibold text-foreground">You don&apos;t have permission to view this page.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="glass p-4 rounded-xl lg:col-span-2 space-y-3">
            <div className="flex items-center justify-between">
              <p className="font-semibold text-foreground">Active Users</p>
              {users.isLoading && <span className="text-xs text-muted-foreground">Loading...</span>}
            </div>
            <div className="space-y-2">
              {(users.data || []).map((u: any) => (
                <div key={u._id} className="flex items-center justify-between bg-card border border-border rounded-lg px-3 py-2">
                  <div>
                    <p className="font-semibold text-foreground">{u.name || u.email}</p>
                    <p className="text-xs text-muted-foreground">
                      {u.email} | {u.role}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">{(u.permissions || []).length} perms</p>
                      <p className={`text-xs ${u.isActive ? "text-accent" : "text-primary"}`}>{u.isActive ? "Active" : "Disabled"}</p>
                    </div>
                    {isOwner && (
                      <button
                        onClick={() => startEditing(u)}
                        className="text-xs px-2 py-1 rounded border border-border hover:bg-muted"
                      >
                        Edit
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="glass p-4 rounded-xl space-y-3">
            <p className="font-semibold text-foreground">Add User</p>
            {!canCreate && <p className="text-sm text-muted-foreground">You need USERS_CREATE permission.</p>}
            <input
              disabled={!canCreate}
              placeholder="Full name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="bg-muted border border-border rounded-lg px-3 py-2 w-full text-foreground"
            />
            <input
              disabled={!canCreate}
              placeholder="Email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="bg-muted border border-border rounded-lg px-3 py-2 w-full text-foreground"
            />
            <input
              disabled={!canCreate}
              type="password"
              placeholder="Temp password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              className="bg-muted border border-border rounded-lg px-3 py-2 w-full text-foreground"
            />
            <select
              disabled={!canCreate}
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
              className="bg-muted border border-border rounded-lg px-3 py-2 w-full text-foreground"
            >
              {roleOptions.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
            <button
              disabled={!canCreate || create.isPending}
              onClick={() => create.mutate()}
              className="w-full py-2 rounded-lg bg-primary text-foreground font-semibold disabled:opacity-60"
            >
              {create.isPending ? "Saving..." : "Create User"}
            </button>

            {isOwner && (
              <div className="border-t border-border pt-3 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="font-semibold text-foreground text-sm">Edit User (admin only)</p>
                  {editingUserId && (
                    <button
                      className="text-[11px] text-muted-foreground hover:text-foreground"
                      onClick={() => setEditingUserId(null)}
                    >
                      Clear
                    </button>
                  )}
                </div>
                {!editingUserId && <p className="text-xs text-muted-foreground">Select a user from the list to edit.</p>}
                <input
                  disabled={!editingUserId}
                  placeholder="Full name"
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  className="bg-muted border border-border rounded-lg px-3 py-2 w-full text-foreground"
                />
                <input
                  disabled={!editingUserId}
                  placeholder="Email"
                  value={editForm.email}
                  onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                  className="bg-muted border border-border rounded-lg px-3 py-2 w-full text-foreground"
                />
                <input
                  disabled={!editingUserId}
                  type="password"
                  placeholder="New password (optional)"
                  value={editForm.password}
                  onChange={(e) => setEditForm({ ...editForm, password: e.target.value })}
                  className="bg-muted border border-border rounded-lg px-3 py-2 w-full text-foreground"
                />
                <select
                  disabled={!editingUserId}
                  value={editForm.role}
                  onChange={(e) => setEditForm({ ...editForm, role: e.target.value })}
                  className="bg-muted border border-border rounded-lg px-3 py-2 w-full text-foreground"
                >
                  {roleOptions.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-foreground">Permissions</p>
                    <button
                      type="button"
                      disabled={!editingUserId}
                      onClick={toggleAllPermissions}
                      className="text-[11px] text-accent hover:underline disabled:opacity-60"
                    >
                      {editForm.permissions.length === allPermissions.length ? "Clear all" : "Select all"}
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-1">
                    {allPermissions.map((perm) => (
                      <label
                        key={perm}
                        className="flex items-center gap-2 rounded-md border border-border px-2 py-2 text-xs"
                      >
                        <input
                          type="checkbox"
                          disabled={!editingUserId}
                          checked={editForm.permissions.includes(perm)}
                          onChange={() => togglePermission(perm)}
                          className="h-4 w-4 accent-primary"
                        />
                        <span className="truncate">{perm}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <button
                  disabled={!editingUserId || updateUser.isPending}
                  onClick={() => updateUser.mutate()}
                  className="w-full py-2 rounded-lg bg-muted text-foreground font-semibold disabled:opacity-60 hover:bg-border"
                >
                  {updateUser.isPending ? "Saving..." : "Save Changes"}
                </button>
                {updateUser.isError && (
                  <p className="text-xs text-primary">{(updateUser.error as any)?.message || "Update failed"}</p>
                )}
                {updateUser.isSuccess && <p className="text-xs text-accent">User updated.</p>}
              </div>
            )}
          </div>
        </div>
      )}
    </Shell>
  );
}
