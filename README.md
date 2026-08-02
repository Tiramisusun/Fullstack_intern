# Limited Product Drop

A full-stack reservation and checkout system for a limited product drop.

## Live Deployment

- Frontend: https://motivated-caring-production-813b.up.railway.app
- Backend API: https://fullstackintern-production-2e8f.up.railway.app
- Products endpoint: https://fullstackintern-production-2e8f.up.railway.app/products

The project uses:

- Frontend: React + TypeScript + Vite
- Backend: NestJS + TypeScript + Node.js
- Database: PostgreSQL
- Locking/cache: Redis
- ORM: Prisma
- Deployment: Railway

## Why This Architecture

Inventory correctness is enforced by PostgreSQL, not by application memory. Reservation requests use a Redis lock per product to reduce concurrent pressure, then PostgreSQL performs the real consistency-critical work inside a transaction.

The important rule is:

> Redis helps requests queue up. PostgreSQL guarantees the inventory cannot be oversold.

## Project Structure

```text
.
├── backend
│   ├── prisma
│   │   ├── migrations
│   │   │   └── ... migration SQL files
│   │   ├── schema.prisma        # Product and Reservation data model
│   │   └── seed.ts              # Demo product seed data
│   ├── src
│   │   ├── main.ts              # NestJS bootstrap, CORS, validation, PORT
│   │   ├── app.module.ts        # Root backend module
│   │   ├── prisma
│   │   │   ├── prisma.module.ts
│   │   │   └── prisma.service.ts
│   │   ├── redis
│   │   │   ├── redis.module.ts
│   │   │   └── redis.service.ts # Product reservation lock client
│   │   ├── products
│   │   │   ├── products.controller.ts
│   │   │   ├── products.module.ts
│   │   │   ├── products.service.ts
│   │   │   └── products.service.spec.ts
│   │   └── reservations
│   │       ├── dto
│   │       │   └── create-reservation.dto.ts
│   │       ├── reservations.controller.ts
│   │       ├── reservations.module.ts
│   │       ├── reservations.service.ts
│   │       └── reservations.service.spec.ts
│   ├── package.json
│   └── tsconfig.json
├── frontend
│   ├── src
│   │   ├── api.ts               # Frontend API client
│   │   ├── App.tsx              # Product, reservation, and checkout UI
│   │   ├── main.tsx             # React entry point
│   │   └── styles.css
│   ├── index.html
│   ├── package.json
│   └── vite.config.ts
├── docker-compose.yml           # Local PostgreSQL and Redis
├── railway.json                 # Railway build/start configuration
├── package.json                 # Root scripts for local dev and deployment
└── README.md
```

## Why PostgreSQL

PostgreSQL is used because the core requirement is inventory correctness under concurrent reservations. When a user reserves a product, the backend performs an atomic inventory update:

```sql
UPDATE "Product"
SET "availableStock" = "availableStock" - quantity
WHERE id = productId
  AND "availableStock" >= quantity;
```

This means stock is only decremented when enough inventory is still available. If multiple users reserve the same product at the same time, PostgreSQL ensures the update is applied safely and `availableStock` cannot go below zero.

PostgreSQL also provides:

- transactions, so inventory decrement and reservation creation commit together
- foreign keys, so reservations must reference real products
- constraints, so invalid stock values can be rejected at the database layer
- strong Prisma support for migrations and generated TypeScript client types

Redis is still useful for reducing concurrent pressure on the same product, but it is not the final source of correctness. Redis helps requests queue; PostgreSQL guarantees the inventory state.

## Core Flow

The inventory has three useful business states:

- `available`: users can still reserve these units
- `reserved`: temporarily held by pending reservations
- `sold`: completed checkout units

In this implementation, `Product.availableStock` is stored directly because it is the value that must be protected during concurrent reservations. `reserved` and `sold` are derived from reservation records:

```text
reserved = sum(PENDING reservation quantity)
sold = sum(COMPLETED reservation quantity)
total = available + reserved + sold
```

When a user reserves a product:

```text
available decreases
the user's account gets a PENDING reservation
```

When the user completes checkout:

```text
the reservation changes from PENDING to COMPLETED
reserved decreases
sold increases
```

When the reservation expires:

```text
the reservation changes from PENDING to EXPIRED
available increases again
reserved decreases
```

### View Products

The frontend calls:

```text
GET /products
```

The response includes `availableStock`, so users can see whether an item is still available.

### Reserve Product

The frontend calls:

```text
POST /reservations
```

