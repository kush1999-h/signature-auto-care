"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import Shell from "../../components/shell";
import api, { getPdfBaseUrl } from "../../lib/api-client";
import { useAuth } from "../../lib/auth-context";
import { useDebounce } from "../../lib/use-debounce";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Badge } from "../../components/ui/badge";
import { Dialog } from "../../components/ui/dialog";
import { useToast } from "../../components/ui/toast";
import { CurrencyInput } from "../../components/ui/number-input";
import { EmptyState } from "../../components/ui/empty-state";
import Link from "next/link";

type Part = {
  _id: string;
  partName: string;
  sku: string;
  availableQty?: number;
  onHandQty?: number;
  reservedQty?: number;
  sellingPrice?: number;
};

type CartItem = { part: Part; qty: number };
type Customer = { _id: string; name: string; phone: string; email?: string };

const formatCurrency = (value: number) =>
  `Tk. ${new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value || 0)}`;

export default function CounterSalePage() {
  const { session } = useAuth();
  const toast = useToast();
  const [customer, setCustomer] = useState({ name: "", phone: "", email: "" });
  const [useExisting, setUseExisting] = useState(false);
  const [customerId, setCustomerId] = useState("");
  const [searchPhone, setSearchPhone] = useState("");
  const debouncedSearchPhone = useDebounce(searchPhone, 300);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 250);
  const searchRef = useRef<HTMLInputElement>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [payment, setPayment] = useState({ method: "CASH", amount: 0 });
  const [paymentInput, setPaymentInput] = useState("0");
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [scanMode, setScanMode] = useState(true);
  const [clearConfirm, setClearConfirm] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [showPartResults, setShowPartResults] = useState(false);

  // Search for existing customers by phone
  const {
    data: searchResults,
    isFetching: isSearching,
    isError: searchError,
    refetch: refetchSearch
  } = useQuery<Customer[]>({
    queryKey: ["searchCustomerCounter", debouncedSearchPhone],
    queryFn: async () => {
      if (!debouncedSearchPhone || debouncedSearchPhone.length < 3) {
        return [];
      }
      try {
        const res = await api.get("/customers/search/by-phone", {
          params: { phone: debouncedSearchPhone },
        });
        return res.data.results || [];
      } catch (error) {
        console.error("Search error:", error);
        return [];
      }
    },
  });

  const handleSelectCustomer = (selectedCustomer: Customer) => {
    setCustomerId(selectedCustomer._id);
    setCustomer({
      name: selectedCustomer.name,
      phone: selectedCustomer.phone,
      email: selectedCustomer.email || "",
    });
    setUseExisting(true);
    setSearchPhone("");
    setShowSearchResults(false);
  };
  const [insufficient, setInsufficient] = useState<{
    part?: Part;
    available: number;
    requested: number;
  } | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [invoiceInfo, setInvoiceInfo] = useState<{
    id: string;
    number: string;
  } | null>(null);
  const canSell = session?.user?.permissions?.includes(
    "INVENTORY_COUNTER_SALE"
  );

  const partsQuery = useQuery<{ items?: Part[] }>({
    queryKey: ["counter-sale-parts", debouncedSearch],
    queryFn: async () =>
      (await api.get("/parts", { params: { search: debouncedSearch, limit: 8 } }))
        .data,
    enabled: showPartResults,
  });

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "/" && scanMode) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [scanMode]);

  const fetchPart = async (term: string) => {
    const res = await api.get("/parts", { params: { search: term, limit: 1 } });
    const part: Part | undefined = res.data?.items?.[0];
    return part;
  };

  const addPartDirect = (part: Part) => {
    setAddError(null);
    setCart((prev) => {
      const existing = prev.find((c) => c.part._id === part._id);
      if (existing) {
        return prev.map((c) =>
          c.part._id === part._id ? { ...c, qty: c.qty + 1 } : c
        );
      }
      return [...prev, { part, qty: 1 }];
    });
    setSearch("");
    if (scanMode) searchRef.current?.focus();
  };

  const addPartToCart = async (term: string) => {
    if (!term.trim()) return;
    try {
      setAddError(null);
      const part = await fetchPart(term.trim());
      if (!part) {
        toast.show({
          title: "Not found",
          description: "No part matches that SKU, barcode, or name.",
          variant: "error",
        });
        setAddError("No part matches that SKU, barcode, or name.");
        return;
      }
      addPartDirect(part);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Search failed";
      setAddError(message);
      toast.show({
        title: "Search failed",
        description: message,
        variant: "error",
      });
    }
  };

  const subtotal = useMemo(
    () =>
      cart.reduce(
        (sum, item) => sum + (item.part.sellingPrice || 0) * item.qty,
        0
      ),
    [cart]
  );
  const taxPlaceholder = 0;
  const discountPlaceholder = 0;
  const grandTotal = subtotal + taxPlaceholder - discountPlaceholder;

  useEffect(() => {
    setPayment((p) => ({ ...p, amount: grandTotal }));
    setPaymentInput(String(grandTotal.toFixed(2)));
    setPaymentError(null);
  }, [grandTotal]);

  const paymentAmountNumber = useMemo(() => {
    const parsed = Number(paymentInput);
    return Number.isFinite(parsed) ? parsed : 0;
  }, [paymentInput]);

  const handlePaymentChange = (val: string) => {
    // Strip non-numeric except dot
    const cleaned = val.replace(/[^0-9.]/g, "");
    setPaymentInput(cleaned);
    const parsed = Number(cleaned);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setPaymentError("Enter a valid payment amount.");
    } else if (parsed < grandTotal) {
      setPaymentError(`Payment must be at least ${formatCurrency(grandTotal)}.`);
    } else {
      setPaymentError(null);
    }
    setPayment((p) => ({ ...p, amount: Number.isFinite(parsed) ? parsed : 0 }));
  };

  type CheckoutResponse = { invoice?: { _id: string; invoiceNumber?: string; workOrderId?: string } };

  const checkout = useMutation<CheckoutResponse>({
    mutationFn: async () => {
      if (cart.length === 0) throw new Error("Cart is empty");

      const key = idempotencyKey || crypto.randomUUID();
      setIdempotencyKey(key);

      // Refresh availability to avoid stale client data
      const refreshed = await Promise.all(
        cart.map(async (c) => {
          const res = await api.get(`/parts/${c.part._id}`);
          const part = res.data;
          const available =
            part.availableQty ??
            (part.onHandQty ?? 0) - (part.reservedQty ?? 0);
          return { part: { ...part, availableQty: available }, qty: c.qty };
        })
      );

      // Reflect latest availability in UI
      setCart(refreshed);

      const insufficientLine = refreshed.find((c) => {
        const available =
          c.part.availableQty ??
          (c.part.onHandQty ?? 0) - (c.part.reservedQty ?? 0);
        return typeof available === "number" && c.qty > available;
      });
      if (insufficientLine) {
        const available =
          (insufficientLine.part.availableQty ??
            (insufficientLine.part.onHandQty ?? 0) -
              (insufficientLine.part.reservedQty ?? 0)) ||
          0;
        setInsufficient({
          part: insufficientLine.part,
          available,
          requested: insufficientLine.qty,
        });
        throw new Error(
          `Insufficient stock for ${insufficientLine.part._id}. Available ${available}`
        );
      }

      let custId = customerId || undefined;
      const hasCustomerInput =
        (customer.name || "").trim() ||
        (customer.phone || "").trim() ||
        (customer.email || "").trim();
      if (!useExisting && hasCustomerInput) {
        if (!(customer.name || "").trim() || !(customer.phone || "").trim()) {
          throw new Error("Customer name and phone required");
        }
        const res = await api.post("/customers", {
          name: customer.name.trim(),
          phone: customer.phone.trim(),
          email: customer.email?.trim() || undefined,
        });
        custId = res.data._id;
      }

      const items = refreshed.map((c) => ({ partId: c.part._id, qty: c.qty }));
      const res = await api.post(
        "/counter-sales/checkout",
        {
          customerId: custId,
          items,
          payment,
        },
        { headers: { "Idempotency-Key": key } }
      );
      setInvoiceInfo({
        id: res.data.invoice._id,
        number: res.data.invoice.invoiceNumber,
      });
      return res.data as CheckoutResponse;
    },
    onSuccess: (data) => {
      toast.show({
        title: "Sale completed",
        description: (
          <Link href="/work-orders" className="underline">
            Invoice {data?.invoice?.invoiceNumber || ""}
          </Link>
        ),
        variant: "success",
      });
      setCart([]);
      setIdempotencyKey(null);
      setPaymentInput("0");
      setPayment((p) => ({ ...p, amount: 0 }));
    },
    onError: async (err: unknown) => {
      const message =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        (err instanceof Error ? err.message : undefined) ||
        "Unable to complete sale. Verify stock or retry.";
      if (message.includes("Insufficient")) {
        const partIdMatch = message.match(/for ([A-Za-z0-9]+)/i);
        const partId = partIdMatch ? partIdMatch[1] : undefined;
        const availableMatch = message.match(/Available\s+(\d+)/i);
        const availableParsed = availableMatch
          ? Number(availableMatch[1])
          : undefined;
        const target = partId
          ? cart.find((c) => c.part._id === partId)
          : cart[0];
        let latestAvailable = availableParsed;
        let part = target?.part;
        if (target && latestAvailable === undefined) {
          try {
            const res = await api.get(`/parts/${target.part._id}`);
            const fetched = res.data;
            latestAvailable =
              fetched.availableQty ??
              (fetched.onHandQty ?? 0) - (fetched.reservedQty ?? 0);
            part = {
              ...target.part,
              ...fetched,
              availableQty: latestAvailable,
            };
          } catch {
            /* ignore */
          }
        }
        if (target && part) {
          setInsufficient({
            part,
            available: latestAvailable ?? target.part.availableQty ?? 0,
            requested: target.qty,
          });
        }
      }
      toast.show({
        title: "Checkout failed",
        description: message.includes("Insufficient")
          ? "Insufficient stock. Reduce quantity or receive stock, then retry."
          : message.includes("Customer name and phone required")
            ? "Enter customer name and phone or leave all customer fields blank."
            : message,
        variant: "error",
      });
    },
  });

  const reduceQty = () => {
    if (!insufficient?.part) return;
    setCart((prev) =>
      prev
        .map((c) =>
          c.part._id === insufficient.part?._id
            ? { ...c, qty: insufficient.available }
            : c
        )
        .filter((c) => c.qty > 0)
    );
    setInsufficient(null);
  };

  const removeFromCart = (id: string) =>
    setCart((prev) => prev.filter((c) => c.part._id !== id));
  const updateQty = (id: string, delta: number) =>
    setCart((prev) =>
      prev
        .map((c) =>
          c.part._id === id ? { ...c, qty: Math.max(1, c.qty + delta) } : c
        )
        .filter((c) => c.qty > 0)
    );

  const printInvoice = async () => {
    if (!invoiceInfo) return;
    try {
      const invoiceRes = await api.get("/invoices");
      const invoice = (invoiceRes.data as { _id: string; invoiceNumber: string; lineItems: unknown[] }[]).find(
        (inv) => inv._id === invoiceInfo.id
      );
      if (!invoice) throw new Error("Invoice not found");
      const pdfUrl = `${getPdfBaseUrl()}/pdf/invoice`;
      const pdfRes = await fetch(pdfUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.accessToken || ""}`,
        },
        body: JSON.stringify({
          invoiceNumber: invoice.invoiceNumber,
          customerName: customer.name || "Customer",
          lineItems: invoice.lineItems,
        }),
      });
      const data = await pdfRes.json();
      if (data?.base64) {
        const win = window.open("");
        if (win) {
          win.document.write(
            `<iframe width='100%' height='100%' src='data:application/pdf;base64,${data.base64}'></iframe>`
          );
        }
      }
    } catch (err: unknown) {
      toast.show({
        title: "Print failed",
        description: err instanceof Error ? err.message : "Unable to print invoice.",
        variant: "error",
      });
    }
  };

  if (!canSell) {
    return (
      <Shell>
        <div className="glass p-6 rounded-xl">
          <p className="font-semibold text-foreground">View-only</p>
          <p className="text-sm text-muted-foreground">
            Only Inventory Manager / Service Advisor / Admin can perform counter
            sales.
          </p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Counter Sale</h1>
          <p className="text-muted-foreground text-sm">Scan, sell, and print quickly.</p>
        </div>
        <div className="flex items-center gap-2">
          {invoiceInfo && (
            <Button variant="outline" onClick={printInvoice}>
              Print invoice
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="glass p-4 rounded-xl space-y-3 lg:col-span-2">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
            <div className="flex-1">
              <Input
                ref={searchRef}
                placeholder="Scan barcode or type name/SKU"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onFocus={() => setShowPartResults(true)}
                onBlur={() => setTimeout(() => setShowPartResults(false), 120)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    addPartToCart(search);
                    e.preventDefault();
                  }
                }}
                aria-label="Scan or search input"
                className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
              />
              {addError && <p className="text-xs text-red-400 mt-1">{addError}</p>}
              {showPartResults && (
                <div className="mt-2 rounded-lg border border-border bg-card/95 shadow-lg">
                  {partsQuery.isFetching && (
                    <div className="p-3 text-sm text-muted-foreground">Searching parts...</div>
                  )}
                  {partsQuery.isError && (
                    <div className="p-3 text-sm text-muted-foreground">
                      Unable to load parts.{" "}
                      <button className="underline" onClick={() => partsQuery.refetch()}>
                        Retry
                      </button>
                    </div>
                  )}
                  {!partsQuery.isFetching && (partsQuery.data?.items || []).length === 0 && (
                    <div className="p-3 text-sm text-muted-foreground">
                      {debouncedSearch ? "No parts found." : "Start typing to search parts."}
                    </div>
                  )}
                  {!partsQuery.isFetching &&
                    !partsQuery.isError &&
                    (partsQuery.data?.items || []).map((part) => (
                      <button
                        key={part._id}
                        type="button"
                        className="w-full text-left px-3 py-2 text-sm hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => addPartDirect(part)}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <p className="font-semibold text-foreground">{part.partName}</p>
                            <p className="text-[11px] text-muted-foreground">SKU {part.sku}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-xs text-muted-foreground">Avail {part.availableQty ?? part.onHandQty ?? 0}</p>
                            <p className="text-xs text-foreground">Tk. {(part.sellingPrice || 0).toFixed(2)}</p>
                          </div>
                        </div>
                      </button>
                    ))}
                </div>
              )}
            </div>
            <Button variant="secondary" onClick={() => addPartToCart(search)}>
              Add
            </Button>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={scanMode}
                onChange={(e) => setScanMode(e.target.checked)}
                aria-label="Toggle scan mode"
              />
              <span className="text-muted-foreground">Scan mode</span>
              {scanMode && <Badge variant="secondary">Scan mode ON (press / to focus)</Badge>}
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={useExisting}
                onChange={(e) => setUseExisting(e.target.checked)}
              />
              Use existing customer ID
            </label>
            {useExisting ? (
              <div className="relative">
                <Input
                  placeholder="Search by phone number..."
                  value={searchPhone}
                  onChange={(e) => {
                    setSearchPhone(e.target.value);
                    setShowSearchResults(true);
                  }}
                  className="text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                />
                {searchPhone.length >= 3 && showSearchResults && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-secondary border border-border rounded-lg shadow-lg z-10 max-h-48 overflow-y-auto">
                    {isSearching && <div className="p-3 text-muted-foreground text-sm">Searching...</div>}
                    {searchError && (
                      <div className="p-3 text-muted-foreground text-sm">
                        Search failed.{" "}
                        <button className="underline" onClick={() => refetchSearch()}>
                          Retry
                        </button>
                      </div>
                    )}
                    {!isSearching && !searchError && searchResults && searchResults.length > 0 ? (
                      <div>
                        {searchResults.map((cust) => (
                          <button
                            key={cust._id}
                            onClick={() => handleSelectCustomer(cust)}
                            className="w-full text-left p-3 border-b border-border last:border-b-0 cursor-pointer hover:bg-muted transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                          >
                            <p className="font-semibold text-foreground text-sm">{cust.name}</p>
                            <p className="text-muted-foreground text-xs">{cust.phone}</p>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="p-3 text-muted-foreground text-sm">No customers found</div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <Input
                  placeholder="Customer name"
                  value={customer.name}
                  onChange={(e) => setCustomer((p) => ({ ...p, name: e.target.value }))}
                  className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                />
                <Input
                  placeholder="Phone"
                  value={customer.phone}
                  onChange={(e) => setCustomer((p) => ({ ...p, phone: e.target.value }))}
                  className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                />
                <Input
                  placeholder="Email (optional)"
                  value={customer.email}
                  onChange={(e) => setCustomer((p) => ({ ...p, email: e.target.value }))}
                  className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                />
              </div>
            )}
          </div>

          <div className="glass p-4 rounded-xl">
            <div className="flex items-center justify-between mb-3">
              <p className="font-semibold text-foreground">Cart</p>
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{cart.length} items</Badge>
                <Button
                  variant="ghost"
                  onClick={() => setClearConfirm(true)}
                  disabled={cart.length === 0 || checkout.isPending}
                >
                  Clear cart
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              {cart.map((item) => {
                const lineTotal = (item.part.sellingPrice || 0) * item.qty;
                return (
                  <div
                    key={item.part._id}
                    className="flex flex-col sm:flex-row sm:items-center sm:justify-between rounded-lg border border-border px-3 py-2 gap-2"
                  >
                    <div>
                      <p className="font-semibold">{item.part.partName}</p>
                      <p className="text-xs text-muted-foreground">SKU {item.part.sku}</p>
                      <p className="text-xs text-muted-foreground">Available {item.part.availableQty ?? "?"}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        variant="outline"
                        aria-label={`Decrease ${item.part.partName}`}
                        onClick={() => updateQty(item.part._id, -1)}
                      >
                        -
                      </Button>
                      <span className="w-8 text-center">{item.qty}</span>
                      <Button
                        variant="outline"
                        aria-label={`Increase ${item.part.partName}`}
                        onClick={() => updateQty(item.part._id, 1)}
                      >
                        +
                      </Button>
                      <Badge variant="secondary">{formatCurrency(item.part.sellingPrice || 0)} ea</Badge>
                      <Badge variant="secondary">{formatCurrency(lineTotal)}</Badge>
                      <Button
                        variant="ghost"
                        onClick={() => removeFromCart(item.part._id)}
                        aria-label={`Remove ${item.part.partName}`}
                      >
                        Remove
                      </Button>
                    </div>
                  </div>
                );
              })}
              {cart.length === 0 && (
                <EmptyState
                  title="No items in cart"
                  description="Scan or search to add parts."
                  action={
                    <Button onClick={() => searchRef.current?.focus()} variant="secondary">
                      Search parts
                    </Button>
                  }
                />
              )}
            </div>
          </div>
        </div>

        <div className="glass p-4 rounded-xl space-y-4">
          <div className="flex items-center justify-between">
            <p className="font-semibold text-foreground">Payment</p>
            <Badge variant="secondary">Cart {formatCurrency(subtotal)}</Badge>
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
            {["CASH", "CARD", "BANK"].map((m) => (
              <Button
                key={m}
                variant={payment.method === m ? "default" : "secondary"}
                onClick={() => setPayment((p) => ({ ...p, method: m }))}
              >
                {m}
              </Button>
            ))}
          </div>
          <CurrencyInput
            value={paymentInput}
            onChange={handlePaymentChange}
            placeholder="Amount"
            allowEmpty={false}
            min={0}
            aria-label="Payment amount"
          />
          <p className="text-xs text-muted-foreground">Payment must cover total.</p>
          {paymentError && <p className="text-xs text-red-400">{paymentError}</p>}

          <div className="border-t border-border pt-3 space-y-1 text-sm">
            <div className="flex items-center justify-between">
              <span>Subtotal</span>
              <span>{formatCurrency(subtotal)}</span>
            </div>
            <div className="flex items-center justify-between text-muted-foreground">
              <span>Tax</span>
              <span>--</span>
            </div>
            <div className="flex items-center justify-between text-muted-foreground">
              <span>Discount</span>
              <span>--</span>
            </div>
            <div className="flex items-center justify-between font-semibold text-foreground">
              <span>Grand Total</span>
              <span>{formatCurrency(grandTotal)}</span>
            </div>
          </div>

          <Button
            onClick={() => {
              if (cart.length === 0) {
                toast.show({ title: "Cart empty", description: "Add at least one item.", variant: "error" });
                return;
              }
              if (paymentAmountNumber < grandTotal || paymentAmountNumber <= 0) {
                const msg = `Payment must be at least ${formatCurrency(grandTotal)}.`;
                setPaymentError(msg);
                toast.show({ title: "Payment too low", description: msg, variant: "error" });
                return;
              }
              setPaymentError(null);
              checkout.mutate();
            }}
            isLoading={checkout.isPending}
            disabled={checkout.isPending || cart.length === 0 || paymentAmountNumber < grandTotal || !!paymentError}
            className="w-full"
          >
            Checkout
          </Button>

          {invoiceInfo && (
            <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
              <p className="font-semibold text-foreground">Receipt created</p>
              <p className="text-sm text-muted-foreground">Invoice #{invoiceInfo.number}</p>
              <p className="text-xs text-muted-foreground">Receipt ID: {invoiceInfo.id}</p>
              <div className="flex gap-2">
                <Button asChild variant="secondary">
                  <Link href="/work-orders">View invoice</Link>
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setCart([]);
                    setInvoiceInfo(null);
                    setPaymentInput("0");
                    setPayment((p) => ({ ...p, amount: 0 }));
                    setPaymentError(null);
                  }}
                >
                  Start new sale
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      <Dialog open={clearConfirm} onClose={() => setClearConfirm(false)} title="Clear cart?">
        <p className="text-sm text-muted-foreground">Remove all items from the cart?</p>
        <div className="flex justify-end gap-2 mt-3">
          <Button variant="ghost" onClick={() => setClearConfirm(false)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              setCart([]);
              setPaymentInput("0");
              setPayment((p) => ({ ...p, amount: 0 }));
              setInvoiceInfo(null);
              setPaymentError(null);
              setClearConfirm(false);
            }}
          >
            Clear cart
          </Button>
        </div>
      </Dialog>

      <Dialog
        open={!!insufficient}
        onClose={() => setInsufficient(null)}
        title="Insufficient stock"
      >
        <p className="text-sm text-muted-foreground">
          Requested {insufficient?.requested} but only {insufficient?.available}{" "}
          available for {insufficient?.part?.partName}. Reduce qty?
        </p>
        <div className="flex justify-end gap-2 mt-3">
          <Button variant="ghost" onClick={() => setInsufficient(null)}>
            Cancel
          </Button>
          <Button onClick={reduceQty}>Reduce to available</Button>
        </div>
      </Dialog>
    </Shell>
  );
}
