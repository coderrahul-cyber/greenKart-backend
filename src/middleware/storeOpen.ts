// // src/middlewares/storeOpen.ts
// // Middleware that blocks any request when the store is closed.
// // Apply this ONLY to routes that require the store to be open:
// //   - Cart: addItem, updateItem, removeItem, clearCart
// //   - Orders: placeOrder
// //
// // NOT applied to:
// //   - GET /products      (browsing always works)
// //   - GET /cart          (viewing cart always works)
// //   - GET /orders        (order history always works)
// //   - Any admin routes   (admin is never blocked)

// import type { Request, Response, NextFunction } from "express";
// import { isStoreOpen } from "../utils/storeState";

// export const requireStoreOpen = async (
//   _req: Request,
//   res:  Response,
//   next: NextFunction
// ): Promise<void> => {
//   try {
//     const open = await isStoreOpen();

//     if (!open) {
//       res.status(503).json({
//         success: false,
//         code:    "STORE_CLOSED",
//         message: "Our store is currently closed. You can still browse products but cannot add to cart or place orders. Please check back soon!",
//       });
//       return;
//     }

//     next();
//   } catch {
//     // Redis unreachable — fail open (don't block users due to infra issue)
//     next();
//   }
// };