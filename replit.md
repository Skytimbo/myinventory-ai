# MyInventory AI

## Overview

MyInventory AI is an intelligent inventory management system that leverages AI-powered image recognition to catalog and manage household items. The application enables users to capture photos of items, automatically extract metadata through GPT-5 vision analysis, generate barcodes for tracking, and estimate resale values with confidence indicators. Items can be tagged with optional storage locations for better organization. Built as a full-stack web application, it combines a React-based frontend with an Express backend, persistent PostgreSQL storage, and integrates with OpenAI's API for image analysis capabilities. Features include advanced filtering with location badges, date ranges, professional PDF export, and barcode downloads.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture

**Framework & Tooling**
- React 18+ with TypeScript for type-safe component development
- Vite as the build tool and development server
- Wouter for lightweight client-side routing
- TanStack Query (React Query) for server state management and caching

**UI Component System**
- shadcn/ui component library (New York variant) with Radix UI primitives
- Tailwind CSS for utility-first styling with custom design tokens
- Design approach combines Linear's minimalism, Pinterest's image-centric layout, and Notion's clean data organization
- Mobile-first responsive design with breakpoints at 640px (sm), 1024px (lg), and 1280px (xl)
- Custom CSS variables for theming with support for light/dark modes

**Key Frontend Features**
- Camera capture using react-webcam for direct photo taking
- Uppy file uploader integration for batch uploads to object storage
- JsBarcode library for client-side barcode generation and rendering
- Advanced filtering with search, category, location (multi-select badges with counts), price range, and date range (From/To) controls
- Dashboard with aggregate statistics (total items, value, categories, averages)
- Professional PDF export with embedded images, barcodes, and item details
- CSV export functionality for inventory data
- Barcode download as PNG images for physical label printing
- Optional location tagging for items (e.g., "Garage, Box #15") with visual badges and MapPin icons

### Backend Architecture

**Server Framework**
- Express.js with TypeScript running on Node.js
- ESM module system (type: "module")
- Multer middleware for multipart form data and image uploads
- Custom request logging middleware for API endpoint monitoring

**Data Storage Strategy**
- PostgreSQL database with Drizzle ORM for persistent storage
- Database schema defined using Drizzle ORM with PostgreSQL dialect
- Schema includes inventory items table with fields for name, description, category, tags (array), image URL, barcode data, estimated value, value confidence, value rationale, location (optional), and timestamps
- Neon serverless PostgreSQL integration via DATABASE_URL environment variable
- Type-safe queries using NeonHttpDatabase type

**API Design**
- RESTful endpoints for inventory CRUD operations:
  - GET /api/items - Retrieve all items
  - GET /api/items/:id - Retrieve single item
  - POST /api/items - Create item with image upload
  - DELETE /api/items/:id - Delete item (implementation pending)
- Image upload accepts multipart/form-data with single file
- Returns JSON responses with appropriate HTTP status codes

### AI Integration

**OpenAI GPT-5 Vision**
- Integrated via Replit's AI Integrations service (no personal API key required)
- Analyzes uploaded images to extract:
  - Item name and detailed description
  - Category classification
  - Searchable tags (3-5 per item)
  - Estimated resale value in USD with market analysis
  - Value confidence level (low/medium/high)
  - Value rationale explaining the pricing factors
- Uses structured JSON output format for consistent parsing
- Base64 image encoding for API transmission
- Enhanced prompts with brand recognition, condition assessment, age consideration, market demand, and category-specific guidelines

**Image Analysis Flow**
1. User captures or uploads image
2. Image converted to base64 data URL
3. Sent to GPT-5 with structured prompt
4. AI returns JSON with metadata
5. Backend generates unique barcode data
6. Item stored with all metadata

### External Dependencies

**Cloud Services**
- Google Cloud Storage for object/image storage via @google-cloud/storage
- Replit Sidecar authentication for GCS access using external account credentials
- Object ACL policy system for access control (owner, visibility, permissions)

**Database**
- Neon serverless PostgreSQL (active)
- Connection via @neondatabase/serverless driver
- Drizzle Kit for schema migrations and database push operations

**Third-Party Libraries**
- OpenAI SDK for GPT-5 vision API calls
- react-webcam for camera access
- Uppy ecosystem (@uppy/core, @uppy/dashboard, @uppy/aws-s3, @uppy/react) for file uploads
- jsbarcode for CODE128 barcode generation
- jsPDF for professional PDF export with embedded images
- date-fns for immutable date manipulation in filtering
- react-day-picker for Calendar UI components
- zod for runtime schema validation
- nanoid for unique ID generation

**Development Tools**
- Replit-specific plugins for development (cartographer, dev banner, runtime error overlay)
- TypeScript for static type checking
- ESBuild for production server bundling
- PostCSS with Autoprefixer for CSS processing

### Authentication & Security

**Current State**
- Object storage ACL system defined but not fully implemented
- Placeholder authentication hooks in object storage service
- No user authentication currently active (single-user design implied)

**Access Control Design**
- Object ACL policies with owner, visibility (public/private), and rule-based permissions
- Support for READ and WRITE permission types
- Extensible group-based access control structure