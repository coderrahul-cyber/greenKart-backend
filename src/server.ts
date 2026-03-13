// src/server.ts
import express, { type Request, type Response } from "express";
import cors    from "cors";
import helmet  from "helmet";
import { mongoSanitize } from "./middleware/mongoSanitize";
import { publicApiLimiter } from "./middleware/rateLimiter";
import { env, connectDB } from "./config";
// import { getStoreStatus } from "./utils/storeState";
import { initWebPush }   from "./utils/webPush";
import { notFound, errorHandler } from "./middleware/errorHandler";

// ── Module routers ────────────────────────────────────────────────────────────
import { userRouter }    from "./modules/user/user.routes";
import { productRouter } from "./modules/product/product.routes";
import { cartRouter }    from "./modules/cart/cart.routes";
import { orderRouter }   from "./modules/order/order.routes";
import { paymentRouter } from "./modules/payment/payments.routes";
import { adminRouter }   from "./modules/admin/admin.routes";

async function bootstrap() {
  await connectDB();
  initWebPush();

  const app = express();

  // ── CORS ─────────────────────────────────────────────────────────────────────
  // Allow requests from your frontend origin.
  // In prod: set FRONTEND_URL in .env to your deployed frontend URL
  // const allowedOrigins = env.frontendUrl
  //   ? env.frontendUrl.split(",").map(o => o.trim())
  //   : ["http://localhost:5173", "https://greenkartt.shop"];

 app.use(
  cors({
    origin: "*",
    credentials: false,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

  // ── Security headers (Helmet) ────────────────────────────────────────────────
  // Sets 11 HTTP headers in one line:
  // X-XSS-Protection, X-Frame-Options, X-Content-Type-Options,
  // Strict-Transport-Security, Content-Security-Policy, and more.
  app.use(helmet());

  // ── NoSQL injection sanitizer ─────────────────────────────────────────────
  // Strips $ and . from req.body, req.params, req.query in-place.
  // Prevents attacks like: { "email": { "$gt": "" } } bypassing login.
  // Custom implementation — express-mongo-sanitize reassigns req properties
  // which throws TypeError in Bun (readonly properties).
  app.use(mongoSanitize);

  // ── Global rate limit ─────────────────────────────────────────────────────
  // Baseline 120 req/min per IP across all routes.
  // Sensitive routes (login, register) have tighter limits applied directly.
  app.use(publicApiLimiter);

  // ── Core middleware ──────────────────────────────────────────────────────────
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: true }));

  // ── Dev request logger ───────────────────────────────────────────────────────
  if (env.isDev) {
    app.use((req: Request, _res: Response, next) => {
      console.log(`  [${req.method}]  ${req.originalUrl}`);
      next();
    });
  }

  // ── Public store status — no auth needed, frontend checks this on load ────────
  // Returns { isOpen, message } — frontend disables cart/checkout when isOpen:false
  // app.get("/store/status", (_req, res) => {
  //   res.json({ success: true, data: getStoreStatus() });
  // });

  // ── Health check ─────────────────────────────────────────────────────────────
  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", env: env.NODE_ENV, ts: new Date().toISOString() });
  });

  // ── API routes ────────────────────────────────────────────────────────────────
  const API = "/api/v1";
  app.use(`${API}/users`,    userRouter);
  app.use(`${API}/products`, productRouter);
  app.use(`${API}/cart`,     cartRouter);
  app.use(`${API}/orders`,   orderRouter);
  app.use(`${API}/payments`, paymentRouter);
  app.use(`${API}/admin`,    adminRouter);

  // ── 404 + global error handler (must be last) ─────────────────────────────────
  app.use(notFound);
  app.use(errorHandler);

  app.listen(env.PORT, () => {
    console.log(`🚀  Server ready → http://localhost:${env.PORT}  [${env.NODE_ENV}]`);
    console.log(`\n📋  Routes:`);
    console.log(`    ${API}/users`);
    console.log(`    ${API}/products`);
    console.log(`    ${API}/cart`);
    console.log(`    ${API}/orders`);
    console.log(`    ${API}/payments`);
  });
}

bootstrap().catch((err) => {
  console.error("❌  Failed to start:", err.message);
  process.exit(1);
});