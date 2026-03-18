// src/config/env.ts
// Reads and VALIDATES every environment variable at startup.
// The server will throw immediately if a required variable is missing —
// so you never get a silent undefined in production.

const str = (key: string, fallback?: string): string => {
  const val = process.env[key] ?? fallback;
  if (val === undefined) {
    throw new Error(`[env] Missing required environment variable: "${key}"`);
  }
  return val;
};

const num = (key: string, fallback?: number): number => {
  const raw = process.env[key];
  if (raw === undefined) {
    if (fallback !== undefined) return fallback;
    throw new Error(`[env] Missing required environment variable: "${key}"`);
  }
  const parsed = Number(raw);
  if (isNaN(parsed)) {
    throw new Error(`[env] Environment variable "${key}" must be a number, got "${raw}"`);
  }
  return parsed;
};

// ─── Exported config object ───────────────────────────────────────────────────
export const env = {
  // App
  NODE_ENV : str("NODE_ENV", "development"),
  PORT     : num("PORT", 3000),

  // Helpers — use these instead of comparing NODE_ENV strings directly
  get isProd() { return this.NODE_ENV === "production";  },
  get isDev()  { return this.NODE_ENV === "development"; },
  get isTest() { return this.NODE_ENV === "test";        },

  // MongoDB
  mongo: {
    uri: str("MONGO_URI"),
  },

  // JWT — separate secrets for access vs refresh tokens
  jwt: {
    accessSecret:     str("JWT_ACCESS_SECRET"),
    accessExpiresIn:  str("JWT_ACCESS_EXPIRES_IN",  "15m"),
    refreshSecret:    str("JWT_REFRESH_SECRET"),
    refreshExpiresIn: str("JWT_REFRESH_EXPIRES_IN", "30d"),
  },

  // Store location — used for 8km delivery radius check at registration
  store: {
    lat:      num("STORE_LAT"),
    lng:      num("STORE_LNG"),
    radiusKm: num("STORE_RADIUS_KM", 8),
  },

  // Frontend URL — used for CORS whitelist
  frontendUrl: str("FRONTEND_URL", ""),

  // Admin credentials — hardcoded in .env, never stored in DB
  admin: {
    username: str("ADMIN_USERNAME"),
    password: str("ADMIN_PASSWORD"),
  },

  // Bcrypt
  bcrypt: {
    saltRounds: num("BCRYPT_SALT_ROUNDS", 12),
  },

  // Razorpay — create account at https://razorpay.com, get keys from Dashboard → API Keys
  razorpay: {
    keyId:     str("RAZORPAY_KEY_ID",     ""),
    keySecret: str("RAZORPAY_KEY_SECRET", ""),
    // Webhook secret — set in Razorpay Dashboard → Webhooks → add endpoint
    webhookSecret: str("RAZORPAY_WEBHOOK_SECRET", ""),
  },

  // Cloudinary — optional until image upload is built
  cloudinary: {
    cloudName: str("CLOUDINARY_CLOUD_NAME", ""),
    apiKey:    str("CLOUDINARY_API_KEY",    ""),
    apiSecret: str("CLOUDINARY_API_SECRET", ""),
  },



  // Web Push (VAPID) — for background push notifications to admin browser
  // Generate keys once: npx web-push generate-vapid-keys
  vapid: {
    publicKey:  str("VAPID_PUBLIC_KEY"),
    privateKey: str("VAPID_PRIVATE_KEY"),
    subject:    str("VAPID_SUBJECT", "mailto:admin@greenkart.in"),
  },


} as const;