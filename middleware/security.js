const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const mongoSanitize = require('express-mongo-sanitize');
const xss = require('xss');
const hpp = require('hpp');
const logger = require('../utils/logger');

// Rate limiting configurations
const createRateLimit = (windowMs, max, message) => {
  return rateLimit({
    windowMs,
    max,
    message: {
      success: false,
      message: message || 'Too many requests, please try again later.'
    },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      logger.warn('Rate limit exceeded', {
        ip: req.ip,
        url: req.originalUrl,
        userAgent: req.get('User-Agent')
      });
      res.status(429).json({
        success: false,
        message: 'Too many requests, please try again later.'
      });
    }
  });
};

// Different rate limits for different endpoints
const rateLimits = {
  // General rate limit
  general: createRateLimit(15 * 60 * 1000, 100, 'Too many requests from this IP'),
  
  // Strict rate limit for auth endpoints
  auth: createRateLimit(15 * 60 * 1000, 5, 'Too many authentication attempts, please try again later.'),
  
  // Rate limit for order creation
  orders: createRateLimit(15 * 60 * 1000, 10, 'Too many order attempts, please try again later.'),
  
  // Rate limit for contact form
  contact: createRateLimit(60 * 60 * 1000, 3, 'Too many contact requests, please try again later.'),
  
  // Rate limit for file uploads
  upload: createRateLimit(60 * 60 * 1000, 20, 'Too many upload attempts, please try again later.')
};

// Security headers configuration
const helmetConfig = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdn.jsdelivr.net"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://unpkg.com"],
      imgSrc: ["'self'", "data:", "https:", "blob:"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      connectSrc: ["'self'", "https://api.stripe.com"],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      manifestSrc: ["'self'"]
    }
  },
  crossOriginEmbedderPolicy: false,
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  }
});

// XSS protection middleware
const xssProtection = (req, res, next) => {
  if (req.body) {
    Object.keys(req.body).forEach(key => {
      if (typeof req.body[key] === 'string') {
        req.body[key] = xss(req.body[key]);
      }
    });
  }
  next();
};

// Request logging middleware
const requestLogger = (req, res, next) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    const logData = {
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip,
      userAgent: req.get('User-Agent')
    };
    
    if (res.statusCode >= 400) {
      logger.warn('HTTP Request Warning', logData);
    } else {
      logger.info('HTTP Request', logData);
    }
  });
  
  next();
};

// Account lockout middleware for failed login attempts
const accountLockout = new Map(); // In production, use Redis or database

const checkAccountLockout = (req, res, next) => {
  const email = req.body.email;
  const now = Date.now();
  const lockoutDuration = 15 * 60 * 1000; // 15 minutes
  const maxAttempts = 5;
  
  if (!email) return next();
  
  const attempts = accountLockout.get(email);
  
  if (attempts && attempts.count >= maxAttempts && now < attempts.lockUntil) {
    const remainingTime = Math.ceil((attempts.lockUntil - now) / 1000 / 60);
    logger.warn('Account locked due to too many failed attempts', { email, ip: req.ip });
    
    return res.status(429).json({
      success: false,
      message: `Account temporarily locked. Try again in ${remainingTime} minutes.`
    });
  }
  
  next();
};

const recordFailedAttempt = (req, res, next) => {
  const email = req.body.email;
  const now = Date.now();
  const lockoutDuration = 15 * 60 * 1000; // 15 minutes
  const maxAttempts = 5;
  
  if (!email) return next();
  
  const attempts = accountLockout.get(email) || { count: 0, lockUntil: 0 };
  
  if (now >= attempts.lockUntil) {
    attempts.count = 0;
  }
  
  attempts.count++;
  
  if (attempts.count >= maxAttempts) {
    attempts.lockUntil = now + lockoutDuration;
    logger.warn('Account locked after too many failed attempts', { email, ip: req.ip });
  }
  
  accountLockout.set(email, attempts);
  next();
};

const clearFailedAttempts = (email) => {
  if (email) {
    accountLockout.delete(email);
  }
};

module.exports = {
  rateLimits,
  helmetConfig,
  xssProtection,
  requestLogger,
  checkAccountLockout,
  recordFailedAttempt,
  clearFailedAttempts
};
