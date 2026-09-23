import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import hrmRoutes from './routes/index.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Trust Proxy for reverse proxies (e.g. ngrok, load balancers)
app.set('trust proxy', 1);

// Security Middlewares
app.use(helmet());
app.use(cors());

// Rate Limiting (1000 requests per 15 minutes window)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests from this IP, please try again after 15 minutes',
    },
  },
});
app.use(limiter);

// Body Parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Base / Health check
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Attendy HRMS REST API is running',
    version: '1.0.0',
    documentation: '/api/hrm',
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/health', (req, res) => {
  res.status(200).json({
    success: true,
    status: 'healthy',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// HRMS API Routes: /api/hrm/*
app.use('/api/hrm', hrmRoutes);

// 404 Route Not Found Handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'ROUTE_NOT_FOUND',
      message: `Cannot ${req.method} ${req.originalUrl}`,
    },
  });
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('Unhandled Error:', err);
  const status = err.status || 500;
  res.status(status).json({
    success: false,
    error: {
      code: err.code || 'INTERNAL_SERVER_ERROR',
      message: err.message || 'An unexpected error occurred on the server',
    },
  });
});

// Helper to detect and log active ngrok tunnel URL
async function logNgrokUrl(retries = 10, delayMs = 600) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch('http://127.0.0.1:4040/api/tunnels');
      if (res.ok) {
        const data = await res.json();
        const httpsTunnel = data.tunnels?.find((t) => t.proto === 'https') || data.tunnels?.[0];
        if (httpsTunnel?.public_url) {
          console.log(`🌐 Ngrok Public Tunnel: ${httpsTunnel.public_url}`);
          console.log(`🔗 Ngrok API Base URL:  ${httpsTunnel.public_url}/api/hrm`);
          return;
        }
      }
    } catch {
      // ngrok tunnel initializing...
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}

// Export app and server listener
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, async () => {
    console.log(`🚀 Attendy HRMS API Server running on port ${PORT}`);
    console.log(`🔗 Local Base URL:     http://localhost:${PORT}/api/hrm`);
    console.log(`🛡️  Environment:        ${process.env.NODE_ENV || 'development'}`);
    await logNgrokUrl();
  });
}

export default app;

