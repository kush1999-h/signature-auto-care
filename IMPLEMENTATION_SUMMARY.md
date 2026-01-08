# Role-Based Work Order Workflow - Implementation Summary

## Changes Made

### Backend (NestJS API)

#### 1. `work-orders.service.ts` - Auto-Status Updates

**Clock In Method (Line 670)**
```typescript
// NEW: Auto-update work order status to IN_PROGRESS when clocking in
if (wo.status === WorkOrderStatus.SCHEDULED) {
  wo.status = WorkOrderStatus.IN_PROGRESS;
  await wo.save();
}
```
- When technician clocks in, status automatically changes from SCHEDULED → IN_PROGRESS
- Eliminates manual status updates

**Clock Out Method (Line 748)**
```typescript
// NEW: Auto-update work order status to COMPLETED when clocking out
if (
  wo.status !== WorkOrderStatus.COMPLETED &&
  wo.status !== WorkOrderStatus.CLOSED
) {
  wo.status = WorkOrderStatus.COMPLETED;
  await wo.save();
}
```
- When technician clocks out, status automatically changes to COMPLETED
- Signals that work is done and ready for billing
- Service Advisor can now take payment

#### 2. Existing Endpoints Used
- `POST /work-orders/:id/time-logs/clock-in` → Auto-updates status
- `POST /work-orders/:id/time-logs/clock-out` → Auto-updates status
- `PATCH /work-orders/:id/billing` → Only Service Advisor role allowed
- `POST /work-orders/:id/take-payment` → Closes invoice & records payment

---

### Frontend (Next.js Web UI)

#### File: `apps/web/app/work-orders/[id]/page.tsx`

**Role Detection (Line 65-66)**
```typescript
const isServiceAdvisor = perms.role === "SERVICE_ADVISOR";
const isTechOrPainter = 
  perms.role === "TECHNICIAN" || perms.role === "PAINTER";
```

**New Mutation (Line 149-157)**
```typescript
const takePaymentMutation = useMutation({
  mutationFn: () =>
    api.post(`/work-orders/${id}/take-payment`, {
      method: "CASH",
      amount: financials.total,
    }),
  onSuccess: () => {
    qc.invalidateQueries({ queryKey: ["work-order-detail", id] });
  },
});
```

**Conditional UI Rendering (Line 561-629)**

#### TECHNICIAN/PAINTER VIEW
```tsx
{isTechOrPainter && (
  <div className="glass p-4 rounded-xl space-y-3">
    <p className="font-semibold text-foreground text-center">
      Technician Dashboard
    </p>
    <div className="flex flex-col gap-2">
      {/* Clock In/Out Buttons */}
      {!activeLog ? (
        <button onClick={() => clockIn.mutate()}>Clock In</button>
      ) : (
        <button onClick={() => clockOut.mutate()}>Clock Out</button>
      )}
      
      {/* Status Display */}
      <p>Status: {wo?.status}</p>
      
      {wo?.status === "COMPLETED" && (
        <p>✓ Work completed. Service Advisor will take payment.</p>
      )}
    </div>
  </div>
)}
```

Features:
- Large, prominent Clock In/Out buttons
- Current status display
- Time tracking summary
- Clear message when work is done

#### SERVICE ADVISOR VIEW
```tsx
{!isTechOrPainter && (
  <div className="glass p-4 rounded-xl space-y-3">
    {/* Billing Section - Labour & Other Charges */}
    <div>Labour input field</div>
    <div>Other charges add/remove</div>
    <div>Financial summary</div>
    
    {/* Save Billing Button */}
    <button onClick={handleBillingSave}>Save billing</button>
    
    {/* Done & Bill Paid Button - Only shows when COMPLETED */}
    {wo?.status === "COMPLETED" && (
      <button 
        onClick={() => takePaymentMutation.mutate()}
        className="bg-green-600 hover:bg-green-700"
      >
        ✓ Done & Bill Paid (Tk. {formatMoney(financials.total)})
      </button>
    )}
    
    {/* Completion Status - Shows when CLOSED */}
    {wo?.status === "CLOSED" && (
      <div>✓ Work order closed & paid</div>
    )}
  </div>
)}
```

Features:
- Labour amount input
- Add/remove other charges (name + amount)
- Real-time financial totals
- Save billing changes
- Green "Done & Bill Paid" button when work is complete
- Confirmation when work order is closed

**Other Changes**
- Hide Assignments section from technicians (line 660)
- Hide Time Log clock buttons from technicians in main area (line 398)
- Keep Issue Parts section visible to all assigned employees

---

## API Flow Diagram

```
TECHNICIAN                          SYSTEM                          SERVICE ADVISOR
                                       
    Clock In ─────→  POST /clock-in ─→ Auto-update status         
                      ├─ Create TimeLog    SCHEDULED → IN_PROGRESS
                      └─ Audit Log
                      
    Issue Parts ──→  POST /issue-part ──→ Deduct Inventory
                      ├─ Record Cost       Reduce Stock
                      ├─ Record Price      Create Transaction
                      └─ Audit Log
                      
    Clock Out ────→  POST /clock-out ──→  Auto-update status
                      ├─ Update TimeLog    IN_PROGRESS → COMPLETED
                      ├─ Save Duration
                      └─ Audit Log
                      
                                         Receives notification
                                         that work is complete
                                             │
                                             ↓
                          Add Labour ─→  PATCH /billing ──→  Update BillableLabor
                                             ├─ Validate
                                             └─ Save to WorkOrder
                                             
                          Add Charges ──→ PATCH /billing ──→  Update OtherCharges
                                             ├─ Validate
                                             └─ Save to WorkOrder
                                             
                          Save ──────→   (Work order updated)
                                             │
                                             ↓
                          Take Payment ──→ POST /take-payment ──→ Complex transaction:
                                                                   ├─ Close Invoice (DRAFT→CLOSED)
                                                                   ├─ Create Payment record
                                                                   ├─ Update WorkOrder (COMPLETED→CLOSED)
                                                                   └─ Trigger profit recalculation
                                                                   
                                         Invoice now visible in
                                         profit calculations
                                         
                                         Dashboard updated with:
                                         ├─ New Revenue
                                         ├─ New COGS
                                         └─ Updated Profit
```

