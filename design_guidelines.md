# MyInventory AI - Design Guidelines

## Design Approach

**Selected Approach:** Hybrid - Combining Linear's minimal dashboard aesthetics with Pinterest's image-centric card layouts and Notion's clean data organization.

**Rationale:** This inventory management system requires both functional efficiency (dashboard, filters, data entry) and visual richness (product images, barcodes). The design balances utility with engaging visual presentation of user-uploaded content.

**Key Design Principles:**
1. Mobile-first responsive layout that adapts seamlessly to desktop
2. Image-forward presentation that showcases inventory items prominently
3. Efficient data scanning with clear visual hierarchy
4. Touch-friendly interactions for camera and upload features

---

## Typography System

**Font Stack:**
- Primary: Inter (400, 500, 600) via Google Fonts - for UI elements, labels, body text
- Monospace: JetBrains Mono (400, 500) via Google Fonts - for barcodes, item IDs, values

**Type Scale:**
- Hero/Page Title: text-4xl md:text-5xl, font-semibold
- Section Headers: text-2xl md:text-3xl, font-semibold
- Card Titles: text-lg, font-medium
- Body Text: text-base, font-normal
- Labels/Meta: text-sm, font-medium
- Captions: text-xs, font-normal

---

## Layout System

**Spacing Primitives:** Use Tailwind units of 2, 4, 6, 8, 12, 16, 20, 24 for consistent rhythm
- Component padding: p-4 (mobile), p-6 (desktop)
- Section spacing: space-y-6 (mobile), space-y-8 (desktop)
- Card gaps: gap-4 (mobile), gap-6 (desktop)
- Container margins: mx-4 (mobile), mx-auto max-w-7xl px-6 (desktop)

**Grid System:**
- Item Cards: grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6
- Dashboard Metrics: grid grid-cols-2 lg:grid-cols-4 gap-4
- Form Layouts: Single column max-w-2xl for capture/upload, two-column for details

**Breakpoints:**
- Mobile: Base (< 640px)
- Tablet: sm (640px+)
- Desktop: lg (1024px+)
- Wide: xl (1280px+)

---

## Component Library

### Navigation
**Top Navigation Bar:**
- Fixed position on mobile, sticky on desktop
- Height: h-16
- Layout: Flex with logo left, actions right
- Elements: Logo/brand, search icon, filter toggle, add item CTA, user menu
- Spacing: px-4 with items-center justify-between

### Hero/Capture Section
**Camera Capture Interface:**
- Full-width container with centered capture area
- Camera preview: aspect-square max-w-md with rounded-2xl border
- Action buttons below preview: "Take Photo", "Upload Image" in horizontal stack
- Button styling: Blurred backdrop (backdrop-blur-md bg-white/90) for visibility over camera preview
- Instructions text: text-sm above capture area
- Spacing: py-12 md:py-16 section padding

### Item Cards
**Card Structure:**
- Container: Rounded-xl with subtle border, overflow-hidden
- Image area: aspect-square with object-cover, full-width
- Content area: p-4 spacing
- Elements stack: Item image → Name (text-lg font-medium) → Description (text-sm line-clamp-2) → Tags (flex-wrap gap-2) → Barcode thumbnail → Value estimate (text-base font-semibold) → Action buttons
- Barcode: Small preview (h-12) with "View Full Size" link
- Tags: Pill-shaped badges (px-3 py-1 rounded-full text-xs)
- Actions: Icon buttons for edit/delete in horizontal row

### Dashboard Components
**Metrics Panel:**
- Card-based layout with key stats
- Each metric card: p-6, rounded-lg
- Content: Large number (text-3xl font-bold) + label (text-sm)
- Icons: Left-aligned, size w-8 h-8

**Filter Panel:**
- Collapsible sidebar on desktop (w-64), drawer on mobile
- Filter groups with spacing: space-y-6
- Elements: Category checkboxes, value range sliders, date pickers
- Section headers: text-sm font-semibold mb-3
- Apply/Reset buttons at bottom

