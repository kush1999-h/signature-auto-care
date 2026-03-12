"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Shell from "../../components/shell";
import api from "../../lib/api-client";
import { useAuth } from "../../lib/auth-context";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Table, THead, TBody, TR, TH, TD } from "../../components/ui/table";
import { useToast } from "../../components/ui/toast";
import { Badge } from "../../components/ui/badge";
import { PageHeader } from "../../components/page-header";
import { PageToolbar, PageToolbarSection } from "../../components/page-toolbar";

type ServiceItem = {
  _id: string;
  name: string;
  code: string;
  category?: string;
  defaultPrice?: number;
  defaultCost?: number;
  taxable?: boolean;
  isActive?: boolean;
};

const formatMoney = (value?: number) => {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num.toFixed(2) : "0.00";
};

export default function ServicesPage() {
  const { session } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const permissions = session?.user?.permissions || [];
  const canRead = permissions.includes("SERVICES_READ");
  const canCreate = permissions.includes("SERVICES_CREATE");
  const canUpdate = permissions.includes("SERVICES_UPDATE");
  const canPriceUpdate = permissions.includes("SERVICES_PRICE_UPDATE");

  const [search, setSearch] = useState("");
  const [form, setForm] = useState({
    name: "",
    code: "",
    category: "",
    defaultPrice: "",
    defaultCost: "",
    taxable: false,
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    name: "",
    code: "",
    category: "",
    defaultPrice: "",
    defaultCost: "",
    taxable: false,
    isActive: true,
  });

  const servicesQuery = useQuery({
    queryKey: ["services", search],
    queryFn: async () =>
      (await api.get("/services", { params: { search } })).data as ServiceItem[],
    enabled: canRead,
  });

  const createMutation = useMutation({
    mutationFn: async () =>
      api.post("/services", {
        name: form.name,
        code: form.code,
        category: form.category || undefined,
        defaultPrice: Number(form.defaultPrice || 0),
        defaultCost: Number(form.defaultCost || 0),
        taxable: form.taxable,
      }),
    onSuccess: () => {
      toast.show({ title: "Service created", variant: "success" });
      setForm({
        name: "",
        code: "",
        category: "",
        defaultPrice: "",
        defaultCost: "",
        taxable: false,
      });
      qc.invalidateQueries({ queryKey: ["services"] });
    },
    onError: (error: unknown) => {
      toast.show({
        title: "Create failed",
        description: error instanceof Error ? error.message : "Unable to create service",
        variant: "error",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!editingId) return;
      return api.patch(`/services/${editingId}`, {
        name: editForm.name,
        code: editForm.code,
        category: editForm.category || undefined,
        defaultPrice: Number(editForm.defaultPrice || 0),
        defaultCost: Number(editForm.defaultCost || 0),
        taxable: editForm.taxable,
        isActive: editForm.isActive,
      });
    },
    onSuccess: () => {
      toast.show({ title: "Service updated", variant: "success" });
      setEditingId(null);
      qc.invalidateQueries({ queryKey: ["services"] });
    },
    onError: (error: unknown) => {
      toast.show({
        title: "Update failed",
        description: error instanceof Error ? error.message : "Unable to update service",
        variant: "error",
      });
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async (item: ServiceItem) =>
      api.patch(`/services/${item._id}`, { isActive: !item.isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["services"] }),
  });

  const priceMutation = useMutation({
    mutationFn: async (payload: { id: string; defaultPrice: number; defaultCost: number }) =>
      api.patch(`/services/${payload.id}/price`, {
        defaultPrice: payload.defaultPrice,
        defaultCost: payload.defaultCost,
      }),
    onSuccess: () => {
      toast.show({ title: "Pricing updated", variant: "success" });
      qc.invalidateQueries({ queryKey: ["services"] });
    },
  });

  const services = useMemo(() => servicesQuery.data || [], [servicesQuery.data]);

  const startEditing = (item: ServiceItem) => {
    setEditingId(item._id);
    setEditForm({
      name: item.name,
      code: item.code,
      category: item.category || "",
      defaultPrice: String(item.defaultPrice ?? 0),
      defaultCost: String(item.defaultCost ?? 0),
      taxable: Boolean(item.taxable),
      isActive: item.isActive !== false,
    });
  };

  if (!canRead) {
    return (
      <Shell>
        <div className="glass p-6 rounded-xl text-center">
          <p className="font-semibold text-foreground">You do not have permission to view services.</p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <PageHeader
        title="Service Catalog"
        description="Maintain fixed-price services with a calm list-and-editor workflow."
        badge={<Badge variant="secondary">{services.length} services</Badge>}
      />

      <PageToolbar>
        <PageToolbarSection>
          <Input
            placeholder="Search by name, code, or category"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="md:max-w-sm"
          />
        </PageToolbarSection>
        <PageToolbarSection align="end">
          <div className="text-xs text-muted-foreground flex items-center">
            {servicesQuery.isFetching ? "Refreshing..." : "Status and pricing stay in sync with the editor."}
          </div>
        </PageToolbarSection>
      </PageToolbar>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="glass p-4 rounded-xl xl:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <p className="font-semibold text-foreground">Service list</p>
            <span className="text-xs text-muted-foreground">{services.length} visible</span>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <THead>
                <TR>
                  <TH>Code</TH>
                  <TH>Name</TH>
                  <TH>Category</TH>
                  <TH>Price</TH>
                  <TH>Cost</TH>
                  <TH>Status</TH>
                  <TH>Action</TH>
                </TR>
              </THead>
              <TBody>
                {services.map((item) => (
                  <TR key={item._id}>
                    <TD className="font-mono text-xs">{item.code}</TD>
                    <TD className="font-medium text-foreground">{item.name}</TD>
                    <TD>{item.category || "--"}</TD>
                    <TD className="text-right">Tk. {formatMoney(item.defaultPrice)}</TD>
                    <TD className="text-right text-muted-foreground">Tk. {formatMoney(item.defaultCost)}</TD>
                    <TD>
                      <Badge variant={item.isActive === false ? "warning" : "success"}>
                        {item.isActive === false ? "Inactive" : "Active"}
                      </Badge>
                    </TD>
                    <TD className="space-x-2">
                      {canUpdate && (
                        <Button size="sm" variant="secondary" onClick={() => startEditing(item)}>
                          Edit
                        </Button>
                      )}
                      {canUpdate && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => toggleActiveMutation.mutate(item)}
                          isLoading={toggleActiveMutation.isPending}
                        >
                          {item.isActive === false ? "Activate" : "Deactivate"}
                        </Button>
                      )}
                    </TD>
                  </TR>
                ))}
                {services.length === 0 && (
                  <TR>
                    <TD colSpan={7} className="text-center text-muted-foreground">
                      No services found.
                    </TD>
                  </TR>
                )}
              </TBody>
            </Table>
          </div>
        </div>

        <div className="glass p-4 rounded-xl space-y-3">
          <div className="space-y-1">
            <p className="font-semibold text-foreground">{editingId ? "Edit service" : "Create service"}</p>
            <p className="text-xs text-muted-foreground">
              Keep this panel simple: save pricing, category, and active state.
            </p>
          </div>
          {editingId ? (
            <>
              <Input
                value={editForm.name}
                onChange={(e) => setEditForm((p) => ({ ...p, name: e.target.value }))}
                placeholder="Name"
                disabled={!canUpdate}
              />
              <Input
                value={editForm.code}
                onChange={(e) => setEditForm((p) => ({ ...p, code: e.target.value }))}
                placeholder="Code"
                disabled={!canUpdate}
              />
              <Input
                value={editForm.category}
                onChange={(e) => setEditForm((p) => ({ ...p, category: e.target.value }))}
                placeholder="Category"
                disabled={!canUpdate}
              />
              <Input
                type="text"
                inputMode="decimal"
                value={editForm.defaultPrice}
                onChange={(e) => setEditForm((p) => ({ ...p, defaultPrice: e.target.value }))}
                placeholder="Default price"
                disabled={!canPriceUpdate && !canUpdate}
              />
              <Input
                type="text"
                inputMode="decimal"
                value={editForm.defaultCost}
                onChange={(e) => setEditForm((p) => ({ ...p, defaultCost: e.target.value }))}
                placeholder="Default cost"
                disabled={!canPriceUpdate && !canUpdate}
              />
              <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  checked={editForm.taxable}
                  onChange={(e) => setEditForm((p) => ({ ...p, taxable: e.target.checked }))}
                  disabled={!canUpdate}
                />
                Taxable
              </label>
              <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  checked={editForm.isActive}
                  onChange={(e) => setEditForm((p) => ({ ...p, isActive: e.target.checked }))}
                  disabled={!canUpdate}
                />
                Active
              </label>
              <div className="flex gap-2">
                <Button
                  onClick={() => {
                    if (canUpdate) {
                      updateMutation.mutate();
                    } else if (canPriceUpdate && editingId) {
                      priceMutation.mutate({
                        id: editingId,
                        defaultPrice: Number(editForm.defaultPrice || 0),
                        defaultCost: Number(editForm.defaultCost || 0),
                      });
                    }
                  }}
                  isLoading={updateMutation.isPending || priceMutation.isPending}
                  disabled={!canUpdate && !canPriceUpdate}
                >
                  Save
                </Button>
                <Button variant="ghost" onClick={() => setEditingId(null)}>
                  Cancel
                </Button>
              </div>
            </>
          ) : (
            <>
              <Input
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                placeholder="Name"
                disabled={!canCreate}
              />
              <Input
                value={form.code}
                onChange={(e) => setForm((p) => ({ ...p, code: e.target.value }))}
                placeholder="Code (e.g. WASH_STD)"
                disabled={!canCreate}
              />
              <Input
                value={form.category}
                onChange={(e) => setForm((p) => ({ ...p, category: e.target.value }))}
                placeholder="Category"
                disabled={!canCreate}
              />
              <Input
                type="text"
                inputMode="decimal"
                value={form.defaultPrice}
                onChange={(e) => setForm((p) => ({ ...p, defaultPrice: e.target.value }))}
                placeholder="Default price"
                disabled={!canCreate}
              />
              <Input
                type="text"
                inputMode="decimal"
                value={form.defaultCost}
                onChange={(e) => setForm((p) => ({ ...p, defaultCost: e.target.value }))}
                placeholder="Default cost"
                disabled={!canCreate}
              />
              <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  checked={form.taxable}
                  onChange={(e) => setForm((p) => ({ ...p, taxable: e.target.checked }))}
                  disabled={!canCreate}
                />
                Taxable
              </label>
              <Button onClick={() => createMutation.mutate()} isLoading={createMutation.isPending} disabled={!canCreate}>
                Create
              </Button>
            </>
          )}
        </div>
      </div>
    </Shell>
  );
}
