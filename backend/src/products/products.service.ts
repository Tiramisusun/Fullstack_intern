import { Injectable, NotFoundException } from "@nestjs/common";
import { ReservationStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    const products = await this.prisma.product.findMany({
      orderBy: { createdAt: "asc" }
    });

    const reservationTotals = await this.prisma.reservation.groupBy({
      by: ["productId", "status"],
      where: {
        status: {
          in: [ReservationStatus.PENDING, ReservationStatus.COMPLETED]
        }
      },
      _sum: { quantity: true }
    });

    return products.map((product) => {
      const totalsForProduct = reservationTotals.filter((total) => total.productId === product.id);
      const reservedStock =
        totalsForProduct.find((total) => total.status === ReservationStatus.PENDING)?._sum.quantity ?? 0;
      const soldStock =
        totalsForProduct.find((total) => total.status === ReservationStatus.COMPLETED)?._sum.quantity ?? 0;

      return {
        ...product,
        reservedStock,
        soldStock
      };
    });
  }

  async findOne(id: string) {
    const product = await this.prisma.product.findUnique({ where: { id } });

    if (!product) {
      throw new NotFoundException("Product not found");
    }

    return product;
  }
}
