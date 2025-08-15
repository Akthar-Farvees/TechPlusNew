import dotenv from "dotenv";
import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./route.js";
import cors from "cors";

dotenv.config();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cors({
  origin: process.env.Client_URL,
  credentials: true,
}));

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      console.log(logLine);
    }
  });

  next();
});

// Initialize routes and setup
async function initializeApp() {
  try {
    const server = await registerRoutes(app);

    app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
      const status = err.status || err.statusCode || 500;
      const message = err.message || "Internal Server Error";

      res.status(status).json({ message });
      console.error(err);
    });

    // Health check endpoint
    app.get("/", (req: Request, res: Response) => {
      res.json({ 
        message: "TechPlus Server API is running",
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || "development"
      });
    });

    // For development - start server
    if (process.env.NODE_ENV !== "production" && !process.env.VERCEL) {
      const port = parseInt(process.env.PORT || '5000', 10);
      server.listen({
        port,
        host: "0.0.0.0",
        reusePort: true,
      }, () => {
        console.log(`Development server running on port ${port}`);
      });
    }

    return server;
  } catch (error) {
    console.error("Error initializing app:", error);
    throw error;
  }
}

// For Vercel serverless deployment
if (process.env.VERCEL || process.env.NODE_ENV === "production") {
  // Initialize app for serverless
  initializeApp().catch(console.error);
} else {
  // For local development
  (async () => {
    await initializeApp();
  })();
}

// Export for Vercel
export default app;