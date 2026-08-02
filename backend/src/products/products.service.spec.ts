import { ReservationStatus } from "@prisma/client";
import { ProductsService } from "./products.service";

describe("ProductsService", () => {
  it("returns available, reserved, and sold stock totals for products", async () => {
    const prisma = {
      product: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "product-1",
            name: "Founders Hoodie",
            availableStock: 7,
            totalStock: 8,
            createdAt: new Date("2026-08-02T00:00:00Z")
          }
        ])
      },
      reservation: {
        groupBy: jest.fn().mockResolvedValue([
          {
            productId: "product-1",
            status: ReservationStatus.PENDING,
            _sum: { quantity: 1 }
          },
          {
            productId: "product-1",
            status: ReservationStatus.COMPLETED,
            _sum: { quantity: 2 }
          }
        ])
      }
    };
    const service = new ProductsService(prisma as never);

    await expect(service.findAll()).resolves.toEqual([
      expect.objectContaining({
        id: "product-1",
        availableStock: 7,
        reservedStock: 1,
        soldStock: 2,
        totalStock: 8
      })
    ]);

    expect(prisma.product.findMany).toHaveBeenCalledWith({
      orderBy: { createdAt: "asc" }
    });
    expect(prisma.reservation.groupBy).toHaveBeenCalledWith({
      by: ["productId", "status"],
      where: {
        status: {
          in: [ReservationStatus.PENDING, ReservationStatus.COMPLETED]
        }
      },
      _sum: { quantity: true }
    });
  });
});
