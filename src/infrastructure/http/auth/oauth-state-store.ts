import type { OAuthStateEntry, OAuthStateStorePort } from "@/application/ports/auth.ports.js";
import { redisConnection } from "@/infrastructure/queue/redis.js";

const OAUTH_STATE_TTL_SECONDS = 10 * 60;

export class RedisOAuthStateStore implements OAuthStateStorePort {
  async store(state: string, entry: OAuthStateEntry): Promise<void> {
    await redisConnection.set(`oauth:state:${state}`, JSON.stringify(entry), "EX", OAUTH_STATE_TTL_SECONDS);
  }

  async consume(state: string): Promise<OAuthStateEntry | null> {
    const key = `oauth:state:${state}`;
    const raw = await redisConnection.get(key);
    if (!raw) return null;
    await redisConnection.del(key);
    return JSON.parse(raw) as OAuthStateEntry;
  }
}

export class InMemoryOAuthStateStore implements OAuthStateStorePort {
  private readonly entries = new Map<string, OAuthStateEntry>();

  async store(state: string, entry: OAuthStateEntry): Promise<void> {
    this.entries.set(state, entry);
  }

  async consume(state: string): Promise<OAuthStateEntry | null> {
    const entry = this.entries.get(state) ?? null;
    this.entries.delete(state);
    return entry;
  }
}
