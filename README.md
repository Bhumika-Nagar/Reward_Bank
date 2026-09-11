# RewardBank

RewardBank is a backend-only screen-time bank. Children earn minutes from approved tasks, spend minutes through usage reports, and every actual balance change is recorded in a ledger.

## Tech Stack

- Node.js
- TypeScript
- Express
- SQLite
- `better-sqlite3`
- Vitest
- `tsx`

## Setup

Install dependencies:

```bash
npm install
```

Start the server on `localhost:3000`:

```bash
npm start
```

The app uses `rewardbank.db`. Tests use a separate `rewardbank_test.db`.

## Testing

Run the test suite:

```bash
npm test -- --run
```

The tests cover ledger behavior, task approval, duplicate usage, double approval, usage cutoff, undo/debt, debt repayment, and balance invariants.

## Authentication

Authenticated endpoints expect:

```text
Authorization: Bearer <token>
```

The demo creates its own run-scoped parent and child tokens. The curl examples below assume matching parent and child records already exist.

## API Endpoints

| Method | Endpoint | Access | Purpose |
| --- | --- | --- | --- |
| `GET` | `/` | None | Health message |
| `POST` | `/tasks` | Parent | Create a task for one of the parent's children |
| `POST` | `/tasks/:id/done` | Child | Mark the child's task as done |
| `POST` | `/tasks/:id/approve` | Parent | Approve a done task |
| `POST` | `/tasks/:id/reject` | Parent | Reject a done task |
| `POST` | `/tasks/:id/undo` | Parent | Undo an approved task |
| `POST` | `/usage` | Child | Report one or more usage sessions |
| `GET` | `/children/:id/balance` | Parent/Child | Read a child's balance |
| `GET` | `/children/:id/ledger` | Parent/Child | Read a child's ledger entries |

## Example

Create a task:

```bash
curl -X POST http://localhost:3000/tasks \
  -H "Authorization: Bearer parent-token" \
  -H "Content-Type: application/json" \
  -d "{\"childId\":\"child-1\",\"title\":\"Read for 20 minutes\",\"reward\":30}"
```

Approve a task:

```bash
curl -X POST http://localhost:3000/tasks/<task-id>/approve \
  -H "Authorization: Bearer parent-token"
```

Report usage:

```bash
curl -X POST http://localhost:3000/usage \
  -H "Authorization: Bearer child-token" \
  -H "Content-Type: application/json" \
  -d "{\"sessions\":[{\"id\":\"usage-1\",\"childId\":\"child-1\",\"appId\":\"youtube\",\"startTime\":\"2026-09-11T10:00:00.000Z\",\"endTime\":\"2026-09-11T10:12:00.000Z\"}]}"
```

Batch usage sessions are processed in the order provided. The batch succeeds or fails as one transaction, so an invalid session rolls back the whole batch. Duplicate session IDs return the original result without charging twice.

## Demo

Run the HTTP simulator:

```bash
npm run demo
```

## Project Structure

```text
src/database.ts              SQLite connection and schema
src/middleware/              Authentication middleware
src/routes/                  Express route files
src/services/                Ledger, task, and usage business logic
tests/                       Vitest service tests
simulator/demo.ts            HTTP demo script
WRITEUP.md                   Engineering write-up
```

## Documentation

See [WRITEUP.md](WRITEUP.md) for design decisions, assumptions, edge cases, testing notes, and scaling trade-offs.