Request body:

```json
{
  "productId": "product-id",
  "userId": "demo-user",
  "quantity": 1
}
```

The backend:

1. Acquires a Redis lock: `lock:product:{productId}`.
2. Opens a PostgreSQL transaction.
3. Runs an atomic update:

```sql
UPDATE "Product"
SET "availableStock" = "availableStock" - quantity
WHERE id = productId
  AND "availableStock" >= quantity;
```

4. If no row is updated, the product is sold out.
5. Creates a `PENDING` reservation with an expiry time.
6. Commits the transaction.
7. Releases the Redis lock safely using a token check.

### Complete Checkout

The frontend calls:

```text
POST /reservations/:id/checkout
```

Only `PENDING` and non-expired reservations can be checked out. A successful checkout changes the reservation to `COMPLETED`.

### Expired Reservations

Reservations do not last forever. The backend runs a scheduled job every 30 seconds:

```text
PENDING reservation with expiresAt <= now
```

Those reservations become `EXPIRED`, and their reserved quantity is added back to product inventory.

There is also a manual endpoint:

```text
POST /reservations/expire
```

## Database Model

### Product

- `id`
- `name`
- `description`
- `imageUrl`
- `priceCents`
- `totalStock`
- `availableStock`
- `createdAt`

### Reservation

- `id`
- `productId`
- `userId`
- `quantity`
- `status`: `PENDING`, `COMPLETED`, `EXPIRED`, `CANCELLED`
- `expiresAt`
- `createdAt`
- `completedAt`

## Data Integrity

PostgreSQL constraints prevent invalid data:

- price cannot be negative
- total stock cannot be negative
- available stock cannot be negative
- available stock cannot exceed total stock
- reservation quantity must be greater than zero
- reservation must reference a real product

## Redis Locking

Redis is used with:

```text
SET lock:product:{productId} random-token NX PX 5000
```

This means:

- `NX`: only create the lock if it does not already exist
- `PX 5000`: expire the lock after 5 seconds
- `random-token`: identify the lock owner

The lock is released with a Lua script that checks the token before deleting the key. This avoids deleting another request's lock if the first lock expired and a second request acquired a new one.

Redis is intentionally not the only safety mechanism. If Redis expires early or becomes unavailable, the PostgreSQL atomic update and transaction still prevent overselling.

## Run Locally

Start PostgreSQL and Redis:

```bash
docker compose up -d postgres redis
```

Install dependencies:

```bash
npm run install:all
```

Create backend environment:

```bash
cp backend/.env.example backend/.env
```

Run migrations and seed data:

```bash
npm run db:migrate
npm run db:seed
```

Start backend and frontend:

```bash
npm run dev
```

Frontend:

```text
http://localhost:5173
```

Backend:

```text
http://localhost:3000
```

## Testing

Run backend tests:

```bash
npm --prefix backend test
```

Test files:

```text
backend/src/reservations/reservations.service.spec.ts
backend/src/products/products.service.spec.ts
```

The included tests cover:

- creating a pending reservation when stock is available
- decrementing `availableStock` with an atomic product update
- avoiding reservation creation when the Redis product lock is busy
- returning `Sold out` when the atomic inventory update affects zero rows
- completing checkout by changing a reservation from `PENDING` to `COMPLETED`
- blocking checkout for expired pending reservations
- returning inventory when pending reservations expire
- requiring `userId` when listing reservations for an account
- calculating product inventory display fields:
  - `availableStock` from the `Product` row
  - `reservedStock` from `PENDING` reservations
  - `soldStock` from `COMPLETED` reservations

Expected result:

```text
Test Suites: 2 passed
Tests: 8 passed
```

## Assumptions

- Each reservation reserves one or more units of a product.
- A reservation expires after `RESERVATION_TTL_SECONDS`.
- Checkout is simulated; no payment provider is integrated.
- Authentication is simplified to a `userId` passed from the frontend.

## Trade-Offs

- Redis locking reduces concurrent work for the same product, but correctness still depends on PostgreSQL.
- The expiry worker runs inside the backend process, which is simple for this project. In production, this could move to a queue or dedicated worker.
- Supabase can be used as the hosted PostgreSQL provider by replacing `DATABASE_URL`.

## Improvements With More Time

- Add real authentication.
- Add payment integration and idempotency keys for checkout.
- Add integration tests against real PostgreSQL and Redis.
- Add admin tools for creating product drops.
- Deploy frontend and backend with managed PostgreSQL and Redis.
