import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { PrismaClient } from '@prisma/client';

// Import Routes
import authRoutes from './routes/auth.routes';
import profileRoutes from './routes/profile.routes'
import eventRoutes from './routes/event.routes'
import teamRoutes from './routes/team.routes'
import teamDashboardRoutes from './routes/teamDashboard.routes';
import eventStaffRoutes from './routes/staffManagement.routes';
import locationRoutes from './routes/location.routes';
import { config } from './config/env';
import imageRoutes from './routes/image';
// Initialize App
const app = express();
const prisma = new PrismaClient();
const PORT = Number(config.PORT) || 3000;

// =========================================
// 1. GLOBAL MIDDLEWARE (Security & Utility)
// =========================================

// A. Helmet: Sets various HTTP headers to secure the app
// (Prevents XSS, Clickjacking, Sniffing attacks)
app.use(helmet());

// B. CORS: Allow your React Frontend to talk to this Backend
// Inside your backend's server.ts file
const allowedOrigins = [
  'http://localhost:3000', 

  'http://localhost:3001', // Your mobile/local testing IP

  'http://localhost:3001',
  'http://192.168.20.39:3001',// Your mobile/local testing IP

  config.FRONTEND_URL    // Your live Vercel URL
];

app.use(cors({
  origin: function (origin, callback) {
    // allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    // Remove trailing slashes from the origin just in case
    const cleanOrigin = origin.replace(/\/$/, '');

    if (allowedOrigins.indexOf(cleanOrigin) !== -1 || !process.env.FRONTEND_URL) {
      callback(null, true);
    } else {
      console.log('Blocked by CORS. Origin:', origin); // Helps with debugging!
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true, // REQUIRED if you are sending tokens/cookies
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Upgrade-Insecure-Requests']
}));

// C. Body Parser: Strict limit to prevent DoS via large payloads
app.use(express.json({ limit: '10kb' })); 

// D. Global Rate Limiter (Baseline protection for all routes)
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per window
  message: 'Too many requests from this IP, please try again later'
});
app.use('/api', globalLimiter);

// =========================================
// 2. ROUTE MOUNTING
// =========================================

app.use(express.json({ limit: '10kb' }));

app.use((req, res, next) => {
    console.log("Incoming request:", req.method, req.url);
    next();
});




// Health Check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'UP', timestamp: new Date() });
});

// Auth & User
app.use('/api/auth', authRoutes);
app.use('/api/profile', profileRoutes);

// Participant Registration (Solo or Team)
app.use('/api/registration', teamRoutes); 

// Team Management & Participant Invites
app.use('/api/team-dashboard', teamDashboardRoutes);

// --- STAFF DASHBOARD & MANAGEMENT ROUTES ---
// We mount all admin features under this unified prefix

app.use('/api/events/:eventId/manage', [
  eventStaffRoutes, // For Roles & Invites
  // timelineRoutes,        // For Agenda (Coming next!)
  // submissionRoutes       // For Reviewing Projects
]);

// Public Staff Actions (Accepting Invites)
// Path B: For User actions (No Event ID needed yet because it's inside the magic link token)
// This handles: POST /api/staff/accept-invite
app.use('/api/staff', eventStaffRoutes);
// Events & Staff Management
app.use('/api/events', eventRoutes);
app.use('/api/events/:eventId/staff', eventStaffRoutes); // For organizers
app.use('/api/locations', locationRoutes); // For location search


// Image Upload
app.use('/api/image', imageRoutes);


// =========================================
// 3. GLOBAL ERROR HANDLER
// =========================================
// This ensures the server never crashes due to an unhandled error
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  console.error('[SERVER_ERROR]', err.stack);

  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  res.status(statusCode).json({
    success: false,
    error: message,
    stack: config.NODE_ENV === 'development' ? err.stack : undefined
  });
});

// =========================================
// 4. SERVER STARTUP
// =========================================
const startServer = async () => {
  try {
    // Test Database Connection
    await prisma.$connect();
    console.log('✅ Database connected successfully');

    app.listen(PORT, () => {
      console.log(`🚀Server running on http://localhost:${PORT}`);
      console.log(`🛡️ Environment: ${config.NODE_ENV || 'development'}`);
    });

  } catch (error) {
    console.error('❌ Failed to start server:', error);
    await prisma.$disconnect();
    process.exit(1); // Exit with failure
  }
};

startServer();