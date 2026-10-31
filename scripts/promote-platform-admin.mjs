import { PrismaClient } from "@prisma/client";
import argon2 from "argon2";

const email = (process.env.PLATFORM_ADMIN_EMAIL || "theauthentic.ng@gmail.com").toLowerCase();
const password = process.env.PLATFORM_ADMIN_PASSWORD || "PIMB2026";

const prisma = new PrismaClient();

async function main() {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (!existing) {
    throw new Error(`No Nest user found for ${email}. Register it first, then re-run.`);
  }

  const passwordHash = await argon2.hash(password);
  const updated = await prisma.user.update({
    where: { email },
    data: {
      passwordHash,
      platformRole: "SUPER_ADMIN",
      emailVerifiedAt: new Date(),
      status: "ACTIVE",
      failedLogins: 0,
      lockedUntil: null,
    },
  });

  console.log(
    JSON.stringify({
      action: "updated",
      id: updated.id,
      email: updated.email,
      platformRole: updated.platformRole,
      emailVerifiedAt: updated.emailVerifiedAt,
      previousPlatformRole: existing.platformRole,
      wasVerified: Boolean(existing.emailVerifiedAt),
    }),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
