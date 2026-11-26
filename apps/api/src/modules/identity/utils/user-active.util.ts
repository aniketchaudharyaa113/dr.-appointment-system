import { PrismaService } from '../../platform/database/prisma.service';
import { RedisService } from '../../platform/redis/redis.service';

export async function isUserActiveCached(
  prisma: PrismaService,
  redis: RedisService,
  userId: string,
): Promise<boolean> {
  const cacheKey = `user:active:${userId}`;
  const client = redis.getClient();

  if (client) {
    try {
      const cached = await client.get(cacheKey);
      if (cached === '1') return true;
      if (cached === '0') return false;
    } catch {
      // Fall back to DB if Redis is transiently unavailable
    }
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isActive: true },
  });
  const active = Boolean(user?.isActive);

  if (client) {
    try {
      await client.set(cacheKey, active ? '1' : '0', 'EX', 30);
    } catch {
      // Ignore cache write failures
    }
  }

  return active;
}
