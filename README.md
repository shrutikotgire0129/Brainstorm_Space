# Brainstorm Space

A real-time collaborative digital whiteboard for corporate offsites, brainstorming sessions, and team collaboration.

## Project Overview

Brainstorm Space provides teams with a shared digital workspace where multiple participants can brainstorm, organize ideas, and collaborate in real time.

Participants can draw, add sticky notes and text, create shapes, share boards, and collaborate using live updates and participant cursors.

## Features

### Whiteboard
- Interactive canvas with pan and zoom.
- Freehand drawing, colors, and eraser.
- Sticky notes and text objects.
- Multiple shapes, including rectangles, circles, triangles, hexagons, arrows, and lines.
- Object selection, editing, and deletion.
- Undo and redo with history management.
- PNG export.

### Collaboration
- Real-time board updates using Socket.IO.
- Live participant presence and cursor updates.
- Shared board rooms.
- Persistent board data using PostgreSQL.
- Automatic saving and recovery.
- Revision-based conflict protection.

### Board Management and Sharing
- Persistent board names and owner-controlled renaming.
- Reusable board-sharing links.
- Individual Viewer and Editor invitations.
- Instant access and owner-approved access modes.
- Guest access without requiring account registration.
- Invitation expiration and revocation.
- Persistent guest access credentials.

### Access Control and Security
- Owner authentication using room-specific credentials.
- Guest authentication using secure access credentials.
- Owner, Editor, and Viewer permissions.
- Server-side authorization for REST API and Socket.IO operations.
- Viewer write restrictions.
- Invitation and share-link revocation.
- Rate limiting for guest access operations.
- Board payload size limits.
- Optimistic concurrency control for board persistence.

## Technology Stack

### Frontend
- Next.js 16
- React 19
- TypeScript
- Tailwind CSS
- Fabric.js
- Socket.IO Client

### Backend
- Node.js
- Express 5
- TypeScript
- Socket.IO
- Prisma ORM
- PostgreSQL
- Zod
- Express Rate Limit

## Architecture

The application uses a separate frontend and backend.

- **Frontend:** Next.js application responsible for the user interface, whiteboard canvas, and guest access flow.
- **Backend:** Express API responsible for board management, authorization, sharing, persistence, and collaboration.
- **Database:** PostgreSQL stores rooms, board data, sharing settings, invitations, access requests, and guest access records.
- **Real-time communication:** Socket.IO handles room participation, board updates, presence, and cursor events.

## Project Structure

```text
brainstorm_space/
├── backend/
│   ├── prisma/
│   │   ├── migrations/
│   │   └── schema.prisma
│   └── src/
│       ├── lib/
│       ├── routes/
│       └── server.ts
├── frontend/
│   └── src/
│       ├── app/
│       ├── components/
│       └── lib/
└── README.md
```

## Getting Started

### Prerequisites

- Node.js and npm
- PostgreSQL database
- Git

### 1. Clone the repository

```bash
git clone https://github.com/shrutikotgire0129/Brainstorm_Space.git
cd Brainstorm_Space
```

### 2. Configure the backend

Navigate to the backend directory:

```bash
cd backend
npm install
```

Create a `.env` file inside `backend/` with the following variables:

```env
PORT=5000
FRONTEND_URL=http://localhost:3000

DATABASE_URL=your_application_database_url
DIRECT_URL=your_direct_database_url
SHADOW_DATABASE_URL=your_shadow_database_url
```

The database URLs must point to appropriately configured PostgreSQL databases. `DATABASE_URL` is used by the application, `DIRECT_URL` is used by Prisma migrations, and `SHADOW_DATABASE_URL` is used for Prisma development migrations.

Generate the Prisma Client and apply local development migrations:

```bash
npx prisma generate
npx prisma migrate dev
```

Start the backend development server:

```bash
npm run dev
```

The backend runs on `http://localhost:5000` by default.

### 3. Configure the frontend

Open a second terminal and navigate to the frontend directory:

```bash
cd frontend
npm install
```

Create a `.env.local` file inside `frontend/`:

```env
NEXT_PUBLIC_API_URL=http://localhost:5000
```

Start the frontend development server:

```bash
npm run dev
```

Open `http://localhost:3000` in your browser.

## Build and Validation

### Backend

Run these commands from `backend/`:

```bash
npx prisma validate
npx tsc --noEmit
npm run build
```

### Frontend

Run these commands from `frontend/`:

```bash
npx tsc --noEmit
npx eslint .
npm run build
```

## Deployment

The application is deployed using:

- **Frontend:** Vercel
- **Backend:** Render
- **Database:** Neon PostgreSQL

### Live Application

- Frontend: https://brainstorm-space-seven.vercel.app/
- Backend API health: https://brainstorm-space.onrender.com/api/health

## Security Considerations

- Owner and guest credentials are stored as hashes in the database.
- Guest credentials are stored in browser local storage. They are accessible to JavaScript running on the same origin, so protection against cross-site scripting (XSS) is important.
- The current rate limiter uses an in-memory store. Deployments with multiple backend instances should use a shared rate-limit store.
- Revoked or expired guest access is checked during protected Socket.IO operations. An idle socket may remain connected until its next protected event.
- Production deployments must use HTTPS and secure database connection settings.
- Environment files and credentials must never be committed to source control.

## Project Status

The core whiteboard, persistence, real-time collaboration, board sharing, guest access, and server-side access-control features have been implemented.

Phase 12 (Board Management and Sharing) is complete. All phases from 12.1 through 12.7 have been implemented, tested, and released. Production deployment is verified on Vercel and Render. Owner, Editor, and Viewer permissions, read-only Viewer behavior, board persistence, and real-time collaboration have passed production acceptance testing.

## License

MIT
