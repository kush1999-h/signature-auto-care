"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import Shell from "../../components/shell";
import api from "../../lib/api-client";
import { useAuth } from "../../lib/auth-context";
import { useDebounce } from "../../lib/use-debounce";
import { PageHeader } from "../../components/page-header";
import { PageToolbar, PageToolbarSection } from "../../components/page-toolbar";
import { Badge } from "../../components/ui/badge";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import { Button } from "../../components/ui/button";
import { SegmentedControl } from "../../components/ui/segmented-control";
import { useToast } from "../../components/ui/toast";

type CustomerResult = {
  _id: string;
  name: string;
  phone: string;
  email?: string;
  address?: string;
  visitSummary?: {
    totalVisits?: number;
    distinctVehicles?: number;
    lastVisit?: string | null;
  };
};
type VehicleResult = {
  _id: string;
  make?: string;
  model?: string;
  year?: number;
  plate?: string;
  color?: string;
  vin?: string;
  visitSummary?: {
    visitCount?: number;
    firstVisit?: string | null;
    lastVisit?: string | null;
  };
};

type FormState = {
  customerName: string;
  phone: string;
  email: string;
  address: string;
  vehicleMake: string;
  vehicleModel: string;
  vehicleYear: string;
  color: string;
  plate: string;
  vin: string;
  complaint: string;
  reference: string;
  advanceAmount: string;
  oilLevelPct: number;
};

const initialForm: FormState = {
  customerName: "",
  phone: "",
  email: "",
  address: "",
  vehicleMake: "",
  vehicleModel: "",
  vehicleYear: "",
  color: "",
  plate: "",
  vin: "",
  complaint: "",
  reference: "",
  advanceAmount: "",
  oilLevelPct: 50,
};

const formatDate = (value?: string | null) =>
  value ? new Date(value).toLocaleDateString() : "--";

const steps = [
  { value: "customer", label: "Customer" },
  { value: "vehicle", label: "Vehicle" },
  { value: "workorder", label: "Work Order" }
] as const;

