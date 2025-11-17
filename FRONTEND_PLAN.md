# Frontend Plan: Driver & Terminal Management Dashboard

## 🎯 Page Overview

A single dashboard page that displays:

- All terminals with their online/offline status
- All drivers with their info
- Current driver assignments (which driver is using which terminal)
- How long each driver has been using their assigned terminal
- Ability to assign/unassign drivers to/from terminals

---

## 📋 Components Structure

```
DriverTerminalDashboard/
├── TerminalsList          (Left side or top)
├── DriversList            (Right side or middle)
└── AssignmentManager      (Modal or side panel)
```

---

## 🔌 API Endpoints to Use

### 1. Fetch All Data (On Page Load)

```javascript
// Get all terminals with status and driver assignments
GET /terminals?includeDrivers=true&includeStatus=true
Authorization: Bearer <token>

// OR use the simplified endpoint
GET /status/terminals?includeDrivers=true
Authorization: Bearer <token>

// Get all drivers
GET /drivers
// No auth needed
```

### 2. Assign Driver to Terminal

```javascript
POST /drivers/:driverId/assign
Content-Type: application/json
Body: {
  "terminalId": "2355209",
  "notes": "Morning shift - Times Square"
}
```

### 3. Unassign Driver from Terminal

```javascript
POST /drivers/:driverId/unassign
Content-Type: application/json
Body: {
  "terminalId": "2355209"
}
```

### 4. Get Driver Analytics (Optional - for detail view)

```javascript
GET /drivers/:driverId/analytics?startDate=2025-11-01&endDate=2025-11-17
```

---

## 🎨 UI Layout Options

### Option 1: Two-Column Layout

```
┌─────────────────────────────────────────────────────┐
│  Driver & Terminal Management Dashboard             │
├──────────────────────┬──────────────────────────────┤
│  TERMINALS (15)      │  DRIVERS (7)                 │
│  ● Online: 8         │  ● Active: 5                 │
│  ○ Offline: 7        │  ○ Available: 2              │
├──────────────────────┼──────────────────────────────┤
│                      │                              │
│  [Terminal Card]     │  [Driver Card]               │
│  LED Bag #1          │  Rubén Bocel                 │
│  ● Online            │  📦 Using: LED Bag #1        │
│  👤 Driver: Rubén    │  ⏱️  2.5 hours               │
│  ⏱️  2.5 hours       │  📱 347-558-7595             │
│  [Manage] [Details]  │  [Unassign] [Details]        │
│                      │                              │
│  [Terminal Card]     │  [Driver Card]               │
│  LED Bag #2          │  Juan Rivero                 │
│  ○ Offline           │  📦 Not Assigned             │
│  👤 Not Assigned     │  📱 917-679-9005             │
│  [Assign Driver]     │  [Assign Terminal]           │
│                      │                              │
└──────────────────────┴──────────────────────────────┘
```

### Option 2: Single Table View with Actions

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Driver & Terminal Management Dashboard                                 │
│  [Filter: All/Online/Offline] [Search...]                              │
├──────────────┬───────────┬─────────────────┬──────────────┬────────────┤
│ Terminal     │ Status    │ Driver          │ Duration     │ Actions    │
├──────────────┼───────────┼─────────────────┼──────────────┼────────────┤
│ LED Bag #1   │ ● Online  │ Rubén Bocel     │ 2.5 hrs      │ [Unassign] │
│ 2355209      │           │ 347-558-7595    │              │ [Details]  │
├──────────────┼───────────┼─────────────────┼──────────────┼────────────┤
│ LED Bag #2   │ ○ Offline │ Not Assigned    │ -            │ [Assign]   │
│ 2355210      │           │                 │              │ [Details]  │
├──────────────┼───────────┼─────────────────┼──────────────┼────────────┤
│ LED Bag #3   │ ● Online  │ Juan Rivero     │ 1.2 hrs      │ [Unassign] │
│ 2355211      │           │ 917-679-9005    │              │ [Details]  │
└──────────────┴───────────┴─────────────────┴──────────────┴────────────┘

