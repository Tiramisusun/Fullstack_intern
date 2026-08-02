import { BadRequestException, ConflictException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { ReservationStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";
import { ReservationsService } from "./reservations.service";

describe("ReservationsService", () => {
  async function buildService(prisma: unknown, redis: unknown = {}) {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ReservationsService,
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: redis },
        { provide: ConfigService, useValue: { get: () => "300" } }
      ]
    }).compile();

    return moduleRef.get(ReservationsService);
  }

  it("creates a pending reservation when stock is available", async () => {
    const createdReservation = {
      id: "reservation-1",
      productId: "product-1",
      userId: "user-1",
      quantity: 1,
      status: ReservationStatus.PENDING
    };
    const tx = {
      product: {
        findUnique: jest.fn().mockResolvedValue({ id: "product-1" }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      reservation: {
        create: jest.fn().mockResolvedValue(createdReservation)
      }
    };
    const prisma = {
      $transaction: jest.fn((callback) => callback(tx))
    };
    const redis = {
      acquireLock: jest.fn().mockResolvedValue("token"),
      releaseLock: jest.fn().mockResolvedValue(undefined)
    };
    const service = await buildService(prisma, redis);

    await expect(service.create({ productId: "product-1", userId: "user-1", quantity: 1 })).resolves.toBe(
      createdReservation
    );

    expect(redis.acquireLock).toHaveBeenCalledWith("lock:product:product-1", 5000);
    expect(tx.product.updateMany).toHaveBeenCalledWith({
      where: {
        id: "product-1",
        availableStock: { gte: 1 }
      },
      data: {
        availableStock: { decrement: 1 }
      }
    });
    expect(tx.reservation.create).toHaveBeenCalledWith({
      data: {
        productId: "product-1",
        userId: "user-1",
        quantity: 1,
        status: ReservationStatus.PENDING,
        expiresAt: expect.any(Date)
      },
      include: { product: true }
    });
    expect(redis.releaseLock).toHaveBeenCalledWith("lock:product:product-1", "token");
  });

  it("does not create a reservation when the product lock is busy", async () => {
    const prisma = {
      $transaction: jest.fn()
    };
    const redis = {
      acquireLock: jest.fn().mockResolvedValue(null),
      releaseLock: jest.fn()
    };
    const service = await buildService(prisma, redis);

    await expect(service.create({ productId: "product-1", userId: "user-1", quantity: 1 })).rejects.toThrow(
      ConflictException
    );

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(redis.releaseLock).not.toHaveBeenCalled();
  });

  it("returns sold out when atomic inventory update affects zero rows", async () => {
    const tx = {
      product: {
        findUnique: jest.fn().mockResolvedValue({ id: "product-1" }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 })
      },
      reservation: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn((callback) => callback(tx))
    };
    const redis = {
      acquireLock: jest.fn().mockResolvedValue("token"),
      releaseLock: jest.fn().mockResolvedValue(undefined)
    };

    const service = await buildService(prisma, redis);

    await expect(
      service.create({ productId: "product-1", userId: "user-1", quantity: 1 })
    ).rejects.toThrow(ConflictException);

    expect(tx.reservation.create).not.toHaveBeenCalled();
    expect(redis.releaseLock).toHaveBeenCalledWith("lock:product:product-1", "token");
  });

  it("blocks checkout for an expired pending reservation", async () => {
    const expiredReservation = {
      id: "reservation-1",
      productId: "product-1",
      quantity: 1,
      status: ReservationStatus.PENDING,
      expiresAt: new Date(Date.now() - 1000)
    };
    const tx = {
      reservation: {
        findUnique: jest.fn().mockResolvedValue(expiredReservation),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      product: {
        update: jest.fn().mockResolvedValue({})
      }
    };
    const prisma = {
      $transaction: jest.fn((callback) => callback(tx))
    };

    const service = await buildService(prisma);

    await expect(service.checkout("reservation-1")).rejects.toThrow(ConflictException);
    expect(tx.reservation.updateMany).toHaveBeenCalledWith({
      where: { id: "reservation-1", status: ReservationStatus.PENDING },
      data: { status: ReservationStatus.EXPIRED }
    });
    expect(tx.product.update).toHaveBeenCalledWith({
      where: { id: "product-1" },
      data: { availableStock: { increment: 1 } }
    });
  });

  it("completes checkout for a pending reservation before it expires", async () => {
    const pendingReservation = {
      id: "reservation-1",
      productId: "product-1",
      quantity: 1,
      status: ReservationStatus.PENDING,
      expiresAt: new Date(Date.now() + 60_000)
    };
    const completedReservation = {
      ...pendingReservation,
      status: ReservationStatus.COMPLETED,
      completedAt: new Date()
    };
    const tx = {
      reservation: {
        findUnique: jest.fn().mockResolvedValue(pendingReservation),
        update: jest.fn().mockResolvedValue(completedReservation)
      }
    };
    const prisma = {
      $transaction: jest.fn((callback) => callback(tx))
    };
    const service = await buildService(prisma);

    await expect(service.checkout("reservation-1")).resolves.toBe(completedReservation);

    expect(tx.reservation.update).toHaveBeenCalledWith({
      where: { id: "reservation-1" },
      data: {
        status: ReservationStatus.COMPLETED,
        completedAt: expect.any(Date)
      },
      include: { product: true }
    });
  });

  it("requires a userId when listing reservations for a user", async () => {
    const prisma = {
      reservation: {
        findMany: jest.fn()
      }
    };
    const service = await buildService(prisma);

    await expect(service.findForUser()).rejects.toThrow(BadRequestException);
    expect(prisma.reservation.findMany).not.toHaveBeenCalled();
  });

  it("expires pending reservations and returns stock to products", async () => {
    const expiredReservations = [
      { id: "reservation-1", productId: "product-1", quantity: 1 },
      { id: "reservation-2", productId: "product-2", quantity: 2 }
    ];
    const tx = {
      reservation: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      product: {
        update: jest.fn().mockResolvedValue({})
      }
    };
    const prisma = {
      reservation: {
        findMany: jest.fn().mockResolvedValue(expiredReservations)
      },
      $transaction: jest.fn((callback) => callback(tx))
    };
    const service = await buildService(prisma);

    await expect(service.expirePendingReservations()).resolves.toEqual({ expiredCount: 2 });

    expect(prisma.reservation.findMany).toHaveBeenCalledWith({
      where: {
        status: ReservationStatus.PENDING,
        expiresAt: { lte: expect.any(Date) }
      },
      select: {
        id: true,
        productId: true,
        quantity: true
      },
      take: 100
    });
    expect(tx.product.update).toHaveBeenCalledTimes(2);
    expect(tx.product.update).toHaveBeenNthCalledWith(1, {
      where: { id: "product-1" },
      data: { availableStock: { increment: 1 } }
    });
    expect(tx.product.update).toHaveBeenNthCalledWith(2, {
      where: { id: "product-2" },
      data: { availableStock: { increment: 2 } }
    });
  });
});
