"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import Shell from "../../components/shell";
import api from "../../lib/api-client";
import { useAuth } from "../../lib/auth-context";
import { Input } from "../../components/ui/input";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { PageHeader } from "../../components/page-header";
import { PageToolbar, PageToolbarSection } from "../../components/page-toolbar";

const roleOptions = [
  { value: "OWNER_ADMIN", label: "Owner / Admin" },
  { value: "OPS_MANAGER", label: "Operations Manager" },
  { value: "SERVICE_ADVISOR", label: "Service Advisor" },
  { value: "INVENTORY_MANAGER", label: "Inventory Manager" },
  { value: "ACCOUNTANT", label: "Accountant" },
  { value: "AUDITOR", label: "Auditor" }
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
  "WORKORDERS_CREATE_HISTORICAL",
  "WORKORDERS_UPDATE_STATUS",
  "WORKORDERS_BILLING_EDIT",
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
  "SERVICES_READ",
  "SERVICES_CREATE",
  "SERVICES_UPDATE",
  "SERVICES_PRICE_UPDATE",
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

type RoleKey =
  | "OWNER_ADMIN"
  | "OPS_MANAGER"
  | "SERVICE_ADVISOR"
  | "INVENTORY_MANAGER"
  | "ACCOUNTANT"
  | "AUDITOR";

const roleDefaultPermissions: Record<RoleKey, readonly string[]> = {
  OWNER_ADMIN: allPermissions,
  OPS_MANAGER: [
    "USERS_READ",
    "USERS_UPDATE",
    "USERS_DISABLE",
    "ROLES_READ",
    "PERMISSIONS_READ",
    "CUSTOMERS_READ",
    "CUSTOMERS_CREATE",
    "CUSTOMERS_UPDATE",
    "VEHICLES_READ",
    "VEHICLES_CREATE",
    "VEHICLES_UPDATE",
    "WORKORDERS_READ_ALL",
    "WORKORDERS_CREATE",
    "WORKORDERS_CREATE_HISTORICAL",
    "WORKORDERS_UPDATE_STATUS",
    "WORKORDERS_BILLING_EDIT",
    "WORKORDERS_ASSIGN_EMPLOYEE",
    "WORKORDERS_ADD_NOTES",
    "WORKORDERS_ADD_ATTACHMENTS",
    "WORKORDERS_READ_SCHEDULED_POOL",
    "TIMELOGS_CREATE_SELF",
    "TIMELOGS_READ_SELF",
    "TIMELOGS_READ_ALL",
    "PARTS_READ",
    "PARTS_CREATE",
    "PARTS_UPDATE",
    "SERVICES_READ",
    "SERVICES_CREATE",
    "SERVICES_UPDATE",
    "SERVICES_PRICE_UPDATE",
    "INVENTORY_PRICE_UPDATE",
    "INVENTORY_RECEIVE",
    "INVENTORY_ADJUST",
    "INVENTORY_ISSUE_TO_WORKORDER",
    "INVENTORY_COUNTER_SALE",
    "INVENTORY_REPORTS_READ",
    "INVOICES_READ",
    "INVOICES_CREATE",
    "INVOICES_CLOSE",
    "PAYMENTS_CREATE",
    "PAYMENTS_READ",
    "PAYABLES_READ",
    "PAYABLES_UPDATE",
    "EXPENSES_READ",
    "EXPENSES_CREATE",
    "EXPENSES_UPDATE",
    "EXPENSES_DELETE",
    "REPORTS_READ_SALES",
    "REPORTS_READ_PROFIT",
    "REPORTS_READ_INVENTORY",
    "REPORTS_EXPORT_PDF",
    "AUDITLOGS_READ"
  ],
  SERVICE_ADVISOR: [
    "CUSTOMERS_READ",
    "CUSTOMERS_CREATE",
    "CUSTOMERS_UPDATE",
    "VEHICLES_READ",
    "VEHICLES_CREATE",
    "VEHICLES_UPDATE",
    "WORKORDERS_READ_ALL",
    "WORKORDERS_READ_SCHEDULED_POOL",
    "WORKORDERS_CREATE",
    "WORKORDERS_CREATE_HISTORICAL",
    "WORKORDERS_UPDATE_STATUS",
    "WORKORDERS_BILLING_EDIT",
    "WORKORDERS_ASSIGN_EMPLOYEE",
    "WORKORDERS_ADD_NOTES",
    "WORKORDERS_ADD_ATTACHMENTS",
    "TIMELOGS_CREATE_SELF",
    "TIMELOGS_READ_SELF",
    "PARTS_READ",
    "SERVICES_READ",
    "INVENTORY_ISSUE_TO_WORKORDER",
    "INVENTORY_COUNTER_SALE",
    "INVOICES_READ",
    "INVOICES_CREATE",
    "INVOICES_CLOSE",
    "PAYMENTS_CREATE",
    "PAYMENTS_READ",
    "REPORTS_READ_SALES"
  ],
  INVENTORY_MANAGER: [
    "PARTS_READ",
    "PARTS_CREATE",
    "PARTS_UPDATE",
    "SERVICES_READ",
    "INVENTORY_RECEIVE",
    "INVENTORY_ADJUST",
    "INVENTORY_ISSUE_TO_WORKORDER",
    "INVENTORY_COUNTER_SALE",
    "INVENTORY_PRICE_UPDATE",
    "INVENTORY_REPORTS_READ",
    "INVOICES_READ",
    "PAYABLES_READ",
    "PAYABLES_UPDATE"
  ],
  ACCOUNTANT: [
    "CUSTOMERS_READ",
    "VEHICLES_READ",
    "WORKORDERS_READ_ALL",
    "WORKORDERS_READ_SCHEDULED_POOL",
    "PARTS_READ",
    "SERVICES_READ",
    "INVENTORY_REPORTS_READ",
    "INVOICES_READ",
    "INVOICES_CREATE",
    "INVOICES_CLOSE",
    "PAYMENTS_READ",
    "EXPENSES_READ",
    "PAYABLES_READ",
    "REPORTS_READ_SALES",
    "REPORTS_READ_PROFIT",
    "REPORTS_READ_INVENTORY",
    "REPORTS_EXPORT_PDF",
    "AUDITLOGS_READ"
  ],
  AUDITOR: [
    "USERS_READ",
    "ROLES_READ",
    "PERMISSIONS_READ",
    "CUSTOMERS_READ",
    "VEHICLES_READ",
    "APPOINTMENTS_READ",
    "WORKORDERS_READ_ALL",
    "WORKORDERS_READ_ASSIGNED",
    "WORKORDERS_READ_SCHEDULED_POOL",
    "TIMELOGS_READ_SELF",
    "TIMELOGS_READ_ALL",
    "PARTS_READ",
    "SERVICES_READ",
    "INVENTORY_REPORTS_READ",
    "INVOICES_READ",
    "PAYMENTS_READ",
    "EXPENSES_READ",
    "PAYABLES_READ",
    "REPORTS_READ_SALES",
    "REPORTS_READ_PROFIT",
    "REPORTS_READ_INVENTORY",
    "REPORTS_EXPORT_PDF",
    "AUDITLOGS_READ"
  ]
};

export default function UsersPage() {
  const { session } = useAuth();
  const qc = useQueryClient();
  const canRead = session?.user?.permissions?.includes("USERS_READ");
  const canCreate = session?.user?.permissions?.includes("USERS_CREATE");
  const canUpdate = session?.user?.permissions?.includes("USERS_UPDATE");
  const canDisable = session?.user?.permissions?.includes("USERS_DISABLE");

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
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"ALL" | RoleKey>("ALL");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "ACTIVE" | "DISABLED" | "UNVERIFIED">("ALL");
  const [showAdvancedPermissions, setShowAdvancedPermissions] = useState(false);
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

  const resendOtp = useMutation({
    mutationFn: async (userId: string) => (await api.post(`/users/${userId}/resend-otp`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
    }
  });

  const deleteUser = useMutation({
    mutationFn: async (userId: string) => (await api.delete(`/users/${userId}`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      if (editingUserId) {
        setEditingUserId(null);
      }
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
  const filteredUsers = useMemo(() => {
    const list = (users.data || []) as any[];
    const term = search.trim().toLowerCase();
    return list.filter((u) => {
      const matchesSearch = !term
        ? true
        : `${u.name || ""} ${u.email || ""} ${u.role || ""}`.toLowerCase().includes(term);
      const matchesRole = roleFilter === "ALL" ? true : u.role === roleFilter;
      const matchesStatus =
        statusFilter === "ALL"
          ? true
          : statusFilter === "ACTIVE"
          ? Boolean(u.isActive)
          : statusFilter === "DISABLED"
          ? !u.isActive
          : !u.emailVerified;
      return matchesSearch && matchesRole && matchesStatus;
    });
  }, [roleFilter, search, statusFilter, users.data]);
  const createRolePermissions = useMemo(
    () => roleDefaultPermissions[form.role as RoleKey] || [],
    [form.role]
  );

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
      <PageHeader
        title="Users"
        description="Search staff quickly, review status, and keep role defaults clean."
        badge={<Badge variant="secondary">{filteredUsers.length} users</Badge>}
      />

      {cannotAccess ? (
        <div className="glass p-6 rounded-xl text-center">
          <p className="font-semibold text-foreground">You don&apos;t have permission to view this page.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="glass p-4 rounded-xl lg:col-span-2 space-y-3">
            <div className="flex items-center justify-between">
              <p className="font-semibold text-foreground">Staff Directory</p>
              {users.isLoading && <span className="text-xs text-muted-foreground">Loading...</span>}
            </div>
            <PageToolbar className="p-0 bg-transparent border-0 shadow-none">
              <PageToolbarSection>
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Name, email, role"
                  className="md:max-w-xs"
                />
                <select
                  value={roleFilter}
                  onChange={(e) => setRoleFilter(e.target.value as typeof roleFilter)}
                  className="w-full rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground md:max-w-[220px]"
                >
                  <option value="ALL">All roles</option>
                  {roleOptions.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
                  className="w-full rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground md:max-w-[220px]"
                >
                  <option value="ALL">All users</option>
                  <option value="ACTIVE">Active</option>
                  <option value="DISABLED">Disabled</option>
                  <option value="UNVERIFIED">Unverified</option>
                </select>
              </PageToolbarSection>
            </PageToolbar>
            <div className="space-y-2">
              {filteredUsers.map((u: any) => (
                <div key={u._id} className="rounded-xl border border-border bg-card p-3">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-foreground">{u.name || u.email}</p>
                        <Badge variant="secondary">{u.role}</Badge>
                        <Badge variant={u.isActive ? "success" : "warning"}>
                          {u.isActive ? "Active" : "Disabled"}
                        </Badge>
                        <Badge variant={u.emailVerified ? "success" : "warning"}>
                          {u.emailVerified ? "Verified" : "Unverified"}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">{u.email}</p>
                      <p className="text-xs text-muted-foreground">{(u.permissions || []).length} permissions</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {!u.emailVerified && canCreate && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => resendOtp.mutate(u._id)}
                          disabled={resendOtp.isPending}
                        >
                          Resend OTP
                        </Button>
                      )}
                      {canUpdate && (
                        <Button size="sm" variant="outline" onClick={() => startEditing(u)}>
                          Edit
                        </Button>
                      )}
                      {canDisable && u.role !== "OWNER_ADMIN" && (
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => {
                            if (window.confirm(`Delete user ${u.email}? This cannot be undone.`)) {
                              deleteUser.mutate(u._id);
                            }
                          }}
                          disabled={deleteUser.isPending}
                        >
                          Delete
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              {!users.isLoading && filteredUsers.length === 0 && (
                <div className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">
                  No users match the current search or filter.
                </div>
              )}
            </div>
          </div>

          <div className="glass p-4 rounded-xl space-y-3">
            <div className="space-y-1">
              <p className="font-semibold text-foreground">Create User</p>
              <p className="text-xs text-muted-foreground">Keep role defaults clean and only expand permissions when needed.</p>
            </div>
            {!canCreate && <p className="text-sm text-muted-foreground">You need USERS_CREATE permission.</p>}
            <Input
              disabled={!canCreate}
              placeholder="Full name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            <Input
              disabled={!canCreate}
              placeholder="Email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
            <Input
              disabled={!canCreate}
              type="password"
              placeholder="Temp password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
            <select
              disabled={!canCreate}
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
              className="w-full rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground"
            >
              {roleOptions.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
            <div className="rounded-lg border border-border bg-card px-3 py-2">
              <p className="text-xs font-semibold text-foreground">Auto-selected permissions ({createRolePermissions.length})</p>
              <p className="text-[11px] text-muted-foreground mt-1 line-clamp-4">{createRolePermissions.join(", ")}</p>
            </div>
            <Button
              disabled={!canCreate || create.isPending}
              onClick={() => create.mutate()}
              className="w-full"
              isLoading={create.isPending}
            >
              Create User
            </Button>
            {create.isSuccess && (
              <p className="text-xs text-accent">
                User created. Verification OTP sent to email.
              </p>
            )}
            {create.isError && <p className="text-xs text-primary">{(create.error as any)?.message || "Create failed"}</p>}
            {resendOtp.isSuccess && <p className="text-xs text-accent">OTP resent.</p>}
            {resendOtp.isError && (
              <p className="text-xs text-primary">{(resendOtp.error as any)?.message || "Resend failed"}</p>
            )}
            {deleteUser.isSuccess && <p className="text-xs text-accent">User deleted.</p>}
            {deleteUser.isError && (
              <p className="text-xs text-primary">{(deleteUser.error as any)?.message || "Delete failed"}</p>
            )}

            {canUpdate && (
              <div className="border-t border-border pt-3 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="font-semibold text-foreground text-sm">Edit User</p>
                  {editingUserId && <Button size="sm" variant="ghost" onClick={() => setEditingUserId(null)}>Clear</Button>}
                </div>
                {!editingUserId && <p className="text-xs text-muted-foreground">Select a user from the list to edit.</p>}
                <Input
                  disabled={!editingUserId}
                  placeholder="Full name"
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                />
                <Input
                  disabled={!editingUserId}
                  placeholder="Email"
                  value={editForm.email}
                  onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                />
                <Input
                  disabled={!editingUserId}
                  type="password"
                  placeholder="New password (optional)"
                  value={editForm.password}
                  onChange={(e) => setEditForm({ ...editForm, password: e.target.value })}
                />
                <select
                  disabled={!editingUserId}
                  value={editForm.role}
                  onChange={(e) =>
                    setEditForm({
                      ...editForm,
                      role: e.target.value,
                      permissions: [...(roleDefaultPermissions[e.target.value as RoleKey] || [])]
                    })
                  }
                  className="w-full rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground"
                >
                  {roleOptions.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-foreground">Role defaults</p>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={!editingUserId}
                      onClick={() => setShowAdvancedPermissions((prev) => !prev)}
                    >
                      {showAdvancedPermissions ? "Hide advanced" : "Advanced permissions"}
                    </Button>
                  </div>
                  <div className="rounded-lg border border-border bg-card/50 px-3 py-2">
                    <p className="text-[11px] text-muted-foreground">
                      {showAdvancedPermissions
                        ? "Advanced permissions are visible. Keep custom overrides minimal."
                        : "Advanced permissions stay collapsed by default."}
                    </p>
                  </div>
                  <div className="rounded-lg border border-border bg-card px-3 py-2 text-[11px] text-muted-foreground">
                    {editForm.permissions.length} permissions currently assigned to this user.
                  </div>
                  {showAdvancedPermissions && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-semibold text-foreground">Advanced permissions</p>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={!editingUserId}
                          onClick={toggleAllPermissions}
                        >
                          {editForm.permissions.length === allPermissions.length ? "Clear all" : "Select all"}
                        </Button>
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
                  )}
                </div>
                <Button
                  disabled={!editingUserId || updateUser.isPending}
                  onClick={() => updateUser.mutate()}
                  className="w-full"
                  variant="secondary"
                  isLoading={updateUser.isPending}
                >
                  Save Changes
                </Button>
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
