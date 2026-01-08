# Role-Based Work Order Workflow Guide

## Overview

This document outlines the complete workflow for work order management with role-based responsibilities:

- **Technician/Painter**: Clock in/out, issue parts
- **Service Advisor**: Add charges, close work orders, take payments

---

## Complete Workflow

### 1. **Work Order Created**

- Status: `SCHEDULED`
- Assigned to Technician(s) and/or Painter(s)
- Invoice: Not yet created

### 2. **Technician/Painter Actions**

#### Clock In

**When**: Technician or Painter clocks in
**Action**:

- Creates a time log entry
- **Auto-updates work order status from `SCHEDULED` → `IN_PROGRESS`**
- Starts tracking work time

**UI**: Technician Dashboard (sidebar)

- Button: "Clock In"
- Shows current work status and time tracked

#### Issue Parts

**When**: Technician or Painter issues parts to the work order
**Action**:

- Reduces inventory stock
- Records part cost at time of issue (for COGS calculation)
- Records selling price (for invoice)
- Updates parts list on work order

**Permissions Required**: `INVENTORY_ISSUE_TO_WORKORDER`

**UI**: "Issue Part" section

- Search and select parts
- Confirm quantity
- Parts appear in "Parts Used" section

#### Clock Out

**When**: Technician or Painter completes their work and clocks out
**Action**:

- Ends time log entry
- Calculates duration in minutes
- **Auto-updates work order status from `IN_PROGRESS` (or `WAITING_PARTS`) → `COMPLETED`**
- System ready for Service Advisor to finalize

**UI**: Technician Dashboard (sidebar)

- Button: "Clock Out" (only visible when clocked in)
- Shows message: "Work completed. Service Advisor will take payment."

---

### 3. **Service Advisor Actions**

Once the work order status reaches `COMPLETED`, only the Service Advisor can proceed.

#### Add Labour & Other Charges

**When**: Service Advisor needs to add billable labour or miscellaneous charges
**Action**:

- Adds billable labour amount (can be fixed or calculated from time logs)
- Adds other charges (supplies, diagnostics, etc.)
- Updates invoice totals dynamically

**Permissions Required**: Must be `SERVICE_ADVISOR` role (technically requires WORKORDERS_UPDATE_STATUS)

**UI**: "Billing & Charges" section (sidebar)

- Input field for labour (Tk.)
- Add button for other charges
- Each charge requires: Name and Amount
- Subtotal automatically calculated

#### Save Billing

**Action**:

- Validates all amounts are non-negative
- Saves labour and other charges to work order
- Updates financial summary
- **Does NOT close invoice yet** - just saves billing info

**UI**: "Save billing" button

- Only visible to non-Technician/Painter roles (Service Advisor, Manager, Admin)

#### Complete Payment ("Done & Bill Paid")

**When**: Service Advisor confirms work complete and payment taken
**Action**:

1. **Closes Invoice**
   - Changes invoice status from `DRAFT` → `CLOSED`
   - Makes it visible in revenue calculations
2. **Records Payment**
   - Creates payment record with method "CASH"
   - Amount = Total (labour + parts + other charges)
3. **Updates Work Order Status**
   - Changes from `COMPLETED` → `CLOSED`
   - Indicates work order is fully complete
4. **Updates Dashboard Calculations**
   - Revenue now includes this invoice
   - COGS calculated from this invoice's line items
   - Profit immediately updated

**UI**: "✓ Done & Bill Paid" button

- Only visible when work order status is `COMPLETED`
- Shows total amount being billed
- Green button indicating finalization

---

## Status Flow Diagram

```
SCHEDULED (Technician assigned)
    ↓
[Technician clocks in]
    ↓
IN_PROGRESS
    ↓
[Technician issues parts as needed]
    ↓
[Technician clocks out]
    ↓
COMPLETED (Ready for Service Advisor)
    ↓
[Service Advisor adds charges & takes payment]
    ↓
CLOSED (Fully complete, invoice closed, payment recorded)
```

---

## Key Features

### 1. **Automatic Status Updates**

- Clock In → Status becomes IN_PROGRESS
- Clock Out → Status becomes COMPLETED
- Payment Taken → Status becomes CLOSED

### 2. **Automatic Invoice Creation & Closing**

