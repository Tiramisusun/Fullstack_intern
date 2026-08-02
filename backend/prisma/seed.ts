import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  await prisma.reservation.deleteMany();
  await prisma.product.deleteMany();

  await prisma.product.createMany({
    data: [
      {
        name: "Founders Hoodie",
        description: "Heavyweight black hoodie from the first limited drop.",
        imageUrl: "https://images.unsplash.com/photo-1556821840-3a63f95609a7?auto=format&fit=crop&w=900&q=80",
        priceCents: 8900,
        totalStock: 8,
        availableStock: 8
      },
      {
        name: "Launch Cap",
        description: "Low-profile cap with embroidered launch mark.",
        imageUrl: "https://images.unsplash.com/photo-1521369909029-2afed882baee?auto=format&fit=crop&w=900&q=80",
        priceCents: 3200,
        totalStock: 12,
        availableStock: 12
      },
      {
        name: "Drop Tote",
        description: "Canvas tote reserved for early checkout customers.",
        imageUrl: "https://images.unsplash.com/photo-1590874103328-eac38a683ce7?auto=format&fit=crop&w=900&q=80",
        priceCents: 2400,
        totalStock: 5,
        availableStock: 5
      }
    ]
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
