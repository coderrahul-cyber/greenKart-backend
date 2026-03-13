// // src/utils/storeState.ts
// // Manages the store's open/closed state in Redis.
// //
// // Why Redis and not a DB field or env var?
// //   - DB field: works but adds a DB round-trip to every cart/order request
// //   - Env var: requires a server restart to toggle — unusable for live control
// //   - Redis: sub-millisecond read, survives process restarts, instant toggle
// //
// // Key: "store:isOpen"  →  "true" | "false"
// // Default when key is missing: store is OPEN (safe default)

// import { redis } from "../config/redis";

// const STORE_STATE_KEY = "store:isOpen";

// // ─── Check if store is open ───────────────────────────────────────────────────
// // Returns true if open (or key missing — safe default)
// export const isStoreOpen = async (): Promise<boolean> => {
//   const val = await redis.get(STORE_STATE_KEY);
//   // Key missing = never been toggled = treat as open
//   if (val === null) return true;
//   return val === "true";
// };

// // ─── Set store state ──────────────────────────────────────────────────────────
// export const setStoreOpen = async (open: boolean): Promise<void> => {
//   await redis.set(STORE_STATE_KEY, open ? "true" : "false");
// };

// // ─── Get full store status object (for admin dashboard / health) ──────────────
// export const getStoreStatus = async (): Promise<{
//   isOpen:      boolean;
//   message:     string;
//   lastChanged: string | null;
// }> => {
//   const [stateVal, lastChanged] = await Promise.all([
//     redis.get(STORE_STATE_KEY),
//     redis.get("store:lastChanged"),
//   ]);

//   const isOpen = stateVal === null ? true : stateVal === "true";

//   return {
//     isOpen,
//     message:     isOpen ? "Store is open" : "Store is currently closed",
//     lastChanged: lastChanged ?? null,
//   };
// };

// // ─── Record when the state last changed (for admin audit) ─────────────────────
// export const recordStoreStateChange = async (
//   open:     boolean,
//   adminId:  string
// ): Promise<void> => {
//   await redis.set(
//     "store:lastChanged",
//     JSON.stringify({
//       isOpen:    open,
//       changedAt: new Date().toISOString(),
//       changedBy: adminId,
//     })
//   );
// };