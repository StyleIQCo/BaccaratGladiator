// ═══════════════════════════════════════════════════════════════════
//  PRISMA SINGLETON — Next.js hot-reload safe.
//  Dev-mode module re-evaluation would otherwise leak a new connection
//  pool per save; the client is parked on globalThis outside prod.
// ═══════════════════════════════════════════════════════════════════
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
