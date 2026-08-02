import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron, CronExpression } from "@nestjs/schedule";
import { Prisma, ReservationStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";
import { CreateReservationDto } from "./dto/create-reservation.dto";

@Injectable()
export class ReservationsService {
  private readonly ttlSeconds: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    config: ConfigService
  ) {
    this.ttlSeconds = Number(config.get<string>("RESERVATION_TTL_SECONDS") ?? 300);
  }

  async create(dto: CreateReservationDto) {
    const lockKey = `lock:product:${dto.productId}`;
    const lockToken = await this.redis.acquireLock(lockKey, 5000);

    if (!lockToken) {
      throw new ConflictException("Product is busy. Please retry.");
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const product = await tx.product.findUnique({
          where: { id: dto.productId },
          select: { id: true }
        });

        if (!product) {
          throw new NotFoundException("Product not found");
        }

        const updated = await tx.product.updateMany({
          where: {
            id: dto.productId,
            availableStock: { gte: dto.quantity }
          },
          data: {
            availableStock: { decrement: dto.quantity }
          }
        });

        if (updated.count === 0) {
          throw new ConflictException("Sold out");
        }

        return tx.reservation.create({
          data: {
            productId: dto.productId,
            userId: dto.userId,
            quantity: dto.quantity,
            status: ReservationStatus.PENDING,
            expiresAt: new Date(Date.now() + this.ttlSeconds * 1000)
          },
          include: { product: true }
        });
      });
    } finally {
      await this.redis.releaseLock(lockKey, lockToken);
    }
  }

  async findOne(id: string) {
    const reservation = await this.prisma.reservation.findUnique({
      where: { id },
      include: { product: true }
    });

    if (!reservation) {
      throw new NotFoundException("Reservation not found");
    }

    return reservation;
  }

  async findForUser(userId?: string) {
    if (!userId) {
      throw new BadRequestException("userId is required");
    }

    return this.prisma.reservation.findMany({
      where: { userId },
      include: { product: true },
      orderBy: { createdAt: "desc" }
    });
  }

  async checkout(id: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      const reservation = await tx.reservation.findUnique({
        where: { id },
        include: { product: true }
      });

      if (!reservation) {
        throw new NotFoundException("Reservation not found");
      }

      if (reservation.status !== ReservationStatus.PENDING) {
        throw new ConflictException(`Reservation is already ${reservation.status.toLowerCase()}`);
      }

      if (reservation.expiresAt <= new Date()) {
        await this.expireReservation(tx, reservation.id, reservation.productId, reservation.quantity);
        return null;
      }

      return tx.reservation.update({
        where: { id },
        data: {
          status: ReservationStatus.COMPLETED,
          completedAt: new Date()
        },
        include: { product: true }
      });
    });

    if (!result) {
      throw new ConflictException("Reservation expired");
    }

    return result;
  }

  @Cron(CronExpression.EVERY_30_SECONDS)
  async expirePendingReservations() {
    const expiredReservations = await this.prisma.reservation.findMany({
      where: {
        status: ReservationStatus.PENDING,
        expiresAt: { lte: new Date() }
      },
      select: {
        id: true,
        productId: true,
        quantity: true
      },
      take: 100
    });

    for (const reservation of expiredReservations) {
      await this.prisma.$transaction((tx) =>
        this.expireReservation(tx, reservation.id, reservation.productId, reservation.quantity)
      );
    }

    return { expiredCount: expiredReservations.length };
  }

  private async expireReservation(
    tx: Prisma.TransactionClient,
    reservationId: string,
    productId: string,
    quantity: number
  ) {
    const updated = await tx.reservation.updateMany({
      where: {
        id: reservationId,
        status: ReservationStatus.PENDING
      },
      data: { status: ReservationStatus.EXPIRED }
    });

    if (updated.count === 1) {
      await tx.product.update({
        where: { id: productId },
        data: {
          availableStock: { increment: quantity }
        }
      });
    }
  }
}
