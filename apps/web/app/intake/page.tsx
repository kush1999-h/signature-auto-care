"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import Shell from "../../components/shell";
import api from "../../lib/api-client";
import { useAuth } from "../../lib/auth-context";
import { useDebounce } from "../../lib/use-debounce";
import { SegmentedControl } from "../../components/ui/segmented-control";
import { useToast } from "../../components/ui/toast";

type CustomerResult = { _id: string; name: string; phone: string; email?: string; address?: string };

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
  mileage: string;
  complaint: string;
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
  mileage: "",
  complaint: ""
};

const steps = [
  { value: "customer", label: "Customer" },
  { value: "vehicle", label: "Vehicle" },
  { value: "workorder", label: "Work Order" }
] as const;

export default function IntakePage() {
  const { session } = useAuth();
  const canCreateWO = session?.user?.permissions?.includes("WORKORDERS_CREATE");
  const [form, setForm] = useState<FormState>(initialForm);
  const [activeStep, setActiveStep] = useState<(typeof steps)[number]["value"]>("customer");
  const [searchPhone, setSearchPhone] = useState("");
  const debouncedSearchPhone = useDebounce(searchPhone, 300);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
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

  const handleSelectCustomer = (customer: CustomerResult) => {
    setForm((prev) => ({
      ...prev,
      customerName: customer.name,
      phone: customer.phone,
      email: customer.email || "",
      address: customer.address || ""
    }));
    setSelectedCustomerId(customer._id);
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

      const vehicleRes = await api.post("/vehicles", {
        customerId,
        make: form.vehicleMake,
        model: form.vehicleModel,
        year: form.vehicleYear ? Number(form.vehicleYear) : undefined,
        color: form.color || undefined,
        plate: form.plate || undefined,
        vin: form.vin || undefined,
        mileage: form.mileage ? Number(form.mileage) : undefined
      });
      const vehicleId = vehicleRes.data._id;

      const workOrderRes = await api.post("/work-orders", {
        customerId,
        vehicleId,
        complaint: form.complaint,
        status: "Scheduled",
        assignedEmployees: []
      });
      return workOrderRes.data;
    },
    onSuccess: (data) => {
      setForm(initialForm);
      setSearchPhone("");
      setSelectedCustomerId(null);
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
    if (!form.complaint.trim()) errors.complaint = "Complaint is required";
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
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-foreground">Quick Intake</h1>
        <p className="text-muted-foreground text-sm">
          Front desk flow: capture customer + vehicle, and schedule a work order in one step.
        </p>
      </div>

      {!canCreateWO ? (
        <div className="glass p-6 rounded-xl">
          <p className="font-semibold">No access</p>
          <p className="text-sm text-white/60">Only Service Advisor, Ops Manager, or Admin can create work orders.</p>
        </div>
      ) : (
        <>
          <div className="mb-4">
            <SegmentedControl
              aria-label="Intake steps"
              options={steps.map((s) => ({ value: s.value, label: s.label }))}
              value={activeStep}
              onChange={(val) => setActiveStep(val as typeof activeStep)}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Customer */}
            <div className="glass p-4 rounded-xl space-y-3 md:col-span-1">
              <div className="flex items-center justify-between">
                <p className="font-semibold text-foreground">Customer</p>
                <span className="text-[11px] text-muted-foreground">Step 1 of 3</span>
              </div>

              {/* Customer Search */}
              <div className="relative">
                <input
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
                  className="bg-muted border border-border rounded-lg px-3 py-2 w-full text-foreground text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
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
                <div className="bg-accent/10 border border-accent rounded-lg p-2 text-sm">
                  <p className="text-accent">Customer selected</p>
                </div>
              )}

              <label className="text-sm text-muted-foreground">
                Full name <span className="text-red-400">*</span>
                <input
                  placeholder="Full name"
                  value={form.customerName}
                  onChange={(e) => setForm({ ...form, customerName: e.target.value })}
                  className="bg-muted border border-border rounded-lg px-3 py-2 w-full text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                />
                {fieldErrors.customerName && <span className="text-[11px] text-red-400">{fieldErrors.customerName}</span>}
              </label>
              <label className="text-sm text-muted-foreground">
                Phone <span className="text-red-400">*</span>
                <input
                  placeholder="Phone"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  className="bg-muted border border-border rounded-lg px-3 py-2 w-full text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                />
                {fieldErrors.phone && <span className="text-[11px] text-red-400">{fieldErrors.phone}</span>}
              </label>
              <label className="text-sm text-muted-foreground">
                Email
                <input
                  placeholder="Email (optional)"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="bg-muted border border-border rounded-lg px-3 py-2 w-full text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                />
                {fieldErrors.email && <span className="text-[11px] text-red-400">{fieldErrors.email}</span>}
              </label>
              <label className="text-sm text-muted-foreground">
                Address
                <input
                  placeholder="Address (optional)"
                  value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                  className="bg-muted border border-border rounded-lg px-3 py-2 w-full text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                />
              </label>
            </div>

            {/* Vehicle */}
            <div className="glass p-4 rounded-xl space-y-3 md:col-span-1">
              <div className="flex items-center justify-between">
                <p className="font-semibold text-foreground">Vehicle</p>
                <span className="text-[11px] text-muted-foreground">Step 2 of 3</span>
              </div>
              <label className="text-sm text-muted-foreground">
                Make <span className="text-red-400">*</span>
                <input
                  placeholder="Make (e.g., Toyota)"
                  value={form.vehicleMake}
                  onChange={(e) => setForm({ ...form, vehicleMake: e.target.value })}
                  className="bg-muted border border-border rounded-lg px-3 py-2 w-full text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                />
                {fieldErrors.vehicleMake && <span className="text-[11px] text-red-400">{fieldErrors.vehicleMake}</span>}
              </label>
              <label className="text-sm text-muted-foreground">
                Model <span className="text-red-400">*</span>
                <input
                  placeholder="Model (e.g., Corolla)"
                  value={form.vehicleModel}
                  onChange={(e) => setForm({ ...form, vehicleModel: e.target.value })}
                  className="bg-muted border border-border rounded-lg px-3 py-2 w-full text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                />
                {fieldErrors.vehicleModel && <span className="text-[11px] text-red-400">{fieldErrors.vehicleModel}</span>}
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-sm text-muted-foreground">
                  Year
                  <input
                    placeholder="Year"
                    value={form.vehicleYear}
                    onChange={(e) => setForm({ ...form, vehicleYear: e.target.value })}
                    className="bg-muted border border-border rounded-lg px-3 py-2 w-full text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                  />
                  {fieldErrors.vehicleYear && <span className="text-[11px] text-red-400">{fieldErrors.vehicleYear}</span>}
                </label>
                <label className="text-sm text-muted-foreground">
                  Color
                  <input
                    placeholder="Color"
                    value={form.color}
                    onChange={(e) => setForm({ ...form, color: e.target.value })}
                    className="bg-muted border border-border rounded-lg px-3 py-2 w-full text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                  />
                </label>
              </div>
              <label className="text-sm text-muted-foreground">
                Plate
                <input
                  placeholder="Plate"
                  value={form.plate}
                  onChange={(e) => setForm({ ...form, plate: e.target.value })}
                  className="bg-muted border border-border rounded-lg px-3 py-2 w-full text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                />
              </label>
              <label className="text-sm text-muted-foreground">
                VIN
                <input
                  placeholder="VIN"
                  value={form.vin}
                  onChange={(e) => setForm({ ...form, vin: e.target.value })}
                  className="bg-muted border border-border rounded-lg px-3 py-2 w-full text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                />
              </label>
              <label className="text-sm text-muted-foreground">
                Mileage
                <input
                  placeholder="Mileage"
                  value={form.mileage}
                  onChange={(e) => setForm({ ...form, mileage: e.target.value })}
                  className="bg-muted border border-border rounded-lg px-3 py-2 w-full text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                />
              </label>
            </div>

            {/* Work order */}
            <div className="glass p-4 rounded-xl space-y-3 md:col-span-1">
              <div className="flex items-center justify-between">
                <p className="font-semibold text-foreground">Work Order</p>
                <span className="text-[11px] text-muted-foreground">Step 3 of 3</span>
              </div>
              <label className="text-sm text-muted-foreground">
                Complaint / notes <span className="text-red-400">*</span>
                <textarea
                  placeholder="Complaint / notes"
                  value={form.complaint}
                  onChange={(e) => setForm({ ...form, complaint: e.target.value })}
                  className="bg-muted border border-border rounded-lg px-3 py-2 w-full min-h-[120px] text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                />
                {fieldErrors.complaint && <span className="text-[11px] text-red-400">{fieldErrors.complaint}</span>}
              </label>
              <button
                onClick={onSubmit}
                disabled={intake.isPending}
                className="w-full py-2 rounded-lg bg-primary font-semibold text-foreground disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
              >
                {intake.isPending ? "Saving..." : "Create & Schedule"}
              </button>
              {intake.isSuccess && <p className="text-accent text-sm">Intake saved and work order scheduled.</p>}
              {intake.isError && (
                <p className="text-sm text-red-400">{(intake.error as Error)?.message || "Failed to save intake."}</p>
              )}
            </div>
          </div>
        </>
      )}
    </Shell>
  );
}
