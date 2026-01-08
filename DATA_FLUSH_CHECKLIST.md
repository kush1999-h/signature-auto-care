# Pre-Production Data Flush Checklist

## ✅ System Verification Complete

All components have been scanned and verified:

### Backend Services ✅

- [x] work-orders.service.ts - clockIn/clockOut auto-status, takePayment flow
- [x] reports.service.ts - COGS uses CLOSED invoices only
- [x] invoices.service.ts - Decimal128 conversions
- [x] work-orders.controller.ts - All endpoints with proper permissions

### Frontend UI ✅

- [x] work-orders/[id]/page.tsx - Technician and Service Advisor separated
- [x] work-orders/page.tsx - Currency display (Tk.)
- [x] All currency displays updated ($ → Tk.)
- [x] Mutations for all operations (clock in/out, billing, payment)

### Database Schemas ✅

- [x] work-order.schema.ts - billableLaborAmount, otherCharges
- [x] inventory-transaction.schema.ts - unitCost REQUIRED
- [x] invoice.schema.ts - costAtTime field
- [x] payment.schema.ts - Ready for payment records

### Permissions & RBAC ✅

- [x] Service Advisors have INVOICES_CLOSE permission
- [x] Technicians/Painters blocked from billing updates
- [x] Clock in/out restricted to proper roles
- [x] All endpoints check permissions

### Tests ✅

- [x] rbac.spec.ts - PASS
- [x] inventory.spec.ts - PASS
- [x] workorder-invoice.spec.ts - PASS
- [x] All 9 tests passing

---

## 🔄 Data Flush Procedure

### Before Flushing:

1. **Backup Database**

   ```bash
   # Backup current MongoDB
   mongodump --uri "mongodb://localhost:27017/signature_auto_care" --out /path/to/backup
   ```

2. **Verify All Services Are Stopped**

   ```bash
   # Stop API
   npm run stop:api
   # Stop Web
   npm run stop:web
   ```

3. **Clear Collections**
   ```javascript
   // In MongoDB client:
   db.workorders.deleteMany({});
   db.invoices.deleteMany({});
   db.payments.deleteMany({});
   db.inventorytransactions.deleteMany({});
   db.timelogs.deleteMany({});
   // Keep: customers, vehicles, parts, users, expenses, roles
   ```

### After Flushing:

4. **Start Services**

   ```bash
   npm run dev:api
   npm run dev:web
   ```

5. **Verify Database Connection**
   - Check API logs for successful MongoDB connection
   - Check Web loads without errors

---

## 🧪 Manual Testing Workflow

### Test Scenario 1: Complete Work Order Lifecycle

**Step 1: Create Work Order** (as Service Advisor)

- Go to Work Orders → Create New
- Fill: Customer, Vehicle, Complaint
- Expected: Status = SCHEDULED

**Step 2: Assign Technician** (as OPS Manager or Service Advisor)

- Open work order
- Click "Update assignments"
- Select a technician
- Expected: Technician appears in "Assigned" section

**Step 3: Technician Clocks In**

- Log in as Technician
- Open work order
- Click "Clock In" in Technician Dashboard
- Expected:
  - Status changes to IN_PROGRESS
  - Time log created
  - Button changes to "Clock Out"

**Step 4: Issue Part** (as Technician)

- In same work order
- Scroll to "Issue Part"
- Search for a part (e.g., "Oil")
- Enter quantity: 2
- Click "Issue"
- Expected:
  - Part appears in "Parts Used" section
  - Stock decreases by 2
  - Cost captured in work order

**Step 5: Technician Clocks Out**

- Click "Clock Out" button
- Expected:
  - Status changes to COMPLETED
  - Duration displays (e.g., "15 min")
  - Message: "✓ Work completed. Service Advisor will take payment."

**Step 6: Service Advisor Adds Charges**

- Log in as Service Advisor
- Open same work order
- In "Billing & Charges" section:
  - Labor: 500
  - Add charge: "Service Fee" = 200
  - Click "Save Billing"
- Expected:
  - Subtotal = (2 × oil price) + 500 + 200
  - Total displayed
  - Financials card shows breakdown

**Step 7: Take Payment**

- Still as Service Advisor
- Click green "✓ Done & Bill Paid (Tk. amount)" button
- Expected:
  - Button changes to "✓ Work order closed & paid"
  - Status = CLOSED
  - UI confirms payment taken

---

### Test Scenario 2: Dashboard Profit Calculation

**After completing Scenario 1:**

1. **Check Dashboard**
   - Go to Reports → Sales
   - Expected Values:
     - Revenue: Tk. (subtotal from work order)
     - COGS: Tk. (2 × oil cost)
     - Gross Profit: Revenue - COGS
     - Expenses: Tk. (if any expenses created)
     - Net Profit: Gross Profit - Expenses

2. **Verify COGS Calculation**
   - COGS should NOT include labor
   - COGS should be: 2 × (oil cost at time of issue)
   - Verify with: Revenue - COGS = profit expected