---

## Status Progression

```
WORKFLOW START
      │
      ↓
┌─────────────────────────────────────────────────────────────────┐
│ SCHEDULED                                                         │
│ Work order created, technician(s) assigned                      │
│ No time logs, no invoice                                        │
└─────────────────────────────────────────────────────────────────┘
      │
      │ [Technician clicks Clock In]
      ↓
┌─────────────────────────────────────────────────────────────────┐
│ IN_PROGRESS                          ← STATUS AUTO-UPDATED      │
│ Active time log started              ← BY CLOCK IN              │
│ Technician can issue parts                                      │
│ Parts deducted from inventory                                   │
└─────────────────────────────────────────────────────────────────┘
      │
      │ [Technician clicks Clock Out]
      ↓
┌─────────────────────────────────────────────────────────────────┐
│ COMPLETED                            ← STATUS AUTO-UPDATED      │
│ Time log closed with duration        ← BY CLOCK OUT             │
│ Work is done                                                     │
│ Service Advisor can now:                                        │
│   - Add labour charges                                          │
│   - Add other charges                                           │
│   - View billing summary                                        │
│   - Take payment                                                │
└─────────────────────────────────────────────────────────────────┘
      │
      │ [Service Advisor clicks "Done & Bill Paid"]
      ↓
┌─────────────────────────────────────────────────────────────────┐
│ CLOSED                               ← STATUS AUTO-UPDATED      │
│ Invoice status: CLOSED (was DRAFT)   ← BY TAKE-PAYMENT          │
│ Payment record created               ← PAYMENT RECORDED         │
│                                                                  │
│ FINANCIAL IMPACT:                                               │
│ ✓ Revenue includes this invoice (was excluded as DRAFT)         │
│ ✓ COGS calculated from parts used                               │
│ ✓ Profit = Revenue - COGS - Expenses                            │
│ ✓ Dashboard immediately updated                                 │
└─────────────────────────────────────────────────────────────────┘

WORKFLOW COMPLETE
```

---

## Key Implementation Details

### 1. **Automatic Status Updates**
- No manual status changes needed by technician
- Status tied to clock in/out events
- Eliminates data entry errors

### 2. **Invoice Lifecycle**
```
Clock Out (COMPLETED)
    ↓
Service Advisor adds charges
    ↓
Service Advisor clicks "Done & Bill Paid"
    ↓
Invoice: DRAFT → CLOSED
Payment: Created
Status: COMPLETED → CLOSED
    ↓
Dashboard recalculates profit
```

### 3. **Role-Based Permissions**
| Role | Can | Cannot |
|------|-----|--------|
| Technician | Clock In/Out, Issue Parts | Add Charges, Take Payment |
| Painter | Clock In/Out, Issue Parts | Add Charges, Take Payment |
| Service Advisor | Add Charges, Take Payment, View All | Clock In/Out (unless assigned) |
| Manager | Everything | (Full access) |

### 4. **Financial Accuracy**
- Each part issue records cost at that moment (historical tracking)
- Only CLOSED invoices count toward revenue
- COGS = sum(quantity × costAtTime) for all line items in CLOSED invoices
- Profit = Revenue - COGS - Expenses

---

## Testing

All 9 tests pass:
```
PASS test/workorder-invoice.spec.ts
PASS test/inventory.spec.ts
PASS test/rbac.spec.ts

Tests: 9 passed, 9 total
```

Tests validate:
- Invoice creation and status changes
- RBAC permissions enforcement
- Inventory safety and accuracy
- Technician can issue parts
- Service Advisors can add charges
- Payment flow creates closed invoices

---

## Files Modified

### Backend
- `apps/api/src/modules/work-orders/work-orders.service.ts` (clockIn, clockOut methods)
- Existing endpoints leverage for role-based access

### Frontend
- `apps/web/app/work-orders/[id]/page.tsx` (UI reorganization and role-based views)

### Documentation
- `WORKFLOW_GUIDE.md` (Complete workflow documentation)
- `IMPLEMENTATION_SUMMARY.md` (This file)

---

## Deployment Notes

1. **No Database Migration Required**
   - All schema fields already exist
   - Changes are only to business logic and UI

2. **Backward Compatible**
   - Existing work orders continue to work
   - New status updates automatic going forward

3. **Rollback Plan**
   - Remove auto-status updates in service (revert 2 code blocks)
   - UI reverts to old view automatically
   - No data loss

4. **Monitoring Recommendations**
   - Track status update frequency (clock in/out events)
   - Monitor payment success rate
   - Alert on invoice creation anomalies
   - Audit trail review for accuracy

---

## Support

For questions or issues with the new workflow:
1. Verify user has correct role assigned
2. Check permission assignment for role
3. Review audit logs for status change history
4. Ensure clock in/out events are being recorded
5. Verify work order is in correct status before payment