export default function IntakePage() {
  const { session } = useAuth();
  const canCreateWO = session?.user?.permissions?.includes("WORKORDERS_CREATE");
  const sessionRole = (session?.user as { role?: string } | undefined)?.role || "";
  const canCreateHistorical =
    Boolean(session?.user?.permissions?.includes("WORKORDERS_CREATE_HISTORICAL")) ||
    ["OWNER_ADMIN", "OPS_MANAGER", "SERVICE_ADVISOR"].includes(sessionRole);
  const [form, setForm] = useState<FormState>(initialForm);
  const [historicalMode, setHistoricalMode] = useState(false);
  const [historicalDateIn, setHistoricalDateIn] = useState("");
  const [historicalDateOut, setHistoricalDateOut] = useState("");
  const [historicalStatus, setHistoricalStatus] = useState("Closed");
  const [historicalBillAmount, setHistoricalBillAmount] = useState("");
  const [historicalCostAmount, setHistoricalCostAmount] = useState("");
  const [historicalSource, setHistoricalSource] = useState("");
  const [activeStep, setActiveStep] = useState<(typeof steps)[number]["value"]>("customer");
  const [searchPhone, setSearchPhone] = useState("");
  const debouncedSearchPhone = useDebounce(searchPhone, 300);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string>("");
  const [vehicleMode, setVehicleMode] = useState<"reuse" | "new">("new");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [showHistorical, setShowHistorical] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const { show: showToast } = useToast();

  const { data: searchResults, isFetching: isSearching } = useQuery<CustomerResult[]>({
    queryKey: ["searchCustomer", debouncedSearchPhone],
    queryFn: async () => {
      if (!debouncedSearchPhone || debouncedSearchPhone.length < 3) {
        return [];
      }
      const res = await api.get("/customers/search/by-phone", {
        params: { phone: debouncedSearchPhone }
      });
      return res.data.results || [];
    }
  });

  const customerOptions = useMemo(() => searchResults || [], [searchResults]);
  const customerVehicles = useQuery<VehicleResult[]>({
    queryKey: ["customerVehicles", selectedCustomerId],
    queryFn: async () => {
      if (!selectedCustomerId) return [];
      const res = await api.get(`/customers/${selectedCustomerId}/vehicles`);
      return res.data || [];
    },
    enabled: Boolean(selectedCustomerId)
  });

  const handleSelectCustomer = (customer: CustomerResult) => {
    setForm((prev) => ({
      ...prev,
      customerName: customer.name,
      phone: customer.phone,
      email: customer.email || "",
      address: customer.address || ""
    }));
    setSelectedCustomerId(customer._id);
    setSelectedVehicleId("");
    setVehicleMode("reuse");
    setShowSearchResults(false);
    setHighlightedIndex(-1);
    setActiveStep("vehicle");
  };

  const intake = useMutation({
    mutationFn: async () => {
      let customerId = selectedCustomerId;
      if (!customerId) {
        const customerRes = await api.post("/customers", {
          name: form.customerName,
          phone: form.phone,
          email: form.email || undefined,
          address: form.address || undefined
        });
        customerId = customerRes.data._id;
      }

      const vehicleId = selectedVehicleId
        ? selectedVehicleId
        : (
            await api.post("/vehicles", {
              customerId,
              make: form.vehicleMake,
              model: form.vehicleModel,
              year: form.vehicleYear ? Number(form.vehicleYear) : undefined,
              color: form.color || undefined,
              plate: form.plate || undefined,
              vin: form.vin || undefined,
            })
          ).data._id;

      const workOrderRes = await api.post("/work-orders", {
        customerId,
        vehicleId,
        complaint: form.complaint,
        reference: form.reference.trim() || undefined,
        advanceAmount:
          form.advanceAmount.trim() === ""
            ? undefined
            : Number(form.advanceAmount),
        status: historicalMode ? historicalStatus : "Scheduled",
        assignedEmployees: [],
        oilLevelPct: form.oilLevelPct,
        isHistorical: historicalMode || undefined,
        dateIn: historicalMode ? historicalDateIn : undefined,
        dateOut: historicalMode && historicalDateOut ? historicalDateOut : undefined,
        historicalBillAmount:
          historicalMode && historicalBillAmount.trim() !== ""
            ? Number(historicalBillAmount)
            : undefined,
        historicalCostAmount:
          historicalMode && historicalCostAmount.trim() !== ""
            ? Number(historicalCostAmount)
            : undefined,
        historicalSource: historicalMode ? historicalSource.trim() || undefined : undefined,
      });
      return workOrderRes.data;
    },
    onSuccess: (data) => {
      setForm(initialForm);
      setSearchPhone("");
      setSelectedCustomerId(null);
      setSelectedVehicleId("");
      setVehicleMode("new");
      setHistoricalMode(false);
      setHistoricalDateIn("");
      setHistoricalDateOut("");
      setHistoricalStatus("Closed");
      setHistoricalBillAmount("");
      setHistoricalCostAmount("");
      setHistoricalSource("");
      setShowHistorical(false);
      setActiveStep("customer");
      showToast({
        title: "Work order created",
        description: (
          <Link href={`/work-orders/${data?._id || ""}`} className="underline">
            View work order
          </Link>
        ),
        variant: "success"
      });
    }
  });

  const validations = () => {
    const errors: Record<string, string> = {};
    if (!form.customerName.trim()) errors.customerName = "Name is required";
    if (!form.phone.trim()) errors.phone = "Phone is required";
    if (!form.vehicleMake.trim()) errors.vehicleMake = "Make is required";
    if (!form.vehicleModel.trim()) errors.vehicleModel = "Model is required";
    if (!form.plate.trim()) errors.plate = "Plate is required";
    if (!Number.isFinite(form.oilLevelPct)) errors.oilLevelPct = "Oil level is required";
    if (!form.complaint.trim()) errors.complaint = "Complaint is required";
    if (form.reference.trim().length > 120) errors.reference = "Reference must be at most 120 characters";
    if (form.advanceAmount.trim() !== "") {
      const advance = Number(form.advanceAmount);
      if (!Number.isFinite(advance) || advance < 0) errors.advanceAmount = "Advance must be a non-negative number";
    }
    if (historicalMode) {
      if (!canCreateHistorical) {
        errors.historicalMode = "You do not have permission for historical entries";
      }
      if (!historicalDateIn) {
        errors.historicalDateIn = "Date in is required in historical mode";
      }
      if (historicalDateIn && historicalDateOut && new Date(historicalDateOut).getTime() < new Date(historicalDateIn).getTime()) {
        errors.historicalDateOut = "Date out must be on/after Date in";
      }
      if (historicalBillAmount.trim() !== "") {
        const bill = Number(historicalBillAmount);
        if (!Number.isFinite(bill) || bill < 0) {
          errors.historicalBillAmount = "Bill amount must be a non-negative number";
        }
      }
      if (historicalCostAmount.trim() !== "") {
        const cost = Number(historicalCostAmount);
        if (!Number.isFinite(cost) || cost < 0) {
          errors.historicalCostAmount = "Cost amount must be a non-negative number";
        }
        if (historicalBillAmount.trim() === "") {
          errors.historicalBillAmount = "Bill amount is required if cost is provided";
        }
      }
    }
    if (form.vehicleYear && !/^[0-9]{4}$/.test(form.vehicleYear)) errors.vehicleYear = "Use YYYY format";
    if (form.email && !/.+@.+/.test(form.email)) errors.email = "Invalid email format";
    return errors;
  };

  const onSubmit = () => {
    const errors = validations();
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      if (errors.customerName || errors.phone || errors.email) setActiveStep("customer");
      else if (errors.vehicleMake || errors.vehicleModel || errors.vehicleYear) setActiveStep("vehicle");
      else setActiveStep("workorder");
      return;
    }
    intake.mutate();
  };

  useEffect(() => {
    if (activeStep === "customer" && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [activeStep]);

  return (
    <Shell>
      <PageHeader
        title="Quick Intake"
        description="Capture the customer, confirm the vehicle, and schedule the job in one front-desk flow."
        badge={<Badge variant="secondary">{steps.findIndex((step) => step.value === activeStep) + 1} / 3</Badge>}
        meta={
          selectedCustomerId ? (
            <>
              <span>Returning customer</span>
              <span>Vehicle reuse available</span>
            </>
          ) : (
            <span>New or returning customers supported</span>
          )
        }
      />

      {!canCreateWO ? (
        <div className="glass p-6 rounded-xl">
          <p className="font-semibold">No access</p>
          <p className="text-sm text-muted-foreground">Only Service Advisor, Ops Manager, or Admin can create work orders.</p>
        </div>
      ) : (
        <>
          <PageToolbar>
            <PageToolbarSection>
              <SegmentedControl
                aria-label="Intake steps"
                options={steps.map((s) => ({ value: s.value, label: s.label }))}
                value={activeStep}
                onChange={(val) => setActiveStep(val as typeof activeStep)}
              />
            </PageToolbarSection>
            <PageToolbarSection align="end">
              <div className="text-xs text-muted-foreground">
                {selectedCustomerId
                  ? "Select a saved vehicle or switch to a new one."
                  : "Search by phone to reuse an existing customer first."}
              </div>
            </PageToolbarSection>
          </PageToolbar>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Customer */}
            <div className="glass p-4 rounded-xl space-y-3 md:col-span-1">
              <div className="flex items-center justify-between">
                <p className="font-semibold text-foreground">Customer</p>
                <span className="text-[11px] text-muted-foreground">Step 1 of 3</span>
              </div>

              {/* Customer Search */}
              <div className="relative">
                <Input
                  ref={searchInputRef}
                  placeholder="Search by phone number..."
                  value={searchPhone}
                  onChange={(e) => {
                    setSearchPhone(e.target.value);
                    setShowSearchResults(true);
                    setHighlightedIndex(-1);
                  }}
                  onFocus={() => setShowSearchResults(true)}
                  onKeyDown={(e) => {
                    if (!showSearchResults || customerOptions.length === 0) return;
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      setHighlightedIndex((idx) => Math.min(customerOptions.length - 1, idx + 1));
                    } else if (e.key === "ArrowUp") {
                      e.preventDefault();
                      setHighlightedIndex((idx) => Math.max(0, idx - 1));
                    } else if (e.key === "Enter" && highlightedIndex >= 0) {
                      e.preventDefault();
                      handleSelectCustomer(customerOptions[highlightedIndex]);
                    } else if (e.key === "Escape") {
                      setShowSearchResults(false);
                    }
                  }}
                />
                {searchPhone.length >= 3 && showSearchResults && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-secondary border border-border rounded-lg shadow-lg z-10 max-h-48 overflow-y-auto">
                    {customerOptions.length > 0 ? (
                      <div>
                        {customerOptions.map((customer, idx) => (
                          <button
                            key={customer._id}
                            onClick={() => handleSelectCustomer(customer)}
                            className={`w-full text-left p-3 border-b border-border last:border-b-0 cursor-pointer hover:bg-muted transition ${
                              idx === highlightedIndex ? "bg-muted" : ""
                            }`}
                          >
                            <p className="font-semibold text-foreground text-sm">{customer.name}</p>
                            <p className="text-muted-foreground text-xs">{customer.phone}</p>
                            <p className="text-[11px] text-muted-foreground">
                              {customer.visitSummary?.totalVisits || 0} visits |{" "}
                              {customer.visitSummary?.distinctVehicles || 0} vehicles
                              {customer.visitSummary?.lastVisit
                                ? ` | Last ${formatDate(customer.visitSummary.lastVisit)}`
                                : ""}
                            </p>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="p-3 text-muted-foreground text-sm">
                        {debouncedSearchPhone ? "No customers found" : "Start typing to search"}
                      </div>
                    )}
                  </div>
                )}
                {searchPhone.length >= 3 && isSearching && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-secondary border border-border rounded-lg shadow-lg z-10 max-h-48 overflow-y-auto p-3 text-sm text-muted-foreground">
                    Searching...
                  </div>
                )}
              </div>

              {selectedCustomerId && (
                <div className="rounded-lg border border-accent/40 bg-accent/10 p-3 text-sm space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold text-accent">Returning customer selected</p>
                    <Badge variant="secondary">
                      {customerOptions.find((item) => item._id === selectedCustomerId)?.visitSummary?.totalVisits || 0} visits
                    </Badge>
                  </div>
                  {customerOptions.find((item) => item._id === selectedCustomerId)?.visitSummary && (
                    <p className="text-[11px] text-muted-foreground">
                      {customerOptions.find((item) => item._id === selectedCustomerId)?.visitSummary?.distinctVehicles || 0} vehicles
                      {" | "}Last visit {formatDate(customerOptions.find((item) => item._id === selectedCustomerId)?.visitSummary?.lastVisit)}
                    </p>
                  )}
                </div>
              )}

              <label className="text-sm text-muted-foreground">
                Full name <span className="text-[var(--danger-text)]">*</span>
                <Input
                  placeholder="Full name"
                  value={form.customerName}
                  onChange={(e) => setForm({ ...form, customerName: e.target.value })}
                />
                {fieldErrors.customerName && <span className="text-[11px] text-[var(--danger-text)]">{fieldErrors.customerName}</span>}
              </label>
              <label className="text-sm text-muted-foreground">
                Phone <span className="text-[var(--danger-text)]">*</span>
                <Input
                  placeholder="Phone"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
                {fieldErrors.phone && <span className="text-[11px] text-[var(--danger-text)]">{fieldErrors.phone}</span>}
              </label>
              <label className="text-sm text-muted-foreground">
                Email
                <Input
                  placeholder="Email (optional)"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
                {fieldErrors.email && <span className="text-[11px] text-[var(--danger-text)]">{fieldErrors.email}</span>}
              </label>
              <label className="text-sm text-muted-foreground">
                Address
                <Input
                  placeholder="Address (optional)"
                  value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                />
              </label>
            </div>

            {/* Vehicle */}
            <div className="glass p-4 rounded-xl space-y-3 md:col-span-1">
              <div className="flex items-center justify-between">
                <p className="font-semibold text-foreground">Vehicle</p>
                <span className="text-[11px] text-muted-foreground">Step 2 of 3</span>
              </div>
              {selectedCustomerId && (customerVehicles.data?.length || 0) > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-foreground">Vehicle mode</p>
                    <p className="text-[11px] text-muted-foreground">
                      Reuse saved details or enter a different car
                    </p>
                  </div>
                  <SegmentedControl
                    aria-label="Vehicle entry mode"
                    options={[
                      { value: "reuse", label: "Reuse existing" },
                      { value: "new", label: "Create new" },
                    ]}
                    value={vehicleMode}
                    onChange={(val) => {
                      const next = val as "reuse" | "new";
                      setVehicleMode(next);
                      if (next === "new") {
                        setSelectedVehicleId("");
                      }
                    }}
                  />
                </div>
              )}
              <label className="text-sm text-muted-foreground">
                Make <span className="text-[var(--danger-text)]">*</span>
                <Input
                  placeholder="Make (e.g., Toyota)"
                  value={form.vehicleMake}
                  onChange={(e) => setForm({ ...form, vehicleMake: e.target.value })}
                />
                {fieldErrors.vehicleMake && <span className="text-[11px] text-[var(--danger-text)]">{fieldErrors.vehicleMake}</span>}
              </label>
              <label className="text-sm text-muted-foreground">
                Model <span className="text-[var(--danger-text)]">*</span>
                <Input
                  placeholder="Model (e.g., Corolla)"
                  value={form.vehicleModel}
                  onChange={(e) => setForm({ ...form, vehicleModel: e.target.value })}
                />
                {fieldErrors.vehicleModel && <span className="text-[11px] text-[var(--danger-text)]">{fieldErrors.vehicleModel}</span>}
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-sm text-muted-foreground">
                  Year
                  <Input
                    placeholder="Year"
                    value={form.vehicleYear}
                    onChange={(e) => setForm({ ...form, vehicleYear: e.target.value })}
                  />
                  {fieldErrors.vehicleYear && <span className="text-[11px] text-[var(--danger-text)]">{fieldErrors.vehicleYear}</span>}
                </label>
                <label className="text-sm text-muted-foreground">
                  Color
                  <Input
                    placeholder="Color"
                    value={form.color}
                    onChange={(e) => setForm({ ...form, color: e.target.value })}
                  />
                </label>
              </div>
              <label className="text-sm text-muted-foreground">
                Plate <span className="text-[var(--danger-text)]">*</span>
                <Input
                  placeholder="Plate"
                  value={form.plate}
                  onChange={(e) => setForm({ ...form, plate: e.target.value })}
                />
                {fieldErrors.plate && <span className="text-[11px] text-[var(--danger-text)]">{fieldErrors.plate}</span>}
              </label>
              <label className="text-sm text-muted-foreground">
                VIN
                <Input
                  placeholder="VIN"
                  value={form.vin}
                  onChange={(e) => setForm({ ...form, vin: e.target.value })}
                />
              </label>
              {selectedCustomerId && vehicleMode === "reuse" && (
                <div className="rounded-lg border border-border p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-foreground">Existing vehicles</p>
                    <span className="text-[11px] text-muted-foreground">
                      {customerVehicles.isLoading ? "Loading..." : `${customerVehicles.data?.length || 0} found`}
                    </span>
                  </div>
                  {customerVehicles.data && customerVehicles.data.length > 0 ? (
                    <div className="space-y-2">
                      <div className="rounded-md border border-border bg-card/50 px-3 py-2 text-[11px] text-muted-foreground">
                        Reuse an existing vehicle to auto-fill make, model, year, color, plate, and VIN. Choose
                        “Create new vehicle” if this customer came with a different car.
                      </div>
                      <select
                        value={selectedVehicleId}
                        onChange={(e) => {
                          const vehicleId = e.target.value;
                          setSelectedVehicleId(vehicleId);
                          const vehicle = (customerVehicles.data || []).find((item) => item._id === vehicleId);
                          if (vehicle) {
                            setForm((prev) => ({
                              ...prev,
                              vehicleMake: vehicle.make || prev.vehicleMake,
                              vehicleModel: vehicle.model || prev.vehicleModel,
                              vehicleYear: vehicle.year ? String(vehicle.year) : prev.vehicleYear,
                              color: vehicle.color || prev.color,
                              plate: vehicle.plate || prev.plate,
                              vin: vehicle.vin || prev.vin,
                            }));
                          }
                        }}
                        className="bg-muted border border-border rounded-lg px-3 py-2 w-full text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                      >
                        <option value="">Choose saved vehicle</option>
                        {(customerVehicles.data || []).map((vehicle) => (
                          <option key={vehicle._id} value={vehicle._id}>
                            {vehicle.make || "Vehicle"} {vehicle.model || ""} | {vehicle.plate || "--"} |{" "}
                            {vehicle.visitSummary?.visitCount || 0} visits
                          </option>
                        ))}
                      </select>
                      <div className="grid gap-2">
                        {(customerVehicles.data || []).map((vehicle) => {
                          const active = selectedVehicleId === vehicle._id;
                          return (
                            <button
                              key={vehicle._id}
                              type="button"
                              onClick={() => {
                                setSelectedVehicleId(vehicle._id);
                                setForm((prev) => ({
                                  ...prev,
                                  vehicleMake: vehicle.make || prev.vehicleMake,
                                  vehicleModel: vehicle.model || prev.vehicleModel,
                                  vehicleYear: vehicle.year ? String(vehicle.year) : prev.vehicleYear,
                                  color: vehicle.color || prev.color,
                                  plate: vehicle.plate || prev.plate,
                                  vin: vehicle.vin || prev.vin,
                                }));
                              }}
                              className={`rounded-lg border p-3 text-left transition ${
                                active
                                  ? "border-primary bg-primary/10"
                                  : "border-border bg-card/40 hover:bg-card/70"
                              }`}
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div>
                                  <p className="text-sm font-medium text-foreground">
                                    {[vehicle.make, vehicle.model, vehicle.year].filter(Boolean).join(" ") || "Vehicle"}
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    Plate {vehicle.plate || "--"}{vehicle.color ? ` | ${vehicle.color}` : ""}
                                  </p>
                                </div>
                                <div className="text-right text-[11px] text-muted-foreground">
                                  <p>{vehicle.visitSummary?.visitCount || 0} visits</p>
                                  <p>Last {formatDate(vehicle.visitSummary?.lastVisit)}</p>
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <p className="text-[11px] text-muted-foreground">
                      No saved vehicles for this customer yet.
                    </p>
                  )}
                </div>
              )}
              <div className="rounded-lg border border-border bg-card px-3 py-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-foreground">
                      Oil level <span className="text-[var(--danger-text)]">*</span>
                    </p>
                    <p className="text-[11px] text-muted-foreground">Set the current oil level as a percentage.</p>
                  </div>
                  <span className="text-sm font-semibold text-foreground">{form.oilLevelPct}%</span>
                </div>
                <div className="mt-3">
                  <div className="relative h-28">
                    <div className="absolute inset-x-0 bottom-0 h-20 overflow-hidden">
                      <div className="h-40 w-full rounded-t-full border-2 border-border bg-muted/40"></div>
                    </div>
                    <div
                      className="absolute bottom-0 left-1/2 h-16 w-0.5 bg-foreground origin-bottom transition-transform"
                      style={{ transform: `translateX(-50%) rotate(${(form.oilLevelPct - 50) * 1.8}deg)` }}
                    />
                    <div className="absolute bottom-0 left-1/2 h-2 w-2 -translate-x-1/2 rounded-full bg-foreground"></div>
                    <div className="absolute bottom-1 left-2 text-[11px] text-muted-foreground">Empty</div>
                    <div className="absolute bottom-1 right-2 text-[11px] text-muted-foreground">Full</div>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={form.oilLevelPct}
                    onChange={(e) => {
                      setForm({ ...form, oilLevelPct: Number(e.target.value) });
                      setFieldErrors((prev) => {
                        const next = { ...prev };
                        delete next.oilLevelPct;
                        return next;
                      });
                    }}
                    className="mt-3 w-full accent-primary"
                    aria-label="Oil level percentage"
                  />
                </div>
                {fieldErrors.oilLevelPct && (
                  <span className="text-[11px] text-[var(--danger-text)]">{fieldErrors.oilLevelPct}</span>
                )}
              </div>
            </div>

            {/* Work order */}
            <div className="glass p-4 rounded-xl space-y-3 md:col-span-1">
              <div className="flex items-center justify-between">
                <p className="font-semibold text-foreground">Work Order</p>
                <span className="text-[11px] text-muted-foreground">Step 3 of 3</span>
              </div>
              <label className="text-sm text-muted-foreground">
                Complaint / notes <span className="text-[var(--danger-text)]">*</span>
                <Textarea
                  placeholder="Complaint / notes"
                  value={form.complaint}
                  onChange={(e) => setForm({ ...form, complaint: e.target.value })}
                  className="min-h-[120px]"
                />
                {fieldErrors.complaint && <span className="text-[11px] text-[var(--danger-text)]">{fieldErrors.complaint}</span>}
              </label>
              <label className="text-sm text-muted-foreground">
                Reference
                <Input
                  placeholder="Reference (optional)"
                  value={form.reference}
                  onChange={(e) => setForm({ ...form, reference: e.target.value })}
                />
                {fieldErrors.reference && <span className="text-[11px] text-[var(--danger-text)]">{fieldErrors.reference}</span>}
              </label>
              <label className="text-sm text-muted-foreground">
                Advance received
                <Input
                  placeholder="Advance amount (optional)"
                  value={form.advanceAmount}
                  onChange={(e) => setForm({ ...form, advanceAmount: e.target.value })}
                />
                <span className="text-[11px] text-muted-foreground">
                  Advance will be adjusted automatically during billing.
                </span>
                {fieldErrors.advanceAmount && <span className="text-[11px] text-[var(--danger-text)]">{fieldErrors.advanceAmount}</span>}
              </label>
              {canCreateHistorical && (
                <div className="rounded-lg border border-border p-3 space-y-2">
                  <button
                    type="button"
                    onClick={() => setShowHistorical((open) => !open)}
                    className="w-full text-left"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-foreground">Historical entry</p>
                      <span className="text-[11px] text-muted-foreground">{showHistorical ? "Hide" : "Show"}</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Use only for backfilling older paper or legacy work orders.
                    </p>
                  </button>
                  {showHistorical && (
                    <div className="space-y-2">
                      <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={historicalMode}
                          onChange={(e) => setHistoricalMode(e.target.checked)}
                          className="h-4 w-4 accent-primary"
                        />
                        Enable historical mode
                      </label>
                      {historicalMode && (
                        <>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <label className="text-sm text-muted-foreground">
                          Date in <span className="text-[var(--danger-text)]">*</span>
                          <input
                            type="date"
                            value={historicalDateIn}
                            onChange={(e) => setHistoricalDateIn(e.target.value)}
                            className="bg-muted border border-border rounded-lg px-3 py-2 w-full text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                          />
                          {fieldErrors.historicalDateIn && <span className="text-[11px] text-[var(--danger-text)]">{fieldErrors.historicalDateIn}</span>}
                        </label>
                        <label className="text-sm text-muted-foreground">
                          Date out
                          <input
                            type="date"
                            value={historicalDateOut}
                            onChange={(e) => setHistoricalDateOut(e.target.value)}
                            className="bg-muted border border-border rounded-lg px-3 py-2 w-full text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                          />
                          {fieldErrors.historicalDateOut && <span className="text-[11px] text-[var(--danger-text)]">{fieldErrors.historicalDateOut}</span>}
                        </label>
                      </div>
                      <label className="text-sm text-muted-foreground">
                        Status
                        <select
                          value={historicalStatus}
                          onChange={(e) => setHistoricalStatus(e.target.value)}
                          className="bg-muted border border-border rounded-lg px-3 py-2 w-full text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                        >
                          <option value="Scheduled">Scheduled</option>
                          <option value="In Progress">In Progress</option>
                          <option value="Closed">Closed</option>
                          <option value="Canceled">Canceled</option>
                        </select>
                      </label>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <label className="text-sm text-muted-foreground">
                          Legacy bill amount
                          <input
                            value={historicalBillAmount}
                            onChange={(e) => setHistoricalBillAmount(e.target.value)}
                            placeholder="Optional"
                            className="bg-muted border border-border rounded-lg px-3 py-2 w-full text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                          />
                          {fieldErrors.historicalBillAmount && <span className="text-[11px] text-[var(--danger-text)]">{fieldErrors.historicalBillAmount}</span>}
                        </label>
                        <label className="text-sm text-muted-foreground">
                          Legacy cost (optional)
                          <input
                            value={historicalCostAmount}
                            onChange={(e) => setHistoricalCostAmount(e.target.value)}
                            placeholder="Optional"
                            className="bg-muted border border-border rounded-lg px-3 py-2 w-full text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                          />
                          {fieldErrors.historicalCostAmount && <span className="text-[11px] text-[var(--danger-text)]">{fieldErrors.historicalCostAmount}</span>}
                        </label>
                      </div>
                      <label className="text-sm text-muted-foreground">
                        Source note
                        <input
                          value={historicalSource}
                          onChange={(e) => setHistoricalSource(e.target.value)}
                          placeholder="Paper register / old system (optional)"
                          className="bg-muted border border-border rounded-lg px-3 py-2 w-full text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                        />
                      </label>
                      <p className="text-[11px] text-muted-foreground">
                        If bill and cost are provided, finance reports will include this backfilled job.
                      </p>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}
              <Button
                onClick={onSubmit}
                disabled={intake.isPending}
                className="w-full"
              >
                {intake.isPending ? "Saving..." : "Create & Schedule"}
              </Button>
              {intake.isSuccess && <p className="text-accent text-sm">Intake saved and work order scheduled.</p>}
              {intake.isError && (
                <p className="text-sm text-[var(--danger-text)]">{(intake.error as Error)?.message || "Failed to save intake."}</p>
              )}
            </div>
          </div>
        </>
      )}
    </Shell>
  );
}
