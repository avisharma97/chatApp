# ChatApp — Real-Time Messaging

A full-stack messaging application built with Next.js, React, TypeScript, Express, Socket.IO, Prisma, and PostgreSQL. It supports authenticated conversations, persistent messaging, message forwarding, and real-time communication.

- **Live application:** https://chatapp-pi-jet.vercel.app
- **Backend:** https://chatapp-eqq2.onrender.com
- **Repository:** https://github.com/avisharma97/chatApp

## Features

- User registration and login.
- User profiles and user search.
- Direct and group conversations.
- Persistent message history.
- Real-time communication using Socket.IO.
- Message forwarding between conversations.
- Message delivery/read receipt support.
- Audio-call signaling and WebRTC-based calling.
- PostgreSQL persistence with Prisma.
- Separate frontend and backend deployments.

Some features, particularly end-to-end audio quality, reconnect recovery, and advanced media-upload behavior, require further end-to-end verification. See [Known Limitations](#known-limitations).

## Tech Stack

| Area | Technology |
|---|---|
| Frontend | Next.js App Router, React, TypeScript |
| Styling | Tailwind CSS |
| State management | Redux Toolkit, React Redux |
| Backend | Node.js, Express, TypeScript |
| Real-time events | Socket.IO |
| Audio communication | WebRTC |
| Database | PostgreSQL |
| ORM | Prisma |
| Validation | Zod |
| Logging and metrics | Pino, Prometheus client |
| Testing | Vitest, Testing Library, Supertest |
| Package management | pnpm workspaces |
| Frontend hosting | Vercel |
| Backend hosting | Render |
| Database hosting | Neon PostgreSQL |

## Architecture

```text
Browser
   |
   v
Next.js App Router
   |
   +------ HTTP requests ------> Express API
   |                                |
   +------ Socket.IO --------------+
                                    |
                                    v
                              Authentication
                              and validation
                                    |
                                    v
                              Prisma ORM
                                    |
                                    v
                              PostgreSQL
```

### Frontend

The Next.js application provides the chat interface, conversation navigation, message composition, and real-time user interactions.

Client Components are necessary for interactive state, browser APIs, Socket.IO connections, and WebRTC. Server Components are appropriate for UI that does not require client-side interactivity. The exact boundaries should be reviewed against the current implementation.

### Backend

The Express API handles application requests, authentication, conversation operations, and message persistence. Socket.IO supports real-time communication and call signaling.

The server must validate incoming requests and enforce authorization independently of frontend checks.

### Database

PostgreSQL stores persistent application data, while Prisma provides typed database access and schema management. Production migrations must be reviewed and applied without destructive resets of existing data.

## Project Structure

```text
chatApp/
├── apps/
│   ├── api/
│   │   ├── prisma/
│   │   └── src/
│   │       ├── index.ts
│   │       ├── lib/
│   │       └── routes/
│   └── web/
│       └── src/
│           ├── app/
│           ├── features/
│           └── types/
├── package.json
├── pnpm-workspace.yaml
└── README.md
```

## Prerequisites

- Node.js compatible with the repository configuration.
- pnpm 11.x compatible with the workspace's package-manager requirements.
- PostgreSQL or a development PostgreSQL database.
- Git.

## Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/avisharma97/chatApp.git
cd chatApp
```

### 2. Install dependencies

```bash
pnpm install
```

### 3. Configure environment variables

Configure the required local environment variables for both applications. Refer to the source code and existing configuration for the exact variable names.

At minimum, the application needs an appropriate database connection and frontend-to-backend configuration. Authentication secrets and any enabled integration credentials must also be configured as required.

Never commit real credentials, database passwords, or authentication secrets.

### 4. Configure the database

Ensure the API points to the intended development database. Review the repository's Prisma configuration and migrations before applying schema changes.

Do not run destructive database commands against production.

### 5. Start the application

Start both applications concurrently:

```bash
pnpm dev
```

Alternatively, start them separately:

```bash
pnpm dev:api
```

```bash
pnpm dev:web
```

Use the startup output to confirm the actual local API and frontend URLs.

## Environment Configuration

The deployed frontend uses this API URL:

```dotenv
NEXT_PUBLIC_API_URL=https://chatapp-eqq2.onrender.com
```

The backend must be configured with the appropriate values for:

| Setting | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection |
| `WEB_ORIGIN` | Allowed frontend origin |
| Authentication configuration | Token or session verification |
| Cookie configuration | Secure authentication cookie behavior |
| Media integration configuration | Credentials required by enabled upload features |

These are configuration categories; use the exact variable names expected by the implementation. Do not publish secret values in this document.

## Real-Time Messaging

Socket.IO provides bidirectional communication between connected clients and the backend.

A typical message flow is:

1. The client establishes an authenticated connection.
2. The server associates the connection with the authenticated user.
3. The client submits a message event.
4. The server validates the payload and authorization.
5. The message is persisted when required.
6. The server emits the resulting event to authorized recipients.
7. The client reconciles the event with local message state.

Reconnection by itself does not guarantee delivery of every missed event. Reliable recovery requires synchronization with persisted message history and appropriate deduplication.

## Message Forwarding

The frontend submits a forwarding request that identifies the source message and destination conversation.

The backend should verify that the requester can access the source message and is permitted to send to the destination. Successful forwarding should be reflected in persisted conversation data and synchronized with the client.

The forwarding interface should provide understandable message previews, validation, loading states, and actionable errors.

## Security and Reliability

Security controls should include:

- Server-side authentication and authorization.
- Validation of incoming payloads and identifiers.
- Access checks for conversation and message operations.
- Explicit CORS and cookie configuration.
- Rate limiting for sensitive endpoints.
- Safe error responses that do not expose internal details.
- Media type and size validation for uploads.
- Appropriate handling of duplicate submissions.
- Reviewed, non-destructive database migrations.

These are the expected security practices; each control should be verified against the implementation before claiming a completed security audit.

## Testing and Quality Checks

The workspace defines build, type-check, and test scripts. Run the checks before submitting changes.

### Build

```bash
pnpm build
```

### API type checking

```bash
pnpm typecheck
```

### Frontend TypeScript check

```bash
pnpm --filter @chatapp/web exec tsc --noEmit
```

### Frontend tests

```bash
pnpm --filter @chatapp/web test
```

### API tests

```bash
pnpm --filter @chatapp/api test
```

The frontend uses Vitest and Testing Library dependencies; the API uses Vitest and Supertest dependencies. Test coverage should be evaluated from the actual test files rather than inferred from installed packages.

### Recommended assessment coverage

- Message list loading, empty, and error states.
- Composer submission and validation.
- Duplicate event handling.
- Forward-message success and failure.
- Unauthorized conversation access.
- Socket reconnection and message synchronization.
- Upload validation and failure handling.
- Keyboard accessibility for message interactions.
- WebRTC call setup, teardown, and media delivery.

## Deployment

### Frontend — Vercel

Live URL: https://chatapp-pi-jet.vercel.app

Verify the repository connection, production branch, monorepo build configuration, and `NEXT_PUBLIC_API_URL` setting. Confirm that the production build succeeds and that the deployed frontend can communicate with the backend.

### Backend — Render

Backend URL: https://chatapp-eqq2.onrender.com

Verify the service build and startup commands, database connection, environment variables, allowed frontend origin, and production schema compatibility.

### Database — Neon

Use the intended production database and apply reviewed migrations carefully. Never reset production data merely to resolve migration-history inconsistencies.

### Post-deployment smoke test

1. Log in using test accounts.
2. Create or open a conversation.
3. Send and receive a message from separate accounts.
4. Refresh the page and verify persisted history.
5. Forward a message to another conversation.
6. Check unauthorized requests and error states.
7. Test audio calling separately on both clients.

## Design Decisions and Trade-Offs

### HTTP API plus Socket.IO

HTTP endpoints are suitable for request-response operations such as authentication, history retrieval, and message forwarding. Socket.IO supports low-latency events.

Using both requires consistent authentication, event validation, and client-state reconciliation.

### PostgreSQL plus Prisma

PostgreSQL provides persistent relational data storage. Prisma offers typed access and schema management, but production deployments require disciplined migration management.

### Separate frontend and backend deployments

Independent deployments allow each application to build and scale separately. The trade-offs include cross-origin configuration, environment management, and additional failure points between services.

## Known Limitations

The following areas require further verification before the project can be considered assessment-complete:

- **Audio calling:** Successful connection does not by itself prove reliable two-way audio.
- **Media uploads:** Confirm upload progress, MIME validation, size limits, and failure handling.
- **Draft persistence:** Verify that drafts survive refreshes and conversation switching.
- **Drag-and-forward:** Verify keyboard alternatives and behavior for deleted or edited messages.
- **Reconnect recovery:** Verify history reconciliation and duplicate-event handling.
- **State optimization:** Confirm the actual Redux selectors and whether memoized derived selectors are used.
- **Automated UI coverage:** Confirm tests cover loading, empty, and error states in the message list and composer.
- **Accessibility and animations:** Check labels, image alternative text, keyboard navigation, and interaction transitions.

Update this section as each item is implemented and verified.

## Future Improvements

- Expand automated component and integration testing.
- Improve reconnect synchronization and idempotency.
- Strengthen media-upload validation and progress feedback.
- Verify per-conversation draft persistence.
- Improve keyboard accessibility.
- Add operational monitoring and actionable alerts.
- Validate WebRTC behavior across browsers and network conditions.

## License

The repository currently declares the `ISC` license in its root package metadata. Confirm that this is the intended project license and add a `LICENSE` file before distributing the project.
