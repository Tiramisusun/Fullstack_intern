CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE "ReservationStatus" AS ENUM ('PENDING', 'COMPLETED', 'EXPIRED', 'CANCELLED');

CREATE TABLE "Product" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "imageUrl" TEXT,
  "priceCents" INTEGER NOT NULL,
  "totalStock" INTEGER NOT NULL,
  "availableStock" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Product_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Product_priceCents_check" CHECK ("priceCents" >= 0),
  CONSTRAINT "Product_totalStock_check" CHECK ("totalStock" >= 0),
  CONSTRAINT "Product_availableStock_check" CHECK ("availableStock" >= 0),
  CONSTRAINT "Product_stock_bounds_check" CHECK ("availableStock" <= "totalStock")
);

CREATE TABLE "Reservation" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "productId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "status" "ReservationStatus" NOT NULL DEFAULT 'PENDING',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),

  CONSTRAINT "Reservation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Reservation_quantity_check" CHECK ("quantity" > 0)
);

CREATE INDEX "Product_availableStock_idx" ON "Product"("availableStock");
CREATE INDEX "Reservation_productId_idx" ON "Reservation"("productId");
CREATE INDEX "Reservation_status_expiresAt_idx" ON "Reservation"("status", "expiresAt");

ALTER TABLE "Reservation"
ADD CONSTRAINT "Reservation_productId_fkey"
FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