Available Drivers (Not Assigned):
[Mohammad Fares] [Ali Fares] [red]
```

### Option 3: Card Grid with Quick Actions

```
┌─────────────────────────────────────────────────────┐
│  [All Terminals ▼] [All Drivers ▼] [🔍 Search]     │
└─────────────────────────────────────────────────────┘

┌───────────────┐ ┌───────────────┐ ┌───────────────┐
│ LED Bag #1    │ │ LED Bag #2    │ │ LED Bag #3    │
│ ● Online      │ │ ○ Offline     │ │ ● Online      │
│               │ │               │ │               │
│ 👤 Rubén B.   │ │ 👤 No Driver  │ │ 👤 Juan R.    │
│ ⏱️  2.5 hrs   │ │               │ │ ⏱️  1.2 hrs   │
│               │ │               │ │               │
│ [🔄 Change]   │ │ [➕ Assign]   │ │ [🔄 Change]   │
│ [ℹ️ Details]  │ │ [ℹ️ Details]  │ │ [ℹ️ Details]  │
└───────────────┘ └───────────────┘ └───────────────┘
```

---

## 🎬 User Flows

### Flow 1: Assign Driver to Terminal

1. User clicks **[Assign]** button on a terminal card
2. Modal/panel opens showing:
   - Terminal info (name, ID, status)
   - List of available drivers (not currently assigned)
   - Search/filter drivers
3. User selects a driver
4. User optionally adds notes (e.g., "Morning shift - Times Square route")
5. User clicks **[Assign]**
6. API call: `POST /drivers/:driverId/assign`
7. Success: Modal closes, page refreshes data
8. Terminal card now shows driver info
9. Driver card shows "Using: Terminal X"

### Flow 2: Unassign Driver from Terminal

1. User clicks **[Unassign]** button on terminal with driver
2. Confirmation dialog: "Unassign [Driver Name] from [Terminal Name]?"
3. User confirms
4. API call: `POST /drivers/:driverId/unassign`
5. Success: Page refreshes data
6. Terminal shows "Not Assigned"
7. Driver shows "Available"

### Flow 3: Change Driver Assignment (Swap)

1. User clicks **[Change]** on terminal with driver
2. Modal shows:
   - Current driver info
   - Option to unassign OR
   - Select new driver (will auto-unassign current)
3. User selects new driver
4. API calls:
   - First: `POST /drivers/OLD_ID/unassign`
   - Then: `POST /drivers/NEW_ID/assign`
5. Success: Page refreshes data

### Flow 4: View Details

**Terminal Details:**

- Full terminal info
- Status history (online/offline log)
- Assignment history (who used it when)
- Current location (if available)

**Driver Details:**

- Full driver info
- Current assignment
- Assignment history
- Analytics: zones visited, hours online, etc.

---

## 📊 Data Fetching Strategy

### On Page Load:

```javascript
async function fetchDashboardData() {
  try {
    // Fetch terminals with status and driver info (single call)
    const terminalsRes = await fetch(
      "/terminals?includeDrivers=true&includeStatus=true",
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );
    const terminals = await terminalsRes.json();

    // Fetch all drivers (no auth needed)
    const driversRes = await fetch("/drivers");
    const driversData = await driversRes.json();

    // Combine and process data
    return {
      terminals: terminals,
      drivers: driversData.drivers,
      assignedDrivers: terminals
        .filter((t) => t.driver_assignment)
        .map((t) => t.driver_assignment.driver.id),
      availableDrivers: driversData.drivers.filter(
        (d) => !assignedDrivers.includes(d.id)
      ),
    };
  } catch (error) {
    console.error("Failed to fetch dashboard data:", error);
  }
}
```

### Auto-Refresh:

```javascript
// Refresh data every 30 seconds to keep status updated
setInterval(() => {
  fetchDashboardData();
}, 30000);
```

---

## 🎨 Component Breakdown

### 1. TerminalCard Component

```jsx
Props:
- terminal: object
  - terminalid: string
  - name: string
  - status_info: { is_online, status, duration_seconds }
  - driver_assignment: { driver, assigned_at, assigned_duration_hours }
