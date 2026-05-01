require('dotenv').config();

const config = {
  // Environment
  env: process.env.NODE_ENV || 'development',
  port: process.env.PORT || 3002,
  
  // Database
  database: {
    uri: process.env.MONGODB_URI || 'mongodb+srv://lalitambanursery_db_user:iEaqel2M12cyIpW0@lalitambanursery.kphp3gk.mongodb.net/?appName=LALITAMBANURSERY',
    options: {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverApi: { version: '1', strict: true, deprecationErrors: true },
      serverSelectionTimeoutMS: 15000,
      socketTimeoutMS: 45000,
      family: 4,
      maxPoolSize: 10,
      minPoolSize: 5,
      maxIdleTimeMS: 30000,
      waitQueueTimeoutMS: 5000,
      retryWrites: true,
      w: 'majority'
    }
  },
  
  // Session
  session: {
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      sameSite: 'strict'
    }
  },
  
  // Security
  security: {
    rateLimitWindow: parseInt(process.env.RATE_LIMIT_WINDOW) || 15,
    rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
    bcryptRounds: 12,
    jwtSecret: process.env.JWT_SECRET || 'fallback-secret-change-in-production',
    jwtExpiresIn: '24h'
  },
  
  // File Upload
  upload: {
    maxSize: parseInt(process.env.MAX_FILE_SIZE) || 5242880, // 5MB
    path: process.env.UPLOAD_PATH || 'public/uploads/',
    allowedTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/heic'],
    maxFiles: 10
  },
  
  // Email
  email: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
    host: process.env.EMAIL_HOST,
    port: parseInt(process.env.EMAIL_PORT) || 587,
    from: process.env.EMAIL_FROM || process.env.EMAIL_USER
  },
  
  // Payment
  payment: {
    stripe: {
      secretKey: process.env.STRIPE_SECRET_KEY,
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY
    }
  },
  
  // Application
  app: {
    name: process.env.APP_NAME || 'SRI LALITAMBA NURSERY & GARDENS',
    url: process.env.APP_URL || 'http://localhost:3002',
    adminEmail: process.env.ADMIN_EMAIL
  },
  
  // Logging
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    maxSize: 5242880, // 5MB
    maxFiles: 5
  }
};

// Validate required environment variables
const requiredEnvVars = ['SESSION_SECRET'];
const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);

if (missingEnvVars.length > 0) {
  console.warn('⚠️ Missing recommended environment variables:', missingEnvVars.join(', '));
  // Not exiting, will use fallbacks
}

module.exports = config;
