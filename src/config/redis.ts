// // src/config/redis.ts
// // Single Redis client shared by:
// //   - OTP store  (GET/SET/DEL with TTL)
// //   - BullMQ     (uses a separate ioredis connection internally)
// //
// // Supports both:
// //   Local Redis:  REDIS_HOST + REDIS_PORT + REDIS_PASSWORD
// //   Cloud Redis:  REDIS_URL (Upstash, Redis Cloud — includes TLS automatically)

// import Redis from "ioredis";
// import { env } from "./env";

// // If REDIS_URL is set (cloud), use it directly — it includes host, port, password, TLS
// // Otherwise fall back to individual host/port/password fields (local Redis)
// const redisOptions = env.redis.url
//   ? {
//       // Cloud Redis URL — ioredis parses it automatically
//       // maxRetriesPerRequest + enableReadyCheck required by BullMQ
//       maxRetriesPerRequest: null  as unknown as number,
//       enableReadyCheck:     false,
//     }
//   : {
//       host:                 env.redis.host,
//       port:                 env.redis.port,
//       password:             env.redis.password || undefined,
//       maxRetriesPerRequest: null  as unknown as number,
//       enableReadyCheck:     false,
//     };

// // ─── Shared client (for OTP key operations) ───────────────────────────────────
// export const redis = env.redis.url
//   ? new Redis(env.redis.url, redisOptions)
//   : new Redis(redisOptions);

// redis.on("connect", () => console.log("✅  Redis connected"));
// redis.on("error",   (err) => console.error("❌  Redis error:", err.message));

// // ─── BullMQ connection options ────────────────────────────────────────────────
// export const bullMqConnection = env.redis.url
//   ? { ...redisOptions, lazyConnect: true } as unknown as { host?: string; port?: number }
//   : redisOptions;