- onAssign: function
- onUnassign: function
- onViewDetails: function

Display:
- Terminal name/ID
- Status indicator (green dot = online, gray = offline)
- Driver name + phone (if assigned)
- Duration using terminal
- Action buttons
```

### 2. DriverCard Component

```jsx
Props:
- driver: object
  - id: number
  - name: string
  - phone: string
  - email: string
  - status: string
- currentAssignment: object | null
  - terminal info
  - duration
- onAssign: function
- onUnassign: function
- onViewDetails: function

Display:
- Driver name
- Phone/email
- Status (Available / In Use)
- Current terminal (if assigned)
- Duration on current terminal
- Action buttons
```

### 3. AssignmentModal Component

```jsx
Props:
- isOpen: boolean
- terminal: object
- availableDrivers: array
- onAssign: function(driverId, terminalId, notes)
- onClose: function

Display:
- Terminal info at top
- Searchable list of available drivers
- Notes input field
- Assign button
- Cancel button
```

### 4. ConfirmDialog Component

```jsx
Props:
- isOpen: boolean
- title: string
- message: string
- onConfirm: function
- onCancel: function

Display:
- Dialog with confirmation message
- Yes/No buttons
```

### 5. DetailsModal Component

```jsx
Props:
- isOpen: boolean
- type: 'terminal' | 'driver'
- id: string | number
- onClose: function

