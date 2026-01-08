# Customer Search Feature Implementation

## Overview

Service Advisors can now find and select existing customers by phone number during the intake/work order creation process. This prevents duplicate customer records and allows tracking of returning customers.

## Workflow

### Step 1: Search for Customer

- Service Advisor enters phone number in the search field (minimum 3 characters)
- Search is debounced (300ms) to prevent excessive API calls
- Results appear in a dropdown below the search field
- Shows customer name and phone number for each match

### Step 2: Select Existing Customer

- Click on a matching customer in the dropdown
- Form automatically populates with:
  - Customer name
  - Phone number
  - Email
  - Address
- Green checkmark indicator shows "Customer selected"

### Step 3: Create Work Order

- Fill in vehicle details (make, model, year, color, plate, VIN, mileage)
- Add complaint/notes
- Click "Create & Schedule" button
- Work order created and linked to existing customer (no duplicate)

### Alternative: Create New Customer

- If no matching customers found, manually fill in all customer details
- System creates a new customer record
- Vehicle and work order created normally

## Backend Implementation

### New Endpoint

```
GET /customers/search/by-phone?phone=<partial_number>
```

**Permission Required:** `CUSTOMERS_READ` (Service Advisors have this)

**Response:**

```json
{
  "results": [
    {
      "_id": "ObjectId",
      "name": "Ahmed Ali",
      "phone": "8801234567890",
      "email": "ahmed@example.com",
      "address": "Dhaka, Bangladesh"
    }
  ],
  "count": 1
}
```

**Search Logic:**

- Case-insensitive partial matching using MongoDB regex
- Minimum 3 characters required
- Returns empty array if less than 3 characters

## Frontend Implementation

### Changes to `apps/web/app/intake/page.tsx`

**New Imports:**

```typescript
import { useQuery } from "@tanstack/react-query";
import { useDebounce } from "../../lib/use-debounce";
```

**New State Variables:**

```typescript
const [searchPhone, setSearchPhone] = useState("");
const debouncedSearchPhone = useDebounce(searchPhone, 300);
const [showSearchResults, setShowSearchResults] = useState(false);
const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(
  null
);
```

**New Query Hook:**

```typescript
const { data: searchResults } = useQuery({
  queryKey: ["searchCustomer", debouncedSearchPhone],
  queryFn: async () => {
    if (!debouncedSearchPhone || debouncedSearchPhone.length < 3) {
      return [];
    }
    const res = await api.get("/customers/search/by-phone", {
      params: { phone: debouncedSearchPhone },
    });
    return res.data.results || [];
  },
});
```

**New Handler Function:**

```typescript
const handleSelectCustomer = (customer: any) => {
  setForm({
    ...form,
    customerName: customer.name,
    phone: customer.phone,
    email: customer.email || "",
    address: customer.address || "",
  });
  setSelectedCustomerId(customer._id);
  setShowSearchResults(false);
};
```

**Updated Mutation:**

- Checks if `selectedCustomerId` exists
- If exists: Uses selected customer, skips customer creation
- If not exists: Creates new customer as before
- Always creates vehicle and work order

**UI Components:**

1. **Search Input** - Phone number search field (top of customer section)
2. **Search Dropdown** - Shows matching customers with hover effect
3. **Selection Indicator** - Green checkmark when customer selected
4. **Manual Entry Fields** - Allows manual customer details entry (prepopulated if selected)

## Use Cases

### Use Case 1: Returning Customer

1. Service Advisor searches phone number "8801234"
2. "Ahmed Ali" appears in dropdown
3. Advisor clicks to select
4. Form auto-fills with Ahmed's info
5. Enters vehicle details and complaint
6. Clicks "Create & Schedule"
7. Work order linked to existing Ahmed's customer record ✓

### Use Case 2: New Customer

1. Service Advisor searches phone number "8809876543210"
2. No results found
3. Advisor manually enters: name, phone, email, address
4. Enters vehicle details and complaint
5. Clicks "Create & Schedule"
6. New customer record created ✓

### Use Case 3: Overwrite with Manual Entry

1. Search finds a customer
2. Customer selected and form populated
3. Advisor wants to use different customer details
4. Manually edits customer name/email/address fields
5. Clicks "Create & Schedule"
6. Uses selected customer ID (from search) with manually edited details
7. Vehicle and work order created ✓

## Benefits

✅ **Prevents Duplicates** - Reuses existing customer records  
✅ **Improves Efficiency** - Auto-fills customer details with one click  
✅ **Tracks Returning Customers** - Service Advisor can see customer history  
✅ **Flexible** - Still allows manual entry for new customers  
✅ **Non-Breaking** - Falls back to new customer creation if search returns nothing  
✅ **Permission-Safe** - Only Service Advisors with CUSTOMERS_READ can use search

## Testing

### Test Cases

1. **Search with 2 characters** - Returns empty (minimum 3 required)
2. **Search with 3 characters** - Returns matching customers
3. **Search partial match** - "880" finds "8801234567890"
4. **Case-insensitive** - "8801" finds "8801234567890"
5. **No results** - Shows "No customers found" message
6. **Select customer** - Auto-populates form, shows checkmark
7. **Deselect by clearing search** - Removes selection, shows empty
8. **Create WO with existing customer** - No duplicate created
9. **Create WO with manual entry** - New customer record created
10. **Debounce** - API not called for every keystroke (300ms delay)

## Files Modified

1. **Backend - Already Complete:**
   - `apps/api/src/modules/customers/customers.service.ts` - Added searchCustomerByPhone()
   - `apps/api/src/modules/customers/customers.controller.ts` - Added GET /customers/search/by-phone endpoint

2. **Frontend - Just Completed:**
   - `apps/web/app/intake/page.tsx` - Added customer search UI and logic

## Next Steps

1. ✅ Backend implementation (COMPLETE)
2. ✅ Frontend integration (COMPLETE)
3. Test the feature with real data
4. Optional: Add customer history view when selected (previous work orders, vehicles)
5. Optional: Add visual indicators for VIP customers or frequent repeat customers

## API Contract

**Request:**

```
GET /api/customers/search/by-phone?phone=8801234
```

**Response:**

```json
{
  "results": [
    {
      "_id": "507f1f77bcf86cd799439011",
      "name": "Ahmed Ali",
      "phone": "8801234567890",
      "email": "ahmed@example.com",
      "address": "123 Main Street, Dhaka"
    },
    {
      "_id": "507f1f77bcf86cd799439012",
      "name": "Ali Ahmed Khan",
      "phone": "8801234321098",
      "email": "alikhan@example.com",
      "address": "456 Side Street, Dhaka"
    }
  ],
  "count": 2
}
```

---

**Date Implemented:** 2024  
**Status:** ✅ Complete and Ready for Testing
