// src/config/db.ts
import mongoose from "mongoose";
import { env } from "./env";

// ─── Connection options ───────────────────────────────────────────────────────
const MONGO_OPTIONS: mongoose.ConnectOptions = {
  maxPoolSize:              10,      // max simultaneous connections in the pool
  minPoolSize:               2,      // keep 2 connections warm at all times
  socketTimeoutMS:       45_000,     // close sockets idle longer than 45s
  serverSelectionTimeoutMS: 5_000,   // give up selecting a server after 5s
  heartbeatFrequencyMS:  10_000,     // check server health every 10s
  autoIndex: env.isDev,              // build indexes in dev only; use migrations in prod
};

// ─── Internal state ───────────────────────────────────────────────────────────
let _connected = false;

// ─── Connection event listeners ───────────────────────────────────────────────
mongoose.connection.on("connected",    ()    => { _connected = true;  console.log("✅  MongoDB connected"); });
mongoose.connection.on("disconnected", ()    => { _connected = false; console.warn("⚠️   MongoDB disconnected"); });
mongoose.connection.on("error",        (err) =>                       console.error("❌  MongoDB error:", err.message));

// ─── connectDB ────────────────────────────────────────────────────────────────
// Retries up to MAX_RETRIES times with a delay between each attempt.
// Call this once in server.ts before app.listen().
export async function connectDB(): Promise<void> {
  if (_connected) return; // already connected (e.g. hot-reload)

  const MAX_RETRIES  = 5;
  const RETRY_DELAY  = 3_000; // ms between retries

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      // console.log(env.mongo);
      console.log(`🔌  Connecting to MongoDB (attempt ${attempt}/${MAX_RETRIES})…`);
      await mongoose.connect(env.mongo.uri, MONGO_OPTIONS);
      return; // success — exit the loop
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`   ✗ Attempt ${attempt} failed: ${msg}`);

      if (attempt === MAX_RETRIES) {
        // All retries exhausted — crash the process so the container restarts
        throw new Error(`Could not connect to MongoDB after ${MAX_RETRIES} attempts.`);
      }

      console.log(`   Retrying in ${RETRY_DELAY / 1000}s…`);
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
    }
  }
}

// ─── disconnectDB ─────────────────────────────────────────────────────────────
// Used in tests and graceful shutdown.
export async function disconnectDB(): Promise<void> {
  if (!_connected) return;
  await mongoose.connection.close();
  console.log("🔒  MongoDB connection closed");
}

// ─── Graceful shutdown ────────────────────────────────────────────────────────
// Ensures the DB connection is cleanly closed when the process is stopped.
const shutdown = async (signal: string) => {
  console.log(`\n${signal} received — shutting down gracefully…`);
  await disconnectDB();
  process.exit(0);
};

process.on("SIGINT",  () => shutdown("SIGINT"));   // Ctrl+C
process.on("SIGTERM", () => shutdown("SIGTERM"));  // Docker / PM2 stop