Display:
- Fetch detailed data for terminal or driver
- Show comprehensive info
- History tabs
- Analytics (for drivers)
```

---

## 🎨 State Management

```javascript
const [terminals, setTerminals] = useState([]);
const [drivers, setDrivers] = useState([]);
const [loading, setLoading] = useState(true);
const [selectedTerminal, setSelectedTerminal] = useState(null);
const [selectedDriver, setSelectedDriver] = useState(null);
const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
const [filters, setFilters] = useState({
  status: "all", // all, online, offline
  assignment: "all", // all, assigned, unassigned
  search: "",
});
```

---

## 🎨 Filtering & Search

### Filters:

- **Status**: All / Online / Offline
- **Assignment**: All / Assigned / Unassigned
- **Search**: By terminal name, ID, or driver name

### Implementation:

```javascript
const filteredTerminals = terminals.filter((terminal) => {
  // Status filter
  if (filters.status !== "all") {
    if (filters.status === "online" && !terminal.status_info?.is_online)
      return false;
    if (filters.status === "offline" && terminal.status_info?.is_online)
      return false;
  }

  // Assignment filter
  if (filters.assignment !== "all") {
    if (filters.assignment === "assigned" && !terminal.driver_assignment)
      return false;
    if (filters.assignment === "unassigned" && terminal.driver_assignment)
      return false;
  }

  // Search filter
  if (filters.search) {
    const searchLower = filters.search.toLowerCase();
    const matchesTerminal =
      terminal.name?.toLowerCase().includes(searchLower) ||
      terminal.terminalid?.toLowerCase().includes(searchLower);
    const matchesDriver = terminal.driver_assignment?.driver?.name
      ?.toLowerCase()
      .includes(searchLower);
    if (!matchesTerminal && !matchesDriver) return false;
  }

  return true;
});
```

---

## 🎨 Styling Suggestions

### Colors:

- **Online**: Green (#10B981)
- **Offline**: Gray (#6B7280)
- **Assigned**: Blue (#3B82F6)
- **Available**: Green (#10B981)
- **Warning**: Yellow (#F59E0B)
- **Error**: Red (#EF4444)

### Status Indicators:

- Pulsing green dot for online terminals
- Gray dot for offline terminals
- Badge showing "X hours" for assignment duration
- Different colored badges for driver availability

### Cards:

- Shadow on hover
- Smooth transitions
- Clear visual hierarchy
- Mobile responsive (stack on small screens)

---

## 📱 Responsive Design

### Desktop (>1024px):

- Two-column layout or card grid (3-4 columns)
- Side-by-side terminal and driver lists
- Modals for actions

### Tablet (768px - 1024px):

- Two columns or 2-3 card grid
- Simplified info on cards
- Full-screen modals

### Mobile (<768px):

- Single column list
- Expandable cards (tap to see details)
- Bottom sheet for assignment actions
- Sticky header with filters

---

## ⚡ Performance Optimizations

1. **Lazy Loading**: Load only visible cards initially
2. **Pagination**: Show 20 items per page if you have many terminals/drivers
3. **Debounced Search**: Wait 300ms after user stops typing before filtering
4. **Memoization**: Use React.memo for cards that don't change often
5. **Virtual Scrolling**: If you have 100+ terminals, use react-window

---

## 🔔 Real-time Updates (Optional)

### Option 1: Polling

```javascript
// Refresh every 30 seconds
useEffect(() => {
  const interval = setInterval(fetchDashboardData, 30000);
  return () => clearInterval(interval);
}, []);
```

### Option 2: WebSocket (Future Enhancement)

- Connect to WebSocket server
- Listen for terminal status changes
- Listen for assignment changes
- Update UI in real-time without polling

---

## 🧪 Testing Checklist

- [ ] Page loads with all terminals and drivers
- [ ] Status indicators show correct online/offline state
- [ ] Can assign driver to unassigned terminal
- [ ] Can unassign driver from terminal
- [ ] Can change/swap driver assignment
- [ ] Assignment duration updates correctly
- [ ] Filters work correctly
- [ ] Search finds terminals and drivers
- [ ] Details modals show correct info
- [ ] Responsive on mobile/tablet/desktop
- [ ] Error handling for API failures
- [ ] Loading states while fetching data
- [ ] Confirmation dialogs prevent accidental unassignment

---

## 🚀 Future Enhancements

1. **Drag & Drop**: Drag driver card onto terminal card to assign
2. **Bulk Actions**: Select multiple terminals and assign drivers
3. **Assignment Scheduling**: Schedule driver assignments in advance
4. **Push Notifications**: Alert when driver has been online too long
5. **Shift Management**: Create shifts and auto-assign drivers
6. **Location Tracking**: Show terminal location on map with driver
7. **Analytics Dashboard**: Separate page for driver performance
8. **Export Data**: Export assignment history as CSV
9. **Activity Log**: Show recent assignment changes

---

## 📦 Recommended Libraries

### React/Next.js:

- **UI Components**: Shadcn/ui, Ant Design, or Material-UI
- **State Management**: Zustand or React Context
- **Data Fetching**: TanStack Query (React Query) for caching
- **Tables**: TanStack Table if using table layout
- **Modals**: Radix UI or Headless UI
- **Forms**: React Hook Form
- **Notifications**: React Hot Toast
- **Icons**: Lucide React or Heroicons

### Vanilla JS/Framework Agnostic:

- **HTTP**: Axios or Fetch API
- **State**: Native JS objects + localStorage for persistence
- **UI**: Tailwind CSS + AlpineJS for interactivity
- **Notifications**: Toastify

---

## 📋 Implementation Priority

### Phase 1 (MVP):

1. ✅ Fetch and display terminals with status
2. ✅ Fetch and display drivers
3. ✅ Show which driver is using which terminal
4. ✅ Show assignment duration
5. ✅ Assign driver to terminal
6. ✅ Unassign driver from terminal

### Phase 2 (Enhanced):

1. Search and filters
2. Details modals
3. Responsive design
4. Error handling + loading states
5. Auto-refresh

### Phase 3 (Advanced):

1. Analytics integration
2. Assignment history
3. Bulk operations
4. WebSocket real-time updates
5. Advanced filtering

---

## 🎯 Summary

**This dashboard provides:**

- ✅ Complete visibility of all terminals and their status
- ✅ Complete visibility of all drivers and availability
- ✅ Easy assignment/unassignment with clear UI
- ✅ Real-time duration tracking
- ✅ Detailed information on demand
- ✅ Mobile-friendly responsive design

**One API Call Gets Everything:**

```javascript
GET /terminals?includeDrivers=true&includeStatus=true
```

This returns all data needed for the dashboard in a single request! 🚀