- When payment is taken, invoice is automatically created/updated
- Invoice moves to CLOSED status (no longer DRAFT)
- Enables it for profit calculations

### 3. **Role-Based UI**

- **Technician/Painter**: See only "Technician Dashboard" with Clock In/Out
- **Service Advisor**: See full "Billing & Charges" section with payment button
- Assignments section hidden from technicians (only visible to managers/admins)

### 4. **Financial Accuracy**

- Labour + Parts + Other Charges = Total Invoice
- COGS calculated only from CLOSED invoices (no draft invoices)
- Each part issue records cost at that moment (historical cost tracking)
- Dashboard profit = Revenue - COGS - Expenses

### 5. **Audit Trail**

- All status changes logged
- Time clock entries recorded with employee ID
- Payment records created with full details
- Billing changes audited

---

## Permission Requirements

| Action                    | Required Permission                                 |
| ------------------------- | --------------------------------------------------- |
| Clock In/Out              | `TIMELOGS_CREATE_SELF`                              |
| Issue Parts               | `INVENTORY_ISSUE_TO_WORKORDER`                      |
| Add/Edit Labour & Charges | Service Advisor role (tech/painter blocked)         |
| Take Payment              | `INVOICES_CLOSE`                                    |
| Assign Employees          | `WORKORDERS_ASSIGN_EMPLOYEE`                        |
| View Work Order           | `WORKORDERS_READ_ALL` or `WORKORDERS_READ_ASSIGNED` |

---

## Example Scenario

**Day 1 - Work**

1. Work order WO-001 created for customer, assigned to Technician Tom
2. 9:00 AM: Tom clicks "Clock In" → Status changes to IN_PROGRESS
3. Tom issues parts (Oil filter, Air filter) → Deducted from inventory
4. 1:00 PM: Tom clicks "Clock Out" → Status changes to COMPLETED
   - Total work time: 4 hours

**Day 1 - Billing**

1. Service Advisor Sarah views the work order
2. Sees "Billing & Charges" section
3. Adds:
   - Labour: Tk. 1200 (Technician rate)
   - Other: Tk. 200 (Diagnostics fee)
   - Parts: Tk. 2000 (Oil filter Tk. 1000 + Air filter Tk. 1000)
4. Total: Tk. 3400
5. Clicks "✓ Done & Bill Paid (Tk. 3400)"
   - Invoice status: DRAFT → CLOSED
   - Payment record created
   - Work order status: COMPLETED → CLOSED
   - Dashboard now shows this revenue in calculations

---

## Troubleshooting

### Q: Technician can't clock in

**A**: Check that:

- Technician has `TIMELOGS_CREATE_SELF` permission
- Work order is assigned to them
- They don't already have an active clock-in

### Q: Service Advisor can't see "Done & Bill Paid" button

**A**: Check that:

- Work order status is exactly `COMPLETED` (must clock out first)
- Service Advisor has `INVOICES_CLOSE` permission

### Q: Profit calculation seems off

**A**: Verify:

- Invoice status is `CLOSED` (must click "Done & Bill Paid")
- All parts have cost recorded (required field)
- No DRAFT invoices are included (only CLOSED ones count)

### Q: Parts aren't deducting from inventory

**A**: Check that:

- User has `INVENTORY_ISSUE_TO_WORKORDER` permission
- Work order exists and is valid
- Part has sufficient stock available
- Part cost (avgCost) is set in inventory system

---

## Database Changes

### Work Order Schema

- Added auto-status updates on clock in/out
- Added `billableLaborAmount` field
- Added `otherCharges` array with name/amount

### Invoice Schema

- Status field controls visibility in profit calculations
- Only `CLOSED` invoices count for revenue
- Line items include LABOR and PART types

### Payment Schema

- Linked to work order
- Records method (CASH, CHECK, etc.)
- Records amount and timestamp
- Auto-created when work order finalized

---

## Next Steps (Future Enhancements)

1. **SMS/Email Notifications**: Notify customer when work completes
2. **Invoice PDF**: Generate PDF invoice for customer
3. **Part Return**: Allow technician to return unused parts
4. **Warranty Tracking**: Link parts to warranty periods
5. **Service History**: Show all past work orders for customer
6. **Recurring Maintenance**: Auto-create reminders for service intervals
