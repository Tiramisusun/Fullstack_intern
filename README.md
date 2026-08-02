# Limited Product Drop

A full-stack reservation and checkout system for a limited product drop.

The project uses:

- Frontend: React + TypeScript + Vite
- Backend: NestJS + TypeScript
- Database: PostgreSQL
- Locking/cache: Redis
- ORM: Prisma

## Why This Architecture

Inventory correctness is enforced by PostgreSQL, not by application memory. Reservation requests use a Redis lock per product to reduce concurrent pressure, then PostgreSQL performs the real consistency-critical work inside a transaction.

The important rule is:

> Redis helps requests queue up. PostgreSQL guarantees the inventory cannot be oversold.

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

## API Reference

The backend does not serve a page at `/`. If you open `http://localhost:3000/` in a browser, NestJS will return `Cannot GET /`. That is expected. Use the API routes below instead.

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/products` | List all products with available, reserved, sold, and total stock |
| `GET` | `/products/:id` | Fetch one product |
| `POST` | `/reservations` | Create a pending reservation |
| `GET` | `/reservations?userId=demo-user` | List reservations for a user |
| `GET` | `/reservations/:id` | Fetch one reservation |
| `POST` | `/reservations/:id/checkout` | Complete checkout for a pending reservation |
| `POST` | `/reservations/expire` | Manually expire pending reservations |

Example reservation request:

```bash
curl -X POST http://localhost:3000/reservations \
  -H "Content-Type: application/json" \
  -d '{"productId":"product-id","userId":"demo-user","quantity":1}'
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

Data integrity is handled by a combination of TypeScript DTO validation, Prisma models, Redis locking, and PostgreSQL transactions:

- `CreateReservationDto` validates that `productId` and `userId` are strings.
- `CreateReservationDto` validates that `quantity` is an integer greater than or equal to 1.
- The Prisma schema requires reservations to reference a real product.
- The reservation create flow checks that the product exists before reserving stock.
- The inventory decrement is atomic: stock is only decremented when `availableStock >= quantity`.
- Reservation creation and inventory decrement run in the same PostgreSQL transaction.
- Expiration only returns inventory when a reservation is still `PENDING`, so repeated expiration attempts do not double-return stock.

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

Install dependencies:

```bash
npm run install:all
```

Create backend environment:

```bash
cp backend/.env.example backend/.env
```

Optional frontend environment:

```bash
cp frontend/.env.example frontend/.env
```

Start PostgreSQL and Redis:

```bash
npm run db:up
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

Useful backend checks:

```text
http://localhost:3000/products
http://localhost:3000/reservations?userId=demo-user
```

## Backend Startup

The root package script starts the backend through the backend package:

```text
npm run dev:backend
  -> npm --prefix backend run start:dev
  -> nest start --watch
  -> backend/src/main.ts
  -> AppModule
```

`main.ts` creates the NestJS app, enables CORS for the frontend, enables request validation, and listens on `PORT` or `3000`.

## Testing

Run backend tests:

```bash
npm --prefix backend test
```

The included tests cover:

- creating a pending reservation when stock is available
- avoiding database writes when the Redis product lock is busy
- returning sold out when the atomic inventory update affects zero rows
- blocking checkout for expired pending reservations
- returning inventory when reservations expire
- completing checkout for valid pending reservations
- requiring `userId` when listing reservations for a user

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