**Search Bar:**
- Full-width on mobile, max-w-md on desktop
- Height: h-12
- Icon: Search icon left, clear icon right (when active)
- Rounded-lg with focus state

### Forms & Inputs
**Item Details Form:**
- Vertical layout with space-y-4
- Labels: text-sm font-medium mb-1
- Text inputs: h-12 rounded-lg px-4
- Textareas: rounded-lg p-4 min-h-32
- File upload: Dashed border dropzone, h-48, centered content
- Category select: h-12 rounded-lg with chevron icon
- Submit button: Full-width on mobile, auto on desktop (min-w-32)

### Data Display
**Inventory List View:**
- Alternative to cards: table layout on desktop, stacked on mobile
- Table: Full-width with alternating row backgrounds
- Columns: Thumbnail (w-16) | Name | Category | Value | Barcode | Actions
- Mobile: Card-like rows with horizontal layout

**Barcode Display:**
- Full-screen modal overlay for large barcode view
- Barcode: Centered, max-w-lg, white background
- Download button below barcode
- Close button: Top-right corner, icon only

### Export Features
**Export Modal:**
- Centered modal: max-w-md, rounded-xl, p-6
- Format selection: Radio buttons for CSV/PDF
- Options: Checkboxes for including images, barcodes
- Preview text showing item count
- Action buttons: Cancel + Export (primary)

---

## Iconography

**Icon Library:** Heroicons (via CDN)
- UI Actions: Outline style at 20px (w-5 h-5)
- Primary CTAs: Solid style at 20px
- Small inline icons: 16px (w-4 h-4)

**Key Icons:**
- Camera: Camera icon
- Upload: Arrow-up-tray
- Search: Magnifying-glass
- Filter: Funnel
- Add: Plus
- Edit: Pencil
- Delete: Trash
- Barcode: View-columns (placeholder for barcode representation)
- Export: Arrow-down-tray
- Close: X-mark

---

## Images

**Hero Section:**
No large hero image. This is a utility app - the "hero" is the camera capture interface itself, providing immediate functionality.

**Item Images:**
- User-uploaded product photos displayed in cards
- Aspect ratio: Square (1:1) for consistency
- Treatment: Subtle rounded corners (rounded-lg), object-cover to maintain aspect
- Placeholder: Gray background with camera icon when no image uploaded

**Empty States:**
- Illustration or icon (w-24 h-24) centered above text
- "No items yet" with prompt to add first item
- Subtle instructional graphics for camera/upload process

---

## Responsive Behavior

**Mobile (< 640px):**
- Single column layouts
- Full-width cards and forms
- Bottom sheet for filters
- Floating action button for "Add Item" (bottom-right corner)
- Stacked navigation elements

**Tablet (640px - 1024px):**
- Two-column card grid
- Sidebar filters become drawer
- Navigation remains horizontal

**Desktop (1024px+):**
- Three to four column card grid
- Persistent filter sidebar
- Horizontal navigation with all actions visible
- Hover states active for interactive elements

---

## Interaction Patterns

**Camera Capture Flow:**
1. Landing shows capture interface immediately
2. Camera permission request with clear messaging
3. Live preview with capture button overlay
4. Instant preview of captured image with retake/use options
5. AI processing indicator (spinner + "Analyzing..." text)
6. Auto-populated form fields after AI analysis

**Item Management:**
- Tap/click card to view full details
- Swipe actions on mobile (swipe left for delete)
- Quick actions via icon buttons on cards
- Inline editing of item details

**Filtering & Search:**
- Instant results (no search button)
- Filter counts update live
- Clear all filters option always visible when active
- Smooth transitions when items appear/disappear

---

## Animations

Use sparingly for feedback, not decoration:
- Card hover: Subtle lift (translate-y-1 shadow-lg transition-all)
- Modal entry: Fade + slight scale (scale-95 to scale-100)
- Loading states: Spinner for AI processing, skeleton screens for data loading
- Toast notifications: Slide in from top for success/error messages