3. **Create Another Work Order & Don't Take Payment**
   - Repeat steps 1-5 (assign, clock in, issue parts, clock out)
   - Don't proceed to step 6-7
   - Expected:
     - Invoice created but DRAFT (not CLOSED)
     - Should NOT appear in dashboard revenue
     - Dashboard profit remains unchanged

4. **Complete Payment on Second Work Order**
   - Log in as Service Advisor
   - Add charges (labor + other)
   - Click "Done & Bill Paid"
   - Expected:
     - Now appears in dashboard
     - Revenue increases
     - COGS increases
     - Profit recalculated

---

### Test Scenario 3: Permission Restrictions

**Test: Technician Cannot Edit Billing**

1. Log in as Technician
2. Open work order
3. Expected: "Technician Dashboard" shown, NO "Billing & Charges" section

**Test: Service Advisor Cannot Clock In**

1. Log in as Service Advisor
2. Open work order
3. Expected: No "Clock In" button in main area (only in Technician Dashboard if shown)

**Test: Finance/Accountant Views Only Reports**

1. Log in as Accountant
2. Expected: Can view Reports/Sales and Profits
3. Expected: Cannot create/modify work orders

---

## 📋 Data Validation Checks

### After Each Test, Verify:

1. **Database Records**

   ```javascript
   // Check work order
   db.workorders.findOne({ _id: ObjectId("...") });
   // Verify: status, billableLaborAmount, otherCharges, partsUsed

   // Check invoice
   db.invoices.findOne({ workOrderId: ObjectId("...") });
   // Verify: status = "CLOSED", lineItems with costAtTime

   // Check payment
   db.payments.findOne({ invoiceId: ObjectId("...") });
   // Verify: method = "CASH", amount matches total, paidAt is recent
   ```

2. **Inventory**
   - Issued part stock should decrease
   - costAtTime should be populated
   - No $0 costs

3. **Audit Logs**
   ```javascript
   db.auditlogs
     .find({ entityId: ObjectId("...") })
     .sort({ createdAt: -1 })
     .limit(10);
   // Should see: CLOCK_IN, CLOCK_OUT, PAYMENT, STATUS_UPDATE events
   ```

---

## ⚠️ Known Limitations (For Reference)

1. **Tax Not Implemented** - Currently always 0
   - Can be extended later with tax calculation logic

2. **Multiple Technicians** - Each can clock in separately
   - Duration calculated per person
   - Total time is sum of all logs

3. **Bulk Operations** - Not currently supported
   - Must be done one-by-one through UI

4. **Refunds** - Payment cannot be reversed
   - Would require VOID invoice and negative payment

---

## 🚀 Production Readiness

### Before Going Live:

- [x] All code reviewed and tested
- [x] Database schemas ready
- [x] Permissions configured
- [x] RBAC enforced
- [x] Accounting logic verified
- [x] UI/UX separated by role
- [x] Currency localized (Tk.)
- [x] All 9 tests passing

### After Data Flush:

- [ ] Run test scenarios 1-3 above
- [ ] Verify dashboard calculations
- [ ] Check audit logs for all actions
- [ ] Verify currency displays correctly
- [ ] Confirm no error messages in console
- [ ] Test with multiple users simultaneously

---

## 📞 Support Notes

### If Issues Arise:

1. **Clock In Not Changing Status**
   - Check: Is user assigned to work order?
   - Check: Is work order in SCHEDULED status?
   - Check: Does user have TIMELOGS_CREATE_SELF permission?

2. **Billing Section Not Showing**
   - Check: Is user logged in as Service Advisor?
   - Check: Does user have WORKORDERS_UPDATE_STATUS permission?

3. **"Done & Bill Paid" Button Not Appearing**
   - Check: Is work order status COMPLETED?
   - Check: Does invoice exist?
   - Check: Is user a Service Advisor with INVOICES_CLOSE?

4. **Dashboard Shows Wrong Profit**
   - Check: Are invoices actually CLOSED (not DRAFT)?
   - Check: Do line items have costAtTime?
   - Run: `db.invoices.find({status: "CLOSED"})` to verify

5. **Part Not Issued (Stock Not Decreasing)**
   - Check: Does user have INVENTORY_ISSUE_TO_WORKORDER?
   - Check: Is part in stock (quantity > 0)?
   - Check: Is user assigned to work order?

---

## ✅ Final Checklist Before Flush

- [x] Backup database
- [x] All tests passing
- [x] Code reviewed
- [x] Workflow document created
- [x] Testing scenarios prepared
- [x] Permission matrix verified
- [x] UI separation confirmed
- [x] RBAC enforcement checked

**STATUS: READY FOR DATA FLUSH AND PRODUCTION TESTING** 🚀

Date: December 27, 2025
System: Signature Auto Care Accounting System
Version: v2.0 (Role-Based Workflow)
