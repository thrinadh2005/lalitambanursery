const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const methodOverride = require('method-override');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const mongoSanitize = require('express-mongo-sanitize');
const xss = require('xss-clean');
const compression = require('compression');
const fs = require('fs');

// Load environment variables
require('dotenv').config();
const PDFDocument = require('pdfkit');
const slugify = require('slugify');
const csv = require('csv-parser');
const { Parser } = require('json2csv');

// Import models
const User = require('./models/User');
const Plant = require('./models/Plant');
const Cart = require('./models/Cart');
const Order = require('./models/Order');
const Review = require('./models/Review');
const Expense = require('./models/Expense');
const Bill = require('./models/Bill');
const ImportExport = require('./models/ImportExport');
const Investment = require('./models/Investment');
const Message = require('./models/Message');
const AuditLog = require('./models/AuditLog');
const ImageService = require('./services/imageService');

// Helper function to escape regex special characters
function escapeRegex(string) {
  return string.replace(/[/\-\\^$*+?.()|[\]{}]/g, '\\$&');
}

// Global Audit Logging Helper
async function logAudit(action, module, details, user = null, severity = 'low', metadata = {}) {
  try {
    const log = new AuditLog({
      action,
      module,
      details,
      performedBy: user ? user._id : null,
      severity,
      metadata
    });
    await log.save();
  } catch (err) {
    console.error('FAILED TO SAVE AUDIT LOG:', err);
  }
}

const app = express();

// Connect to MongoDB Atlas with better error handling
const mongoUri = process.env.MONGODB_URI || 'mongodb+srv://lalitambanursery_db_user:iEaqel2M12cyIpW0@lalitambanursery.kphp3gk.mongodb.net/?appName=LALITAMBANURSERY';

mongoose.connect(mongoUri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 30000,
  maxPoolSize: 10,
  socketTimeoutMS: 60000,
  connectTimeoutMS: 30000,
  family: 4
})
  .then(() => console.log('✅ Connected to MongoDB Atlas'))
  .catch(err => {
    console.error('❌ MongoDB Atlas connection error:', err);
    console.log('⚠️  MongoDB not connected - Running in limited mode');
    console.log('Please check your internet connection and MongoDB Atlas credentials');
  });

// Handle MongoDB connection errors
mongoose.connection.on('error', (err) => {
  console.error('❌ MongoDB Atlas connection error:', err);
});

mongoose.connection.on('disconnected', () => {
  console.log('⚠️  MongoDB Atlas disconnected');
});

// API Health Check Endpoint
app.get('/api/health', async (req, res) => {
  const dbStatus = mongoose.connection.readyState;
  // 0: disconnected, 1: connected, 2: connecting, 3: disconnecting
  const isDbConnected = dbStatus === 1;

  const status = {
    server: 'running',
    timestamp: new Date().toISOString(),
    database: {
      status: isDbConnected ? 'connected' : 'disconnected',
      readyState: dbStatus,
      host: isDbConnected ? mongoose.connection.host : null
    },
    memory: process.memoryUsage(),
    uptime: process.uptime()
  };

  if (!isDbConnected) {
    return res.status(503).json(status); // 503 Service Unavailable if DB is down
  }

  res.status(200).json(status);
});

mongoose.connection.on('reconnected', () => {
  console.log('✅ MongoDB Atlas reconnected');
});

// Set up EJS as template engine
app.set('view engine', 'ejs');
app.set('views', __dirname + '/views');

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com", "https://unpkg.com"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com", "https://unpkg.com", "https://accounts.google.com"],
      scriptSrcAttr: ["'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:", "https://via.placeholder.com", "https://placehold.co", "https://images.unsplash.com", "https://lh3.googleusercontent.com", "*"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
      connectSrc: ["'self'", "https://accounts.google.com"],
      frameSrc: ["'self'", "https://accounts.google.com"],
    },
  },
}));
app.use(compression());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 3000 // Increased limit for development/active usage
});
app.use(limiter);

// Stricter rate limiter for login routes
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // limit each IP to 10 login requests per windowMs
  message: 'Too many login attempts from this IP, please try again after 15 minutes'
});

// Middleware
app.use(express.static('public', {
  maxAge: process.env.NODE_ENV === 'production' ? '1d' : 0,
  etag: true
}));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Data Sanitization against NoSQL query injection
app.use(mongoSanitize());

// Data Sanitization against XSS
app.use(xss());

app.use(methodOverride('_method'));

// Session configuration
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1); // trust first proxy
}

app.use(session({
  secret: process.env.SESSION_SECRET || 'your-super-secret-key-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production', // Set to true in production with HTTPS
    httpOnly: true, // Prevents client-side JS from reading the cookie
    sameSite: 'lax', // Protects against CSRF attacks
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Database connection middleware
app.use((req, res, next) => {
  req.dbConnected = mongoose.connection.readyState === 1;
  if (!req.dbConnected) {
    console.log('Database not connected - Request in limited mode');
  }
  next();
});

// Error handling middleware for database operations
const handleDatabaseError = (err, req, res, next) => {
  if (err.name === 'MongooseError' || err.name === 'MongoError') {
    console.error('Database error:', err);
    return res.status(503).render('500', {
      title: 'Database Error',
      error: 'Database connection error. Please try again later.',
      message: 'Our database is temporarily unavailable. Please refresh the page or try again later.'
    });
  }
  next(err);
};

app.use(handleDatabaseError);

// Passport configuration
app.use(passport.initialize());
app.use(passport.session());

passport.use(new LocalStrategy({ usernameField: 'email' }, async (email, password, done) => {
  try {
    // Check database connection
    if (mongoose.connection.readyState !== 1) {
      return done(null, false, { message: 'Database not connected. Please try again later.' });
    }

    // Search by email OR username
    const user = await User.findOne({
      $or: [
        { email: email.toLowerCase() },
        { username: email.toLowerCase() }
      ]
    });

    if (!user) {
      return done(null, false, { message: 'Invalid email/username or password' });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return done(null, false, { message: 'Invalid email/username or password' });
    }

    // Update last login
    user.lastLogin = new Date();
    await user.save();

    return done(null, user);
  } catch (error) {
    console.error('Authentication error:', error);
    return done(error);
  }
}));

// Google Strategy
passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID || 'your_google_client_id',
  clientSecret: process.env.GOOGLE_CLIENT_SECRET || 'your_google_client_secret',
  callbackURL: "/auth/google/callback",
  proxy: true
}, async (accessToken, refreshToken, profile, done) => {
  try {
    // Check if user already exists
    let user = await User.findOne({ googleId: profile.id });

    if (user) {
      return done(null, user);
    }

    // If user doesn't exist by googleId, check by email
    const emailToSearch = profile.emails && profile.emails[0] ? profile.emails[0].value : null;
    if (emailToSearch) {
      user = await User.findOne({ email: emailToSearch });
    }

    if (user) {
      // Link Google ID to existing account
      user.googleId = profile.id;
      if (!user.profileImage) user.profileImage = profile.photos[0].value;
      await user.save();
      return done(null, user);
    }

    // Create new user if neither exists
    const userEmail = profile.emails && profile.emails[0] ? profile.emails[0].value : `${profile.id}@google.com`;
    const newUser = new User({
      googleId: profile.id,
      email: userEmail,
      username: (userEmail.split('@')[0] || 'user') + Math.floor(Math.random() * 1000),
      firstName: profile.name ? profile.name.givenName : 'Google',
      lastName: profile.name ? profile.name.familyName : 'User',
      profileImage: profile.photos && profile.photos[0] ? profile.photos[0].value : undefined,
      role: 'user'
    });

    await newUser.save();
    done(null, newUser);
  } catch (err) {
    console.error('Google Auth Error:', err);
    done(err, null);
  }
}));

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (error) {
    done(error);
  }
});

// Custom flash middleware to replace connect-flash and fix DEP0044 warning
app.use((req, res, next) => {
  req.flash = function(type, msg) {
    if (!this.session) {
      console.warn('req.flash() requires sessions');
      return [];
    }
    
    // Initialize flash storage in session if it doesn't exist
    this.session.flash = this.session.flash || {};
    
    // Case 1: Set a message
    if (type && msg) {
      this.session.flash[type] = this.session.flash[type] || [];
      if (Array.isArray(msg)) {
        this.session.flash[type] = this.session.flash[type].concat(msg);
      } else {
        this.session.flash[type].push(msg);
      }
      return this.session.flash[type].length;
    } 
    // Case 2: Get messages for a specific type
    else if (type) {
      const messages = this.session.flash[type] || [];
      delete this.session.flash[type];
      return messages;
    } 
    // Case 3: Get all messages and clear
    else {
      const allMessages = this.session.flash;
      this.session.flash = {};
      return allMessages;
    }
  };
  next();
});

// Global variables for flash messages and user
app.use((req, res, next) => {
  res.locals.success_msg = req.flash('success_msg');
  res.locals.error_msg = req.flash('error_msg');
  res.locals.warning_msg = req.flash('warning_msg');
  res.locals.messages = {
    success_msg: res.locals.success_msg,
    error_msg: res.locals.error_msg,
    warning_msg: res.locals.warning_msg
  };
  res.locals.user = req.user || null;
  res.locals.isAdmin = req.user && req.user.role === 'admin';
  res.locals.appUrl = process.env.APP_URL || 'http://localhost:3002';
  res.locals.nodeEnv = process.env.NODE_ENV || 'development';
  res.locals.port = process.env.PORT || 3002;
  res.locals.nodeVersion = process.version;
  next();
});

// File upload configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'public/uploads/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml', 'text/csv', 'application/vnd.ms-excel'];
    const ext = path.extname(file.originalname).toLowerCase();
    const allowedExts = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg', '.csv'];
    
    if (allowedMimeTypes.includes(file.mimetype) || allowedExts.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only images and CSV files are allowed.'));
    }
  }
});

// Create uploads directory if it doesn't exist
if (!fs.existsSync('public/uploads')) {
  fs.mkdirSync('public/uploads', { recursive: true });
}

// Routes - see detailed implementations below

// Authentication middleware
function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  req.flash('error_msg', 'Please log in to access this page');
  res.redirect('/login');
}

function ensureAdmin(req, res, next) {
  if (req.isAuthenticated() && req.user.role === 'admin') {
    return next();
  }
  req.flash('error_msg', 'Access denied. Admin privileges required.');
  res.redirect('/');
}


// Validate all :id parameters to ensure they are valid MongoDB ObjectIDs
app.param('id', (req, res, next, id) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    console.warn(`Invalid ObjectId format detected: ${id} on route ${req.originalUrl}`);
    if (req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'))) {
      return res.status(400).json({ success: false, error: 'Invalid resource ID format' });
    }
    req.flash('error_msg', 'The requested resource ID is invalid');
    return res.redirect('/');
  }
  next();
});

// Routes

// Home page
app.get('/', async (req, res) => {
  try {
    let featuredPlants = [];
    let recentPlants = [];
    let stats = {
      totalPlants: 0,
      totalUsers: 0
    };

    // Only try to fetch data if database is connected
    if (req.dbConnected) {
      try {
        // Run all queries in parallel and use .lean() for maximum speed
        const [featured, recent, plantCount, userCount] = await Promise.all([
          Plant.find({ isActive: true, isFeatured: true }).limit(8).lean().exec(),
          Plant.find({ isActive: true }).sort({ createdAt: -1 }).limit(8).lean().exec(),
          Plant.countDocuments({ isActive: true }).exec(),
          User.countDocuments({ role: 'user' }).exec()
        ]);

        featuredPlants = featured || [];
        recentPlants = recent || [];
        stats.totalPlants = plantCount || 0;
        stats.totalUsers = userCount || 0;
      } catch (dbError) {
        console.error('Database query error:', dbError);
        // Continue with empty arrays if database queries fail
      }
    }

    res.render('index', {
      title: 'Sri Lalitamba Nursery & Gardens',
      featuredPlants,
      recentPlants,
      stats,
      dbConnected: req.dbConnected,
      user: req.user,
      page: 'home'
    });
  } catch (error) {
    console.error('Home page error:', error);
    res.render('index', {
      title: 'Sri Lalitamba Nursery & Gardens',
      featuredPlants: [],
      recentPlants: [],
      stats: {
        totalPlants: 0,
        totalUsers: 0
      },
      dbConnected: false,
      user: req.user,
      page: 'home'
    });
  }
});

// Gallery page
app.get('/gallery', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 12;
    const skip = (page - 1) * limit;

    let query = { isActive: true };
    let sortOption = { name: 1 };

    const { category, search, sort } = req.query;

    if (category && category !== 'all' && category.trim() !== '') {
      query.category = { $regex: new RegExp('^' + escapeRegex(category.trim()) + '$', 'i') };
    }

    if (search && search.trim() !== '') {
      query.name = { $regex: escapeRegex(search.trim()), $options: 'i' };
    }

    if (sort) {
      switch (sort) {
        case 'newest': sortOption = { createdAt: -1 }; break;
        case 'name': sortOption = { name: 1 }; break;
        case 'price-low': sortOption = { price: 1 }; break;
        case 'price-high': sortOption = { price: -1 }; break;
      }
    }

    // Use .lean() for faster reads (returns plain JS objects, not Mongoose docs)
    const [plants, totalPlants, dbCategories] = await Promise.all([
      Plant.find(query).sort(sortOption).skip(skip).limit(limit).lean().exec(),
      Plant.countDocuments(query).exec(),
      Plant.distinct('category', { isActive: true }).exec()
    ]);

    const totalPages = Math.ceil((totalPlants || 0) / limit) || 1;

    // Properly build searchParams without 'page' for pagination links
    const queryParams = { ...req.query };
    delete queryParams.page;
    const searchParamsString = Object.keys(queryParams).length > 0 ? '&' + new URLSearchParams(queryParams).toString() : '';

    res.render('gallery', {
      title: 'Plant Gallery - SRI LALITAMBA NURSERY & GARDENS',
      plants: plants || [],
      categories: dbCategories || [],
      dbConnected: req.dbConnected,
      currentCategory: category || 'all',
      currentSearch: search || '',
      currentSort: sort || 'newest',
      currentPage: page,
      hasMore: page < totalPages,
      searchParams: searchParamsString,
      pagination: {
        currentPage: page,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
        nextPage: page + 1,
        prevPage: page - 1,
        totalPlants: totalPlants || 0
      },
      filters: {
        category: category || '',
        search: search || '',
        sort: sort || 'newest',
        categories: dbCategories || [],
        priceRanges: [],
        stockStatus: []
      },
      user: req.user || null,
      messages: {
        success_msg: req.flash('success_msg'),
        error_msg: req.flash('error_msg')
      },
      page: 'gallery'
    });
  } catch (error) {
    console.error('CRITICAL GALLERY ERROR:', error);
    // Render an empty gallery instead of redirecting to avoid infinite loop
    res.render('gallery', {
      title: 'Plant Gallery - SRI LALITAMBA NURSERY & GARDENS',
      plants: [],
      categories: [],
      dbConnected: false,
      currentCategory: 'all',
      currentSearch: '',
      currentSort: 'newest',
      currentPage: 1,
      hasMore: false,
      searchParams: '',
      pagination: { currentPage: 1, totalPages: 1, hasNext: false, hasPrev: false, nextPage: 2, prevPage: 0, totalPlants: 0 },
      filters: { category: '', search: '', sort: 'newest', categories: [], priceRanges: [], stockStatus: [] },
      user: req.user || null,
      messages: {
        success_msg: req.flash('success_msg'),
        error_msg: ['Gallery is temporarily unavailable. Please refresh the page.']
      }
    });
  }
});

// Redirect legacy catalog route
app.get('/catalog', (req, res) => {
  res.redirect('/gallery');
});

// Plant details
app.get('/plant/:slug', async (req, res) => {
  try {
    const plant = await Plant.findOne({ slug: req.params.slug, isActive: true });
    if (!plant) {
      req.flash('error_msg', 'Plant not found');
      return res.redirect('/gallery');
    }

    // Fetch reviews for this plant
    const reviews = await Review.find({ plant: plant._id, isActive: true })
      .populate('user', 'firstName lastName')
      .sort({ createdAt: -1 });

    const totalReviews = reviews.length;
    let avgRating = 0;
    let ratingDistribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };

    if (totalReviews > 0) {
      const sum = reviews.reduce((acc, review) => {
        ratingDistribution[review.rating]++;
        return acc + review.rating;
      }, 0);
      avgRating = (sum / totalReviews).toFixed(1);
    }

    // Check if user has already reviewed or ordered
    let hasUserReviewed = false;
    let userReview = null;
    let hasOrdered = false;

    if (req.user) {
      userReview = reviews.find(r => r.user._id.toString() === req.user._id.toString());
      hasUserReviewed = !!userReview;

      // Check if user has ordered this plant
      const order = await Order.findOne({
        user: req.user._id,
        'items.plant': plant._id,
        status: 'delivered'
      });
      hasOrdered = !!order;
    }

    res.render('plant-details', {
      title: `${plant.name} - SRI LALITAMBA NURSERY & GARDENS`,
      plant,
      reviews,
      totalReviews,
      avgRating,
      ratingDistribution,
      hasUserReviewed,
      userReview,
      hasOrdered,
      user: req.user || null
    });
  } catch (error) {
    console.error('Error loading plant details:', error);
    req.flash('error_msg', 'Error loading plant details');
    res.redirect('/gallery');
  }
});

// User authentication routes
app.get('/register', (req, res) => {
  res.render('register', { title: 'Register - SRI LALITAMBA NURSERY & GARDENS', page: 'register' });
});

app.post('/register', async (req, res) => {
  try {
    // Check database connection
    if (mongoose.connection.readyState !== 1) {
      req.flash('error_msg', 'Database not connected. Please try again later.');
      return res.redirect('/register');
    }

    const { firstName, lastName, email, password, confirmPassword } = req.body;

    // Generate username from email (part before @)
    const username = email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '');

    // Validation
    if (password !== confirmPassword) {
      req.flash('error_msg', 'Passwords do not match');
      return res.redirect('/register');
    }

    if (password.length < 6) {
      req.flash('error_msg', 'Password must be at least 6 characters long');
      return res.redirect('/register');
    }

    // Check if user exists
    const existingUser = await User.findOne({
      $or: [
        { email: email.toLowerCase() },
        { username: username }
      ]
    });
    if (existingUser) {
      req.flash('error_msg', 'Email already registered');
      return res.redirect('/register');
    }

    // Create user
    const user = new User({
      username,
      firstName,
      lastName,
      email: email.toLowerCase(),
      password,
      role: 'user', // Default role
      lastLogin: new Date()
    });

    await user.save();

    req.flash('success_msg', 'Registration successful! Please login.');
    res.redirect('/login');
  } catch (error) {
    console.error('Registration error:', error);
    if (error.code === 11000) {
      req.flash('error_msg', 'Email already registered');
    } else {
      req.flash('error_msg', 'Registration failed. Please try again.');
    }
    res.redirect('/register');
  }
});

app.get('/login', (req, res) => {
  res.render('login', { title: 'Login - SRI LALITAMBA NURSERY & GARDENS', page: 'login' });
});

// Admin login
app.get('/admin/login', (req, res) => {
  if (req.isAuthenticated() && req.user.role === 'admin') {
    return res.redirect('/admin/dashboard');
  }
  res.render('admin/login', { title: 'Admin Login - SRI LALITAMBA NURSERY & GARDENS' });
});

app.post('/admin/login', loginLimiter, (req, res, next) => {
  console.log('Admin Login attempt:', req.body.username);
  // Transfer username field to email for passport strategy compatibility
  if (req.body.username) {
    req.body.email = req.body.username;
  }

  passport.authenticate('local', (err, user, info) => {
    if (err) {
      console.error('Admin Auth Error:', err);
      return next(err);
    }
    if (!user) {
      console.log('Admin Auth Failed:', info.message);
      req.flash('error_msg', info.message || 'Invalid credentials');
      return res.redirect('/admin/login');
    }

    if (user.role !== 'admin') {
      console.log('Access Denied: User role:', user.role);
      req.flash('error_msg', 'Access denied. Only admins can login here.');
      return res.redirect('/admin/login');
    }

    req.logIn(user, (err) => {
      if (err) {
        console.error('Admin logIn error:', err);
        return next(err);
      }

      req.flash('success_msg', 'Admin login successful!');
      res.redirect('/admin/dashboard');
    });
  })(req, res, next);
});

// Google Auth Routes
app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

app.get('/auth/google/callback', passport.authenticate('google', { failureRedirect: '/login' }), (req, res) => {
  req.flash('success_msg', `Welcome back, ${req.user.firstName}! Signed in with Google.`);
  if (req.user.role === 'admin') {
    res.redirect('/admin/dashboard');
  } else {
    res.redirect('/');
  }
});

app.post('/login', loginLimiter, (req, res, next) => {

  passport.authenticate('local', (err, user, info) => {
    if (err) {
      console.error('Passport auth error:', err);
      return next(err);
    }
    if (!user) {

      req.flash('error_msg', info.message || 'Invalid email or password');
      return res.redirect('/login');
    }
    console.log('User authenticated, logging in:', user.email);
    req.logIn(user, (err) => {
      if (err) {
        console.error('req.logIn error:', err);
        return next(err);
      }


      // Role-based redirect
      if (user.role === 'admin') {
        req.flash('success_msg', `Welcome back, Admin ${user.firstName || ''}!`);

        return res.redirect('/admin/dashboard');
      } else {
        req.flash('success_msg', 'Login successful!');

        return res.redirect('/');
      }
    });
  })(req, res, next);
});

app.get('/logout', (req, res) => {
  req.logout((err) => {
    if (err) console.error(err);
    req.flash('success_msg', 'You have been logged out');
    res.redirect('/');
  });
});

app.get('/admin/logout', (req, res) => {
  res.redirect('/logout');
});

// User profile
app.get('/profile', ensureAuthenticated, (req, res) => {
  res.render('profile', { title: 'My Profile - SRI LALITAMBA NURSERY & GARDENS', user: req.user, page: 'profile' });
});

// --- CART & CHECKOUT ROUTES ---

// Get Cart
app.get('/cart', ensureAuthenticated, async (req, res) => {
  try {
    let cart = await Cart.findOne({ user: req.user._id });
    if (!cart) {
      cart = { items: [], totalPrice: 0, totalItems: 0 };
    }
    res.render('cart', {
      title: 'Shopping Cart - SRI LALITAMBA NURSERY',
      cart,
      user: req.user
    });
  } catch (error) {
    console.error(error);
    req.flash('error_msg', 'Error loading cart');
    res.redirect('/');
  }
});

// Add to Cart (API)
app.post('/cart/add', ensureAuthenticated, async (req, res) => {
  try {
    const { plantId, quantity } = req.body;
    const plant = await Plant.findById(plantId);

    if (!plant) {
      return res.status(404).json({ success: false, message: 'Plant not found' });
    }

    if (plant.stock < quantity) {
      return res.status(400).json({ success: false, message: 'Not enough stock available' });
    }

    let cart = await Cart.findOne({ user: req.user._id });
    if (!cart) {
      cart = new Cart({ user: req.user._id, items: [] });
    }

    const itemIndex = cart.items.findIndex(p => p.plant.toString() === plantId);
    if (itemIndex > -1) {
      cart.items[itemIndex].quantity += parseInt(quantity);
    } else {
      cart.items.push({
        plant: plantId,
        quantity: parseInt(quantity),
        price: plant.price,
        name: plant.name,
        image: plant.images[0] || ''
      });
    }

    await cart.save();
    res.json({ success: true, message: 'Added to cart' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
});

// Update Cart (API)
app.post('/cart/update', ensureAuthenticated, async (req, res) => {
  try {
    const { itemId, quantity } = req.body;
    const cart = await Cart.findOne({ user: req.user._id });

    if (!cart) {
      return res.status(404).json({ success: false, message: 'Cart not found' });
    }

    const item = cart.items.id(itemId);
    if (item) {
      if (quantity > 0) {
        item.quantity = quantity;
      } else {
        item.remove();
      }
      await cart.save();
      res.json({ success: true });
    } else {
      res.status(404).json({ success: false, message: 'Item not found' });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
});

// Remove from Cart
app.post('/cart/remove/:id', ensureAuthenticated, async (req, res) => {
  try {
    const cart = await Cart.findOne({ user: req.user._id });
    if (cart) {
      cart.items = cart.items.filter(item => item._id.toString() !== req.params.id);
      await cart.save();
      req.flash('success_msg', 'Item removed from cart');
    }
    res.redirect('/cart');
  } catch (error) {
    console.error(error);
    req.flash('error_msg', 'Error removing item');
    res.redirect('/cart');
  }
});

// Checkout Page
app.get('/checkout', ensureAuthenticated, async (req, res) => {
  try {
    const cart = await Cart.findOne({ user: req.user._id });
    if (!cart || cart.items.length === 0) {
      req.flash('error_msg', 'Your cart is empty');
      return res.redirect('/cart');
    }
    res.render('checkout', {
      title: 'Checkout - SRI LALITAMBA NURSERY',
      cart,
      user: req.user
    });
  } catch (error) {
    console.error(error);
    req.flash('error_msg', 'Error loading checkout');
    res.redirect('/cart');
  }
});

// Process Checkout
app.post('/checkout', ensureAuthenticated, async (req, res) => {
  try {
    const { fullName, phone, address, city, state, zipCode, paymentMethod } = req.body;
    const cart = await Cart.findOne({ user: req.user._id });

    if (!cart || cart.items.length === 0) {
      req.flash('error_msg', 'Your cart is empty');
      return res.redirect('/cart');
    }

    // Verify stock again
    for (let item of cart.items) {
      const plant = await Plant.findById(item.plant);
      if (!plant || plant.stock < item.quantity) {
        req.flash('error_msg', `Sorry, ${item.name} is out of stock or requested quantity not available.`);
        return res.redirect('/cart');
      }
    }

    // Create Order
    const order = new Order({
      user: req.user._id,
      items: cart.items,
      totalAmount: cart.totalPrice,
      shippingAddress: { fullName, phone, address, city, state, zipCode },
      paymentMethod: 'COD',
      paymentStatus: 'pending',
      status: 'pending'
    });

    await order.save();

    // Deduct Stock
    for (let item of cart.items) {
      await Plant.findByIdAndUpdate(item.plant, { $inc: { stock: -item.quantity } });
    }

    // Clear Cart
    cart.items = [];
    cart.totalItems = 0;
    cart.totalPrice = 0;
    await cart.save();

    req.flash('success_msg', 'Order placed successfully!');
    res.redirect('/orders');
  } catch (error) {
    console.error(error);
    req.flash('error_msg', 'Error processing order');
    res.redirect('/checkout');
  }
});

// User Orders
app.get('/orders', ensureAuthenticated, async (req, res) => {
  try {
    const orders = await Order.find({ user: req.user._id }).sort({ createdAt: -1 });
    res.render('orders', {
      title: 'My Orders - SRI LALITAMBA NURSERY',
      orders,
      user: req.user
    });
  } catch (error) {
    console.error(error);
    req.flash('error_msg', 'Error loading orders');
    res.redirect('/');
  }
});

// Create Order Page (Public)
app.get('/orders/create', ensureAuthenticated, async (req, res) => {
  try {
    const plants = await Plant.find({ isActive: true }).select('name price stock');
    res.render('orders/create', {
      title: 'Create New Order - SRI LALITAMBA NURSERY',
      user: req.user,
      plants,
      messages: {
        error_msg: req.flash('error_msg'),
        success_msg: req.flash('success_msg')
      }
    });
  } catch (error) {
    console.error(error);
    req.flash('error_msg', 'Error loading order creation page');
    res.redirect('/orders');
  }
});

// Submit Order (Public)
app.post('/orders/create', ensureAuthenticated, async (req, res) => {
  try {
    const { items, shippingAddress, notes, deliveryDeadline } = req.body;
    
    // Parse items if it's a string
    let parsedItems = typeof items === 'string' ? JSON.parse(items) : items;

    if (!parsedItems || parsedItems.length === 0) {
      req.flash('error_msg', 'Please add at least one item to your order');
      return res.redirect('/orders/create');
    }

    // Process items
    const orderItems = parsedItems.map(item => ({
      plant: item.plantId && item.plantId !== '' ? item.plantId : null,
      name: item.name,
      quantity: parseInt(item.quantity) || 1,
      packetSize: item.packetSize || '',
      size: item.size || 'medium',
      source: item.plantId ? 'gallery' : 'custom',
      price: 0
    }));

    // Construct shipping address with defaults for missing fields
    const finalShippingAddress = {
      fullName: (shippingAddress && shippingAddress.fullName) || (req.user.firstName + ' ' + req.user.lastName),
      phone: (shippingAddress && shippingAddress.phone) || (req.user.phone || 'N/A'),
      address: (shippingAddress && shippingAddress.address) || (req.user.address || 'N/A'),
      city: (shippingAddress && shippingAddress.city) || 'N/A',
      state: (shippingAddress && shippingAddress.state) || 'N/A',
      zipCode: (shippingAddress && shippingAddress.zipCode) || 'N/A'
    };

    // Create Order
    const order = new Order({
      user: req.user._id,
      items: orderItems,
      totalAmount: 0,
      shippingAddress: finalShippingAddress,
      notes: notes || '',
      status: 'pending',
      deliveryDeadline: deliveryDeadline ? new Date(deliveryDeadline) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    });

    await order.save();
    
    req.flash('success_msg', 'Order placed successfully! Admin will review it.');
    res.redirect('/orders');
  } catch (error) {
    console.error('Order creation error:', error);
    req.flash('error_msg', 'Error placing order: ' + error.message);
    res.redirect('/orders/create');
  }
});

// Submit Direct Order from Plant Details Page
app.post('/orders/create-direct', ensureAuthenticated, async (req, res) => {
  try {
    const { plantId, quantity, size, address } = req.body;
    
    if (!plantId || !quantity || !address) {
      req.flash('error_msg', 'Please fill in all required fields');
      return res.redirect('back');
    }

    const plant = await Plant.findById(plantId);
    if (!plant) {
      req.flash('error_msg', 'Plant not found');
      return res.redirect('/gallery');
    }

    const orderItems = [{
      plant: plant._id,
      name: plant.name,
      quantity: parseInt(quantity) || 1,
      size: size || 'medium',
      source: 'gallery',
      price: plant.price || 0
    }];

    const finalShippingAddress = {
      fullName: req.user.firstName + ' ' + req.user.lastName,
      phone: req.user.phone || 'N/A',
      address: address.trim(),
      city: 'N/A',
      state: 'N/A',
      zipCode: 'N/A'
    };

    const order = new Order({
      user: req.user._id,
      items: orderItems,
      totalAmount: (plant.price || 0) * (parseInt(quantity) || 1),
      shippingAddress: finalShippingAddress,
      notes: 'Direct order from catalog',
      status: 'pending',
      deliveryDeadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    });

    await order.save();
    
    // Log Audit
    await logAudit('DIRECT_ORDER_CREATE', 'Orders', `User placed direct order for ${plant.name}`, req.user, 'medium');

    req.flash('success_msg', 'Order placed successfully! Admin will contact you soon.');
    res.redirect('/orders');
  } catch (error) {
    console.error('Direct Order Error:', error);
    req.flash('error_msg', 'Error placing order: ' + error.message);
    res.redirect('back');
  }
});

// --- ADMIN ROUTES CONSOLIDATED ---

// Audit Logs
app.get('/admin/audit-logs', ensureAuthenticated, ensureAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 20;
    const skip = (page - 1) * limit;

    const [logs, totalLogs] = await Promise.all([
      AuditLog.find()
        .populate('performedBy', 'firstName lastName email')
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      AuditLog.countDocuments()
    ]);

    const totalPages = Math.ceil(totalLogs / limit);

    res.render('admin/audit-logs', {
      title: 'Security Audit Logs - SRI LALITAMBA NURSERY',
      logs,
      currentPage: page,
      totalPages,
      page: 'audit-logs'
    });
  } catch (error) {
    console.error('Audit Log Route Error:', error);
    req.flash('error_msg', 'Error loading audit logs');
    res.redirect('/admin/dashboard');
  }
});

app.get('/admin/dashboard', ensureAuthenticated, ensureAdmin, async (req, res) => {
  try {
    let stats = {
      totalPlants: 0,
      totalOrders: 0,
      totalUsers: 0,
      totalRevenue: 0,
      todayOrders: 0,
      activeUsers: 0,
      stockAlerts: 0
    };

    let billingStats = {
      paid: 0,
      pending: 0,
      overdue: 0
    };

    let recentOrders = [];
    let recentBills = [];
    let lowStockPlants = [];
    let categoryStats = [];
    let stockStats = [];

    // Only fetch data if database is connected
    if (req.dbConnected) {
      try {
        // Basic stats
        stats.totalPlants = await Plant.countDocuments({ isActive: true });
        stats.totalOrders = await Order.countDocuments();
        stats.totalUsers = await User.countDocuments({ role: 'user' });

        // Revenue calculation
        const revenueResult = await Bill.aggregate([
          { $group: { _id: null, total: { $sum: '$totalAmount' } } }
        ]);
        stats.totalRevenue = revenueResult[0]?.total || 0;

        // Today's stats
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        stats.todayOrders = await Order.countDocuments({
          createdAt: { $gte: today, $lt: tomorrow }
        });

        // Active users (users who logged in in last 30 days)
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        stats.activeUsers = await User.countDocuments({
          lastLogin: { $gte: thirtyDaysAgo }
        });

        // Stock alerts (plants with low stock)
        stats.stockAlerts = await Plant.countDocuments({
          isActive: true,
          stock: { $lte: 5, $gt: 0 }
        });

        // Billing stats
        billingStats.paid = await Bill.countDocuments({ status: 'paid' });
        billingStats.pending = await Bill.countDocuments({ status: 'pending' });
        billingStats.overdue = await Bill.countDocuments({ status: 'overdue' });

        // Recent data
        recentOrders = await Order.find()
          .populate('user', 'firstName email')
          .sort({ createdAt: -1 })
          .limit(5);

        recentBills = await Bill.find()
          .sort({ createdAt: -1 })
          .limit(5);

        lowStockPlants = await Plant.find({
          isActive: true,
          stock: { $lte: 5, $gt: 0 }
        }).limit(5);

        // Category stats
        categoryStats = await Plant.aggregate([
          { $match: { isActive: true } },
          { $group: { _id: '$category', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 5 }
        ]);

        // Stock stats for chart
        stockStats = await Plant.aggregate([
          { $match: { isActive: true } },
          { $group: { _id: '$category', totalStock: { $sum: '$stock' } } },
          { $sort: { totalStock: -1 } },
          { $limit: 8 }
        ]);

      } catch (dbError) {
        console.error('Dashboard database error:', dbError);
        // Continue with default values if database queries fail
      }
    }

    res.render('admin/dashboard', {
      title: 'Dashboard - SRI LALITAMBA NURSERY & GARDENS',
      stats,
      billingStats,
      recentOrders,
      recentBills,
      lowStockPlants,
      categoryStats,
      stockStats: stockStats || [],
      dbConnected: req.dbConnected,
      user: req.user,
      page: 'dashboard'
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.render('admin/dashboard', {
      title: 'Dashboard - SRI LALITAMBA NURSERY & GARDENS',
      stats: {
        totalPlants: 0,
        totalOrders: 0,
        totalUsers: 0,
        totalRevenue: 0,
        todayOrders: 0,
        activeUsers: 0,
        stockAlerts: 0
      },
      billingStats: { paid: 0, pending: 0, overdue: 0 },
      recentOrders: [],
      recentBills: [],
      lowStockPlants: [],
      categoryStats: [],
      stockStats: [],
      dbConnected: false,
      user: req.user,
      page: 'dashboard'
    });
  }
});

// Plants Management
app.get('/admin/plants', ensureAuthenticated, ensureAdmin, async (req, res) => {
  try {
    const plants = await Plant.find().sort({ createdAt: -1 });
    res.render('admin/plants', {
      title: 'Manage Plants - SRI LALITAMBA NURSERY & GARDENS',
      plants,
      page: 'plants'
    });
  } catch (error) {
    console.error(error);
    req.flash('error_msg', 'Error loading plants');
    res.redirect('/admin/dashboard');
  }
});

app.get('/admin/plants/add', ensureAuthenticated, ensureAdmin, (req, res) => {
  res.render('admin/add-edit-plant', {
    title: 'Add New Plant - SRI LALITAMBA NURSERY & GARDENS',
    plant: null,
    page: 'plants'
  });
});

app.post('/admin/plants/add', ensureAuthenticated, ensureAdmin, (req, res, next) => {
  upload.array('imageFiles', 10)(req, res, function (err) {
    if (err instanceof multer.MulterError) {
      // A Multer error occurred when uploading.
      req.flash('error_msg', `Upload error: ${err.message}`);
      return res.redirect('/admin/plants/add');
    } else if (err) {
      // An unknown error occurred when uploading.
      req.flash('error_msg', `Error: ${err.message}`);
      return res.redirect('/admin/plants/add');
    }
    // Everything went fine.
    next();
  });
}, async (req, res) => {
  try {
    const { name, description, category, imageUrl, isActive } = req.body;

    // Validation
    if (!name || !description || !category) {
      const wantsJson = req.xhr || (req.headers && req.headers.accept && req.headers.accept.includes('json'));
      if (wantsJson) {
        return res.status(400).json({ success: false, message: 'Please fill in all required fields' });
      }
      req.flash('error_msg', 'Please fill in all required fields');
      return res.redirect('/admin/plants/add');
    }

    let itemImages = [];

    // Add external URL if provided
    if (imageUrl && imageUrl.trim() !== '') {
      itemImages.push({ url: imageUrl.trim() });
    }

    // Add local files if uploaded
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        try {
          const buffer = fs.readFileSync(file.path);
          await ImageService.saveImage(file.filename, buffer, file.mimetype);
          itemImages.push({ url: '/images/' + file.filename });
          // Clean up temporary file
          fs.unlinkSync(file.path);
        } catch (uploadErr) {
          console.error('Error saving image to DB:', uploadErr);
          // Fallback to local if DB fails
          itemImages.push({ url: '/uploads/' + file.filename });
        }
      }
    }

    const newPlant = new Plant({
      name: name.trim(),
      description: description.trim(),
      category: category.trim(),
      isActive: isActive === 'on' || isActive === 'true' || isActive === true,
      images: itemImages
    });

    await newPlant.save();

    const wantsJson = req.xhr || (req.headers && req.headers.accept && req.headers.accept.includes('json'));
    if (wantsJson) {
      return res.json({ success: true, message: 'Item added to gallery successfully' });
    }

    req.flash('success_msg', 'Item added to gallery successfully');
    res.redirect('/admin/plants');
  } catch (error) {
    console.error('Error adding gallery item:', error);
    const wantsJson = req.xhr || (req.headers && req.headers.accept && req.headers.accept.includes('json'));
    if (wantsJson) {
      return res.status(500).json({ success: false, message: error.message || 'Error adding gallery item' });
    }
    req.flash('error_msg', error.message || 'Error adding gallery item');
    res.redirect('/admin/plants/add');
  }
});

app.get('/admin/plants/edit/:id', ensureAuthenticated, ensureAdmin, async (req, res) => {
  try {
    const plant = await Plant.findById(req.params.id);
    res.render('admin/add-edit-plant', {
      title: 'Edit Plant - SRI LALITAMBA NURSERY & GARDENS',
      plant,
      page: 'plants'
    });
  } catch (error) {
    req.flash('error_msg', 'Plant not found');
    res.redirect('/admin/plants');
  }
});

app.post('/admin/plants/edit/:id', ensureAuthenticated, ensureAdmin, upload.array('imageFiles', 10), async (req, res) => {
  try {
    const { name, description, category, imageUrl, isActive } = req.body;

    // Validation
    if (!name || !description || !category) {
      req.flash('error_msg', 'Please fill in all required fields');
      return res.redirect(`/admin/plants/edit/${req.params.id}`);
    }

    try {
      const plant = await Plant.findById(req.params.id);

      if (!plant) {
        req.flash('error_msg', 'Gallery item not found');
        return res.redirect('/admin/plants');
      }

      plant.name = name.trim();
      plant.description = description.trim();
      plant.category = category.trim();
      plant.isActive = isActive === 'on' || isActive === 'true' || isActive === true;

      // Build images array based on provided inputs (URL or uploaded files)
      let itemImages = [];
      if (imageUrl) {
        itemImages.push({ url: imageUrl });
      }
      if (req.files && req.files.length > 0) {
        for (const file of req.files) {
          try {
            const buffer = fs.readFileSync(file.path);
            await ImageService.saveImage(file.filename, buffer, file.mimetype);
            itemImages.push({ url: '/images/' + file.filename });
            // Clean up temporary file
            fs.unlinkSync(file.path);
          } catch (uploadErr) {
            console.error('Error saving image to DB:', uploadErr);
            itemImages.push({ url: '/uploads/' + file.filename });
          }
        }
      }

      // Only update images if new ones are provided
      if (itemImages.length > 0) {
        plant.images = itemImages;
      }

      await plant.save();

      req.flash('success_msg', 'Gallery item updated successfully');
      res.redirect('/admin/plants');
    } catch (err) {
      throw err;
    }
  } catch (error) {
    console.error('Error updating gallery item:', error);
    req.flash('error_msg', error.message || 'Error updating item');
    res.redirect(`/admin/plants/edit/${req.params.id}`);
  }
});

app.post('/admin/plants/delete-multiple', ensureAuthenticated, ensureAdmin, async (req, res) => {
  try {
    const { selectedIds } = req.body;
    if (!selectedIds) {
      req.flash('error_msg', 'No items selected for deletion');
      return res.redirect('/admin/plants');
    }

    const ids = Array.isArray(selectedIds) ? selectedIds : [selectedIds];

    await Plant.deleteMany({ _id: { $in: ids } });
    
    await logAudit('DELETE_MULTIPLE', 'PLANTS', `Bulk deleted ${ids.length} plants`, req.user, 'medium');

    req.flash('success_msg', `${ids.length} item(s) deleted successfully`);
    res.redirect('/admin/plants');
  } catch (error) {
    console.error('Error deleting multiple plants:', error);
    req.flash('error_msg', 'Error deleting items');
    res.redirect('/admin/plants');
  }
});

// Bulk Export Plants to CSV
app.get('/admin/plants/export-csv', ensureAuthenticated, ensureAdmin, async (req, res) => {
  try {
    const plants = await Plant.find().lean();
    const fields = ['name', 'category', 'price', 'description', 'isActive', 'tags'];
    const opts = { fields };
    const parser = new Parser(opts);
    const csvData = parser.parse(plants);
    
    res.header('Content-Type', 'text/csv');
    res.attachment(`nursery-plants-export-${Date.now()}.csv`);
    
    await logAudit('EXPORT', 'PLANTS', 'Exported full plant inventory to CSV', req.user, 'low');
    return res.send(csvData);
  } catch (err) {
    console.error('Error exporting CSV:', err);
    req.flash('error_msg', 'Error exporting data');
    res.redirect('/admin/plants');
  }
});

// Bulk Import Plants from CSV
app.post('/admin/plants/import-csv', ensureAuthenticated, ensureAdmin, upload.single('csvFile'), async (req, res) => {
  try {
    if (!req.file) {
      req.flash('error_msg', 'Please upload a CSV file');
      return res.redirect('/admin/plants');
    }

    const results = [];
    fs.createReadStream(req.file.path)
      .pipe(csv())
      .on('data', (data) => results.push(data))
      .on('end', async () => {
        try {
          let importCount = 0;
          for (const row of results) {
            // Robust validation and sanitization
            const name = row.name ? row.name.trim() : '';
            if (name !== '') {
              // Clean price: remove currency symbols, commas, spaces
              let priceStr = row.price ? row.price.toString().replace(/[^0-9.]/g, '') : '0';
              const price = parseFloat(priceStr) || 0;
              
              // Clean isActive: handle various string inputs
              const isActiveStr = row.isActive ? row.isActive.toString().toUpperCase().trim() : 'TRUE';
              const isActive = ['TRUE', '1', 'YES', 'LIVE', 'ACTIVE'].includes(isActiveStr);

              const newPlant = new Plant({
                name: name,
                category: row.category ? row.category.trim() : 'Uncategorized',
                price: price,
                description: row.description ? row.description.trim() : '',
                isActive: isActive,
                tags: row.tags ? row.tags.split(',').map(t => t.trim()).filter(t => t !== '') : []
              });
              await newPlant.save();
              importCount++;
            }
          }
          
          // Cleanup the uploaded temporary file
          if (fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
          }
          
          await logAudit('IMPORT', 'PLANTS', `Bulk imported ${importCount} plants via CSV`, req.user, 'medium');
          req.flash('success_msg', `Successfully imported ${importCount} botanical records`);
          res.redirect('/admin/plants');
        } catch (err) {
          console.error('Error processing CSV data rows:', err);
          req.flash('error_msg', 'Error processing data: ' + err.message);
          res.redirect('/admin/plants');
        }
      })
      .on('error', (err) => {
        console.error('Error reading CSV file:', err);
        req.flash('error_msg', 'Error reading file: ' + err.message);
        res.redirect('/admin/plants');
      });
  } catch (error) {
    console.error('Fatal error in import-csv route:', error);
    req.flash('error_msg', 'Internal server error during import');
    res.redirect('/admin/plants');
  }
});

app.post('/admin/plants/delete/:id', ensureAuthenticated, ensureAdmin, async (req, res) => {
  try {
    const plant = await Plant.findById(req.params.id);
    if (plant) {
      await logAudit('DELETE', 'PLANTS', `Deleted plant: ${plant.name}`, req.user, 'medium', { plantId: plant._id });
    }
    await Plant.findByIdAndDelete(req.params.id);
    req.flash('success_msg', 'Plant deleted successfully');
    res.redirect('/admin/plants');
  } catch (error) {
    req.flash('error_msg', 'Error deleting plant');
    res.redirect('/admin/plants');
  }
});

// Orders Management
app.get('/admin/orders', ensureAuthenticated, ensureAdmin, async (req, res) => {
  try {
    const orders = await Order.find()
      .populate('user', 'firstName lastName email')
      .sort({ createdAt: -1 });
    res.render('admin/orders', {
      title: 'Manage Orders - SRI LALITAMBA NURSERY & GARDENS',
      orders,
      page: 'orders'
    });
  } catch (error) {
    console.error(error);
    req.flash('error_msg', 'Error loading orders');
    res.redirect('/admin/dashboard');
  }
});

app.get('/admin/orders/create', ensureAuthenticated, ensureAdmin, async (req, res) => {
  try {
    // Get all plants (not just active ones, to show available plants)
    const plants = await Plant.find({}).sort({ name: 1 }).lean();
    
    // Get registered users (optional for selection)
    const users = await User.find({ role: 'user' }).sort({ firstName: 1 }).lean();
    
    const templateData = {
      title: 'Create Order - SRI LALITAMBA NURSERY & GARDENS',
      users: users,
      plants: plants,
      page: 'orders',
      messages: {
        success_msg: req.flash('success_msg'),
        error_msg: req.flash('error_msg')
      }
    };
    
    // Use the original template
    res.render('admin/orders/create', templateData);
    
  } catch (error) {
    console.error('Error loading order creation form:', error);
    req.flash('error_msg', 'Error loading order creation form: ' + error.message);
    res.redirect('/admin/orders');
  }
});

app.get('/admin/orders/:id/edit', ensureAuthenticated, ensureAdmin, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id).populate('user');
    if (!order) {
      req.flash('error_msg', 'Order not found');
      return res.redirect('/admin/orders');
    }
    const plants = await Plant.find({}).sort({ name: 1 }).lean();
    const users = await User.find({ role: 'user' }).sort({ firstName: 1 }).lean();
    
    res.render('admin/orders/create', {
      title: 'Edit Order - SRI LALITAMBA NURSERY & GARDENS',
      order,
      users,
      plants,
      page: 'orders',
      messages: {
        success_msg: req.flash('success_msg'),
        error_msg: req.flash('error_msg')
      }
    });
  } catch (error) {
    console.error('Error loading order edit form:', error);
    req.flash('error_msg', 'Error loading order edit form');
    res.redirect('/admin/orders');
  }
});

app.post('/admin/orders/edit/:id', ensureAuthenticated, ensureAdmin, async (req, res) => {
  try {
    const { items, shippingAddress, paymentMethod, status, deliveryDeadline, notes } = req.body;
    
    let parsedItems = typeof items === 'string' ? JSON.parse(items) : items;
    if (!parsedItems || parsedItems.length === 0) {
      req.flash('error_msg', 'Please add at least one item');
      return res.redirect(`/admin/orders/${req.params.id}/edit`);
    }

    const orderItems = parsedItems.map((item, index) => ({
      plant: (item.plantId && item.plantId !== '') ? item.plantId : null,
      name: item.name,
      quantity: parseInt(item.quantity) || 1,
      packetSize: item.packetSize || item.size,
      size: item.size || 'medium',
      source: item.plantId ? 'gallery' : 'custom',
      image: item.image || '/images/placeholder-plant.jpg',
      price: 0,
      sno: item.sno || `SN${new Date().getFullYear()}${String(index + 1).padStart(4, '0')}${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`
    }));

    let finalShippingAddress;
    if (typeof shippingAddress === 'string') {
      try {
        finalShippingAddress = JSON.parse(shippingAddress);
      } catch (e) {
        finalShippingAddress = {};
      }
    } else {
      finalShippingAddress = { ...shippingAddress };
    }

    await Order.findByIdAndUpdate(req.params.id, {
      items: orderItems,
      shippingAddress: finalShippingAddress,
      paymentMethod,
      status,
      deliveryDeadline: new Date(deliveryDeadline),
      notes: notes || ''
    });

    req.flash('success_msg', 'Order updated successfully!');
    res.redirect('/admin/orders');
  } catch (error) {
    console.error('Order update error:', error);
    req.flash('error_msg', 'Error updating order: ' + error.message);
    res.redirect(`/admin/orders/${req.params.id}/edit`);
  }
});

app.post('/admin/orders/create', ensureAuthenticated, ensureAdmin, async (req, res) => {
  try {
    const { 
      userId, 
      customerName, 
      customerPhone, 
      items, 
      shippingAddress, 
      paymentMethod, 
      status, 
      deliveryDeadline 
    } = req.body;

    // Parse items from JSON string
    let parsedItems = typeof items === 'string' ? JSON.parse(items) : items;

    if (!parsedItems || parsedItems.length === 0) {
      req.flash('error_msg', 'Please add at least one item to the order');
      return res.redirect('/admin/orders/create');
    }

    // Process order items
    const orderItems = parsedItems.map((item, index) => {
      const orderItem = {
        plant: (item.plantId && item.plantId !== '') ? item.plantId : null,
        name: item.name,
        quantity: parseInt(item.quantity) || 1,
        packetSize: item.packetSize || '',
        size: item.size || 'medium',
        source: item.plantId ? 'gallery' : 'custom',
        image: item.image || '/images/placeholder-plant.jpg',
        price: 0
      };

      // Generate SNO if not provided
      if (!item.sno) {
        const year = new Date().getFullYear();
        const sequence = String(index + 1).padStart(4, '0');
        const randomSuffix = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
        orderItem.sno = `SN${year}${sequence}${randomSuffix}`;
      } else {
        orderItem.sno = item.sno;
      }

      return orderItem;
    });

    // Construct final shipping address
    let finalShippingAddress;
    if (typeof shippingAddress === 'string') {
      try {
        finalShippingAddress = JSON.parse(shippingAddress);
      } catch (e) {
        finalShippingAddress = {};
      }
    } else {
      finalShippingAddress = { ...shippingAddress };
    }

    // Ensure all required fields are present
    if (!finalShippingAddress.fullName && customerName) {
      finalShippingAddress.fullName = customerName;
    }
    if (!finalShippingAddress.phone && customerPhone) {
      finalShippingAddress.phone = customerPhone;
    }
    
    // Fallbacks for required fields to avoid validation error
    finalShippingAddress.fullName = finalShippingAddress.fullName || 'Guest Customer';
    finalShippingAddress.phone = finalShippingAddress.phone || 'N/A';
    finalShippingAddress.address = finalShippingAddress.address || 'N/A';
    finalShippingAddress.city = finalShippingAddress.city || 'N/A';
    finalShippingAddress.state = finalShippingAddress.state || 'N/A';
    finalShippingAddress.zipCode = finalShippingAddress.zipCode || 'N/A';

    // Create order object
    const orderData = {
      items: orderItems,
      totalAmount: 0,
      shippingAddress: finalShippingAddress,
      paymentMethod: paymentMethod || 'cod',
      status: status || 'pending',
      notes: req.body.notes || '',
      deliveryDeadline: deliveryDeadline ? new Date(deliveryDeadline) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    };

    // Link to user if existing customer selected
    if (userId && userId !== '') {
      orderData.user = userId;
    }

    const newOrder = new Order(orderData);
    await newOrder.save();

    // If status is not 'pending' or 'cancelled', create a bill
    if (newOrder.status !== 'pending' && newOrder.status !== 'cancelled') {
      // Map order items to bill items
      const billItems = newOrder.items.map(item => ({
        plantId: item.plant || undefined,
        plantName: item.name,
        packetSize: item.packetSize || item.size,
        quantity: item.quantity,
        unitPrice: item.price || 0,
        lineTotal: (item.price || 0) * item.quantity,
        description: `${item.name} (${item.packetSize || item.size})`
      }));

      // Calculate totals
      const subTotal = billItems.reduce((sum, item) => sum + item.lineTotal, 0);
      
      // Create new bill
      const newBill = new Bill({
        customerName: newOrder.shippingAddress.fullName,
        customerPhone: newOrder.shippingAddress.phone,
        items: billItems,
        subTotal: subTotal,
        totalAmount: subTotal,
        status: 'pending',
        paymentMethod: newOrder.paymentMethod === 'cod' ? 'cash' : 'other',
        createdBy: req.user._id,
        billDate: new Date(),
        notes: `Generated from Order #${newOrder._id.toString().slice(-6)}`
      });

      await newBill.save();
      req.flash('success_msg', 'Order created and Bill generated successfully!');
    } else {
      req.flash('success_msg', 'Order created successfully!');
    }
    
    res.redirect('/admin/orders');

  } catch (error) {
    console.error('Admin Order Creation Error:', error);
    req.flash('error_msg', 'Error creating order: ' + error.message);
    res.redirect('/admin/orders/create');
  }
});

app.post('/admin/orders/update-status/:id', ensureAuthenticated, ensureAdmin, async (req, res) => {
  try {
    const { status } = req.body;
    const order = await Order.findById(req.params.id);
    
    if (!order) {
      req.flash('error_msg', 'Order not found');
      return res.redirect('/admin/orders');
    }

    // Update order status
    order.status = status;
    await order.save();

    // If status is 'delivered', create a bill if one doesn't exist
    if (status === 'delivered') {
      const existingBill = await Bill.findOne({ orderId: order._id });
      
      if (!existingBill) {
        // Map order items to bill items
        const billItems = order.items.map(item => ({
          plantId: item.plant || undefined,
          plantName: item.name,
          packetSize: item.packetSize || item.size || '1 unit',
          quantity: item.quantity,
          unitPrice: item.price || 0,
          lineTotal: (item.price || 0) * item.quantity,
          description: `${item.name} (${item.packetSize || item.size || '1 unit'})`
        }));

        // Calculate totals
        const totalAmount = order.totalAmount || billItems.reduce((sum, item) => sum + item.lineTotal, 0);
        
        // Create new bill
        const newBill = new Bill({
          customerName: order.shippingAddress.fullName,
          customerPhone: order.shippingAddress.phone,
          items: billItems,
          subTotal: totalAmount,
          totalAmount: totalAmount,
          paidAmount: 0,
          balanceAmount: totalAmount,
          status: 'pending',
          paymentMethod: order.paymentMethod === 'cod' ? 'cash' : 'other',
          createdBy: req.user._id,
          billDate: new Date(),
          orderId: order._id,
          notes: `Generated from Order #${order._id.toString().slice(-6)}`
        });

        await newBill.save();
        req.flash('success_msg', 'Order delivered and Bill generated successfully!');
      } else {
        req.flash('success_msg', 'Order delivered');
      }
    } else {
      req.flash('success_msg', `Order status updated to ${status}`);
    }

    res.redirect('/admin/orders');
  } catch (error) {
    console.error('Order update error:', error);
    req.flash('error_msg', 'Error updating order: ' + error.message);
    res.redirect('/admin/orders');
  }
});

// Get Order Details API
app.get('/api/admin/orders/:id', ensureAuthenticated, ensureAdmin, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id).populate('user', 'firstName lastName email');
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }
    res.json({ success: true, order });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get Bill Details API
app.get('/api/admin/bills/:id', ensureAuthenticated, ensureAdmin, async (req, res) => {
  try {
    const bill = await Bill.findById(req.params.id);
    if (!bill) {
      return res.status(404).json({ success: false, message: 'Bill not found' });
    }
    res.json({ success: true, bill });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Update Bill Status API
app.post('/admin/bills/update-status/:id', ensureAuthenticated, ensureAdmin, async (req, res) => {
  try {
    const { status } = req.body;
    await Bill.findByIdAndUpdate(req.params.id, { status });
    req.flash('success_msg', 'Bill status updated successfully');
    res.redirect('/admin/bills');
  } catch (error) {
    req.flash('error_msg', 'Error updating bill status');
    res.redirect('/admin/bills');
  }
});

// Add Payment (Installment) to Bill
app.post('/admin/bills/:id/payments', ensureAuthenticated, ensureAdmin, async (req, res) => {
  try {
    const { amount, mode, reference, notes, isFarmerBill, date } = req.body;
    console.log(`Processing payment for bill ${req.params.id}:`, { amount, mode, date });

    const bill = await Bill.findById(req.params.id);
    
    if (!bill) {
      console.error(`Bill not found: ${req.params.id}`);
      return res.status(404).json({ success: false, message: 'Bill not found' });
    }

    const paymentAmount = Number(amount);
    if (isNaN(paymentAmount) || paymentAmount <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid payment amount' });
    }

    // Initialize arrays and numbers if they don't exist (for older records)
    if (!Array.isArray(bill.payments)) {
      bill.payments = [];
    }
    if (typeof bill.paidAmount !== 'number') {
      bill.paidAmount = 0;
    }
    if (typeof bill.totalAmount !== 'number') {
      // Fallback: calculate totalAmount if missing
      bill.totalAmount = bill.items.reduce((sum, item) => sum + (item.lineTotal || 0), 0);
    }
    if (typeof bill.subTotal !== 'number') {
      bill.subTotal = bill.totalAmount;
    }

    // Add payment to array
    bill.payments.push({
      amount: paymentAmount,
      mode: mode || 'cash',
      reference: reference || '',
      notes: notes || '',
      date: date ? new Date(date) : new Date()
    });

    // Update totals
    bill.paidAmount = (bill.paidAmount || 0) + paymentAmount;
    bill.balanceAmount = Math.max(0, bill.totalAmount - bill.paidAmount);

    // Ensure numeric values before saving
    if (isNaN(bill.paidAmount)) bill.paidAmount = paymentAmount;
    if (isNaN(bill.balanceAmount)) bill.balanceAmount = Math.max(0, bill.totalAmount - bill.paidAmount);

    // Update status based on balance
    if (bill.balanceAmount <= 0) {
      bill.status = 'paid';
    } else {
      bill.status = 'partially_paid';
    }

    if (isFarmerBill !== undefined) {
      bill.isFarmerBill = isFarmerBill === 'true';
    }

    await bill.save();
    console.log(`Payment recorded for bill ${bill.billNumber}. New balance: ${bill.balanceAmount}`);
    
    res.json({ 
      success: true, 
      message: 'Payment recorded successfully',
      paidAmount: bill.paidAmount,
      balanceAmount: bill.balanceAmount,
      status: bill.status
    });
  } catch (error) {
    console.error('Payment error:', error);
    res.status(500).json({ success: false, message: 'Server error: ' + error.message });
  }
});

// Delete Order
app.delete('/admin/orders/:id', ensureAuthenticated, ensureAdmin, async (req, res) => {
  try {
    await Order.findByIdAndDelete(req.params.id);
    req.flash('success_msg', 'Order deleted successfully');
    res.redirect('/admin/orders');
  } catch (error) {
    req.flash('error_msg', 'Error deleting order');
    res.redirect('/admin/orders');
  }
});

// Delete Bill
app.post('/admin/bills/delete/:id', ensureAuthenticated, ensureAdmin, async (req, res) => {
  try {
    const bill = await Bill.findById(req.params.id);
    if (bill) {
      await logAudit('DELETE', 'BILLS', `Deleted bill: ${bill.billNumber} (₹${bill.totalAmount})`, req.user, 'high', { billId: bill._id });
    }
    await Bill.findByIdAndDelete(req.params.id);
    req.flash('success_msg', 'Bill deleted successfully');
    res.redirect('/admin/bills');
  } catch (error) {
    console.error('Error deleting bill:', error);
    req.flash('error_msg', 'Error deleting bill');
    res.redirect('/admin/bills');
  }
});

// Print Order
app.get('/admin/orders/:id/print', ensureAuthenticated, ensureAdmin, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id).populate('user', 'firstName lastName email');
    if (!order) {
      req.flash('error_msg', 'Order not found');
      return res.redirect('/admin/orders');
    }
    res.render('admin/print-order', {
      title: `Print Order #${order._id.toString().slice(-8).toUpperCase()}`,
      order,
      user: req.user
    });
  } catch (error) {
    req.flash('error_msg', 'Error loading print view');
    res.redirect('/admin/orders');
  }
});

// Order PDF
app.get('/admin/orders/:id/pdf', ensureAuthenticated, ensureAdmin, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id).populate('user', 'firstName lastName email');
    if (!order) {
      req.flash('error_msg', 'Order not found');
      return res.redirect('/admin/orders');
    }

    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const filename = `Order_${order._id.toString().slice(-8).toUpperCase()}.pdf`;

    res.setHeader('Content-disposition', 'attachment; filename="' + filename + '"');
    res.setHeader('Content-type', 'application/pdf');

    // Pipe the PDF document to the response immediately
    doc.pipe(res);

    // Theme Colors
    const primaryColor = '#1b5e20';
    const secondaryColor = '#455a64';
    const accentColor = '#c0ca33';
    const textColor = '#1a1a1a';
    const lightGray = '#f8fafc';

    // Header Background
    doc.rect(0, 0, 600, 150).fill('#e8f5e9');
    
    // Brand Name
    doc.fillColor(primaryColor)
       .fontSize(24)
       .font('Helvetica-Bold')
       .text('SRI LALITAMBA', 50, 45);
    doc.text('NURSERY & GARDENS', 50, 75);
    
    doc.fillColor(secondaryColor)
       .fontSize(8)
       .font('Helvetica')
       .text('Kadiyapulanka, Andhra Pradesh, 533126', 50, 105)
       .text('Ph: +91 99633 72123 | srilalitambanursery@gmail.com', 50, 118);

    // Invoice Label
    doc.fillColor(primaryColor)
       .fontSize(35)
       .font('Helvetica-Bold')
       .text('ORDER', 350, 45, { align: 'right', width: 200 });
    
    // Meta Info Box
    doc.rect(400, 90, 150, 45).fill(primaryColor);
    doc.fillColor('#ffffff')
       .fontSize(8)
       .text('ORDER NUMBER', 410, 100)
       .fontSize(11)
       .text(`#${order._id.toString().slice(-8).toUpperCase()}`, 410, 112);

    doc.moveDown(5);

    // Horizontal Line
    doc.moveTo(50, 160).lineTo(550, 160).strokeColor('#e2e8f0').stroke();

    // Details Grid
    const startY = 180;
    
    // Billed To
    doc.fillColor(secondaryColor).fontSize(8).font('Helvetica-Bold').text('SHIPPING TO', 50, startY);
    doc.fillColor(textColor).fontSize(11).font('Helvetica-Bold').text(order.shippingAddress.fullName, 50, startY + 15);
    doc.font('Helvetica').fontSize(9).text(order.shippingAddress.phone, 50, startY + 30);
    doc.text(`${order.shippingAddress.address}, ${order.shippingAddress.city}`, 50, startY + 45);
    doc.text(`${order.shippingAddress.state}, ${order.shippingAddress.zipCode}`, 50, startY + 58);

    // Order Info
    doc.fillColor(secondaryColor).fontSize(8).font('Helvetica-Bold').text('ORDER DETAILS', 350, startY);
    doc.fillColor(textColor).fontSize(9).font('Helvetica').text('Date Issued:', 350, startY + 15);
    doc.font('Helvetica-Bold').text(new Date(order.createdAt).toLocaleDateString('en-IN'), 430, startY + 15);
    
    doc.font('Helvetica').text('Status:', 350, startY + 30);
    doc.font('Helvetica-Bold').text(order.status.toUpperCase(), 430, startY + 30);
    
    doc.font('Helvetica').text('Payment:', 350, startY + 45);
    doc.font('Helvetica-Bold').text(order.paymentMethod.toUpperCase(), 430, startY + 45);

    // Table Header
    const tableTop = 280;
    doc.rect(50, tableTop, 500, 30).fill(lightGray);
    doc.fillColor(secondaryColor).fontSize(8).font('Helvetica-Bold');
    doc.text('S.NO', 60, tableTop + 10);
    doc.text('PLANT & DESCRIPTION', 100, tableTop + 10);
    doc.text('QTY', 450, tableTop + 10, { width: 90, align: 'right' });

    // Table Border
    doc.moveTo(50, tableTop + 30).lineTo(550, tableTop + 30).strokeColor(primaryColor).lineWidth(2).stroke();

    // Items
    let currentY = tableTop + 40;
    order.items.forEach((item, index) => {
      // Add a new page if we are too close to the bottom
      if (currentY > 700) {
        doc.addPage();
        currentY = 50; // Reset to top
        
        // Redraw table header
        doc.rect(50, currentY, 500, 30).fill(lightGray);
        doc.fillColor(secondaryColor).fontSize(8).font('Helvetica-Bold');
        doc.text('S.NO', 60, currentY + 10);
        doc.text('PLANT & DESCRIPTION', 100, currentY + 10);
        doc.text('QTY', 450, currentY + 10, { width: 90, align: 'right' });
        doc.moveTo(50, currentY + 30).lineTo(550, currentY + 30).strokeColor(primaryColor).lineWidth(2).stroke();
        
        currentY += 40;
      }

      // Background for alternate rows
      if (index % 2 === 1) {
        doc.rect(50, currentY - 5, 500, 35).fill('#fafafa');
      }
      
      doc.fillColor(textColor).fontSize(10).font('Helvetica-Bold').text((index + 1).toString(), 60, currentY);
      doc.text(item.name || item.plantName || 'Plant', 100, currentY);
      doc.fillColor(secondaryColor).fontSize(8).font('Helvetica').text(item.packetSize || item.size || 'Standard', 100, currentY + 12);
      
      doc.fillColor(textColor).fontSize(10).text(item.quantity.toString(), 450, currentY, { width: 90, align: 'right' });
      
      currentY += 35;
      
      // Horizontal line between items
      doc.moveTo(50, currentY - 5).lineTo(550, currentY - 5).strokeColor('#f1f5f9').lineWidth(1).stroke();
    });

    // Handle Summary Section Page Breaks
    if (currentY > 600) {
        doc.addPage();
        currentY = 50;
    }

    // Summary
    const summaryY = currentY + 20;
    const totalQty = order.items.reduce((sum, item) => sum + item.quantity, 0);
    
    const totalBoxY = summaryY + 10;
    doc.rect(340, totalBoxY, 210, 40).fill(primaryColor);
    doc.fillColor('#ffffff').fontSize(14).text('TOTAL ITEMS', 350, totalBoxY + 13);
    doc.fontSize(16).text(totalQty.toString(), 450, totalBoxY + 12, { width: 90, align: 'right' });

    // Notes
    if (order.notes) {
      doc.fillColor(primaryColor).fontSize(9).font('Helvetica-Bold').text('NOTES & TERMS', 50, totalBoxY + 80);
      doc.rect(50, totalBoxY + 95, 250, 60).fill(lightGray);
      doc.fillColor(secondaryColor).fontSize(8).font('Helvetica-Oblique').text(order.notes, 60, totalBoxY + 105, { width: 230 });
    }

    // Footer - dynamically placed
    doc.fillColor(secondaryColor).fontSize(9).font('Helvetica').text('Thank you for supporting SRI LALITAMBA NURSERY & GARDENS', 0, doc.page.height - 70, { align: 'center', width: doc.page.width });
    doc.fontSize(7).text('Kadiyapulanka, Andhra Pradesh | contact@srilalitamba.com', 0, doc.page.height - 55, { align: 'center', width: doc.page.width });

    doc.end();

  } catch (error) {
    console.error('PDF error:', error);
    req.flash('error_msg', 'Error generating PDF');
    res.redirect('/admin/orders');
  }
});

app.post('/orders/create-direct', ensureAuthenticated, async (req, res) => {
  try {
    const { plantId, plantName, plantPrice, plantImage, size, quantity, address } = req.body;

    const newOrder = new Order({
      user: req.user._id,
      items: [{
        plant: plantId,
        name: plantName,
        price: parseFloat(plantPrice) || 0,
        quantity: parseInt(quantity) || 1,
        size: size,
        image: plantImage
      }],
      totalAmount: (parseFloat(plantPrice) || 0) * (parseInt(quantity) || 1),
      shippingAddress: {
        fullName: req.user.firstName + ' ' + req.user.lastName,
        address: address,
        city: 'N/A',
        state: 'N/A',
        zipCode: 'N/A',
        phone: 'N/A'
      },
      paymentMethod: 'cod',
      status: 'pending',
      deliveryDeadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // Default 7 days
    });

    await newOrder.save();
    req.flash('success_msg', 'Order placed successfully! We will contact you soon.');
    res.redirect('/orders');
  } catch (error) {
    console.error('Direct order error:', error);
    req.flash('error_msg', 'Error placing order: ' + error.message);
    res.redirect('back');
  }
});

// Expenses Management
app.get('/admin/expenses', ensureAuthenticated, ensureAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 20;
    const skip = (page - 1) * limit;

    let query = { isActive: true };
    if (req.query.category && req.query.category !== 'all') query.category = req.query.category;
    if (req.query.status && req.query.status !== 'all') query.status = req.query.status;

    const expenses = await Expense.find(query)
      .populate('recordedBy', 'firstName lastName')
      .sort({ expenseDate: -1 })
      .skip(skip)
      .limit(limit);

    const totalExpensesCount = await Expense.countDocuments(query);
    const totalPages = Math.ceil(totalExpensesCount / limit);

    const expenseStats = {
      totalAmount: await Expense.aggregate([
        { $match: { status: 'paid', isActive: true } },
        { $group: { _id: null, total: { $sum: '$amount' } } }
      ]).then(result => result[0]?.total || 0),
      pendingCount: await Expense.countDocuments({ status: 'pending', isActive: true }),
      approvedCount: await Expense.countDocuments({ status: 'approved', isActive: true })
    };

    res.render('admin/expenses', {
      title: 'Expenses Management - SRI LALITAMBA NURSERY & GARDENS',
      expenses,
      currentPage: page,
      totalPages,
      expenseStats,
      stats: { total: expenseStats.totalAmount }, // legacy support
      filters: req.query,
      page: 'expenses'
    });
  } catch (error) {
    console.error(error);
    req.flash('error_msg', 'Error loading expenses');
    res.redirect('/admin/dashboard');
  }
});

app.get('/admin/expenses/add', ensureAuthenticated, ensureAdmin, (req, res) => {
  res.render('admin/add-edit-expense', { title: 'Add Expense', expense: null, page: 'expenses' });
});

app.post('/admin/expenses/add', ensureAuthenticated, ensureAdmin, async (req, res) => {
  try {
    const newExpense = new Expense({ ...req.body, recordedBy: req.user._id });
    await newExpense.save();
    req.flash('success_msg', 'Expense added');
    res.redirect('/admin/expenses');
  } catch (error) {
    req.flash('error_msg', 'Error adding expense');
    res.redirect('/admin/expenses/add');
  }
});

app.get('/admin/expenses/edit/:id', ensureAuthenticated, ensureAdmin, async (req, res) => {
  try {
    const expense = await Expense.findById(req.params.id);
    res.render('admin/add-edit-expense', { title: 'Edit Expense', expense, page: 'expenses' });
  } catch (error) {
    res.redirect('/admin/expenses');
  }
});

app.post('/admin/expenses/edit/:id', ensureAuthenticated, ensureAdmin, async (req, res) => {
  try {
    await Expense.findByIdAndUpdate(req.params.id, req.body);
    req.flash('success_msg', 'Expense updated');
    res.redirect('/admin/expenses');
  } catch (error) {
    req.flash('error_msg', 'Error updating expense');
    res.redirect('/admin/expenses');
  }
});

app.post('/admin/expenses/delete/:id', ensureAuthenticated, ensureAdmin, async (req, res) => {
  try {
    const expense = await Expense.findById(req.params.id);
    if (expense) {
      await logAudit('DELETE', 'EXPENSES', `Deleted expense: ${expense.title} (₹${expense.amount})`, req.user, 'medium', { expenseId: expense._id });
    }
    await Expense.findByIdAndDelete(req.params.id);
    req.flash('success_msg', 'Expense deleted successfully');
    res.redirect('/admin/expenses');
  } catch (error) {
    req.flash('error_msg', 'Error deleting expense');
    res.redirect('/admin/expenses');
  }
});

// Investments Management
app.get('/admin/investments', ensureAuthenticated, ensureAdmin, async (req, res) => {
  try {
    let query = { isActive: true };
    if (req.query.status && req.query.status !== 'all') query.status = req.query.status;

    const investments = await Investment.find(query)
      .populate('recordedBy', 'firstName lastName')
      .sort({ createdAt: -1 });

    const investmentStats = {
      totalInvested: await Investment.aggregate([
        { $match: { isActive: true } },
        { $group: { _id: null, total: { $sum: '$amount' } } }
      ]).then(result => result[0]?.total || 0),
      activeCount: await Investment.countDocuments({ status: 'active', isActive: true }),
      completedCount: await Investment.countDocuments({ status: 'completed', isActive: true })
    };

    res.render('admin/investments', {
      title: 'Investments Management - My Nursery',
      investments,
      investmentStats,
      filters: req.query,
      page: 'investments'
    });
  } catch (error) {
    console.error(error);
    req.flash('error_msg', 'Error loading investments');
    res.redirect('/admin/dashboard');
  }
});

app.get('/admin/investments/add', ensureAuthenticated, ensureAdmin, (req, res) => {
  res.render('admin/add-edit-investment', { title: 'Add Investment', investment: null, page: 'investments' });
});

app.post('/admin/investments/add', ensureAuthenticated, ensureAdmin, async (req, res) => {
  try {
    const newInvestment = new Investment({ ...req.body, recordedBy: req.user._id });
    await newInvestment.save();
    req.flash('success_msg', 'Investment added');
    res.redirect('/admin/investments');
  } catch (error) {
    req.flash('error_msg', 'Error adding investment');
    res.redirect('/admin/investments/add');
  }
});

app.post('/admin/investments/delete/:id', ensureAuthenticated, ensureAdmin, async (req, res) => {
  try {
    const result = await Investment.findByIdAndDelete(req.params.id);
    if (!result) {
      req.flash('error_msg', 'Investment not found');
    } else {
      req.flash('success_msg', 'Investment deleted successfully');
    }
    res.redirect('/admin/investments');
  } catch (error) {
    console.error(error);
    req.flash('error_msg', 'Error deleting investment');
    res.redirect('/admin/investments');
  }
});

// Import/Export Management
app.get('/admin/imports-exports', ensureAuthenticated, ensureAdmin, async (req, res) => {
  try {
    let query = { isActive: true };
    if (req.query.type && req.query.type !== 'all') query.type = req.query.type;

    const transactions = await ImportExport.find(query)
      .populate('recordedBy', 'firstName lastName')
      .sort({ transactionDate: -1 });

    const stats = {
      importTotal: await ImportExport.aggregate([{ $match: { type: 'import', isActive: true } }, { $group: { _id: null, total: { $sum: '$totalAmount' } } }]).then(r => r[0]?.total || 0),
      exportTotal: await ImportExport.aggregate([{ $match: { type: 'export', isActive: true } }, { $group: { _id: null, total: { $sum: '$totalAmount' } } }]).then(r => r[0]?.total || 0)
    };

    res.render('admin/imports-exports', {
      title: 'Import/Export Management - SRI LALITAMBA NURSERY & GARDENS',
      transactions,
      stats,
      page: 'imports-exports'
    });
  } catch (error) {
    console.error(error);
    req.flash('error_msg', 'Error loading transactions');
    res.redirect('/admin/dashboard');
  }
});

app.get('/admin/imports-exports/add', ensureAuthenticated, ensureAdmin, (req, res) => {
  res.render('admin/add-edit-import-export', { title: 'New Transaction', page: 'imports-exports' });
});

app.post('/admin/imports-exports/add', ensureAuthenticated, ensureAdmin, async (req, res) => {
  try {
    const { type, referenceNumber, partnerName, totalAmount, transactionDate } = req.body;
    const newTrans = new ImportExport({
      type, referenceNumber, partner: { name: partnerName }, totalAmount, transactionDate, recordedBy: req.user._id
    });
    await newTrans.save();
    req.flash('success_msg', 'Transaction added');
    res.redirect('/admin/imports-exports');
  } catch (error) {
    req.flash('error_msg', 'Error adding transaction');
    res.redirect('/admin/imports-exports/add');
  }
});

app.post('/admin/imports-exports/delete/:id', ensureAuthenticated, ensureAdmin, async (req, res) => {
  try {
    await ImportExport.findByIdAndDelete(req.params.id);
    req.flash('success_msg', 'Transaction deleted successfully');
    res.redirect('/admin/imports-exports');
  } catch (error) {
    console.error(error);
    req.flash('error_msg', 'Error deleting transaction');
    res.redirect('/admin/imports-exports');
  }
});



// Users Management
app.get('/admin/users', ensureAuthenticated, ensureAdmin, async (req, res) => {
  try {
    const users = await User.find().sort({ createdAt: -1 });
    res.render('admin/users', {
      title: 'Manage Users - SRI LALITAMBA NURSERY & GARDENS',
      users,
      page: 'users'
    });
  } catch (error) {
    req.flash('error_msg', 'Error loading users');
    res.redirect('/admin/dashboard');
  }
});

app.get('/admin/users/add', ensureAuthenticated, ensureAdmin, (req, res) => {
  res.render('admin/add-edit-user', {
    title: 'Add New User - SRI LALITAMBA NURSERY & GARDENS',
    user: null,
    page: 'users'
  });
});

app.post('/admin/users/add', ensureAuthenticated, ensureAdmin, async (req, res) => {
  try {
    const { firstName, lastName, email, username, password, confirmPassword, role, phone, address } = req.body;

    // Validation
    if (!firstName || !lastName || !email || !password) {
      req.flash('error_msg', 'Please fill in all required fields');
      return res.redirect('/admin/users/add');
    }

    if (password !== confirmPassword) {
      req.flash('error_msg', 'Passwords do not match');
      return res.redirect('/admin/users/add');
    }

    if (password.length < 6) {
      req.flash('error_msg', 'Password must be at least 6 characters');
      return res.redirect('/admin/users/add');
    }

    // Check if email already exists
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      req.flash('error_msg', 'Email already registered');
      return res.redirect('/admin/users/add');
    }

    // Check if username already exists (if provided)
    if (username) {
      const existingUsername = await User.findOne({ username: username.toLowerCase() });
      if (existingUsername) {
        req.flash('error_msg', 'Username already taken');
        return res.redirect('/admin/users/add');
      }
    }

    // Create new user
    const newUser = new User({
      firstName,
      lastName,
      email: email.toLowerCase(),
      username: username ? username.toLowerCase() : undefined,
      password, // Will be hashed by the User model pre-save hook
      role: role || 'user',
      phone,
      address
    });

    await newUser.save();
    req.flash('success_msg', `${role === 'admin' ? 'Admin' : 'User'} account created successfully`);
    res.redirect('/admin/users');
  } catch (error) {
    console.error(error);
    req.flash('error_msg', 'Error creating user');
    res.redirect('/admin/users/add');
  }
});

app.get('/admin/users/edit/:id', ensureAuthenticated, ensureAdmin, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      req.flash('error_msg', 'User not found');
      return res.redirect('/admin/users');
    }
    res.render('admin/add-edit-user', {
      title: 'Edit User - SRI LALITAMBA NURSERY & GARDENS',
      user,
      page: 'users'
    });
  } catch (error) {
    req.flash('error_msg', 'Error loading user');
    res.redirect('/admin/users');
  }
});

app.post('/admin/users/edit/:id', ensureAuthenticated, ensureAdmin, async (req, res) => {
  try {
    const { firstName, lastName, email, username, password, confirmPassword, role, phone, address } = req.body;

    // Validation
    if (!firstName || !lastName || !email) {
      req.flash('error_msg', 'Please fill in all required fields');
      return res.redirect(`/admin/users/edit/${req.params.id}`);
    }

    // If password is being changed
    if (password) {
      if (password !== confirmPassword) {
        req.flash('error_msg', 'Passwords do not match');
        return res.redirect(`/admin/users/edit/${req.params.id}`);
      }
      if (password.length < 6) {
        req.flash('error_msg', 'Password must be at least 6 characters');
        return res.redirect(`/admin/users/edit/${req.params.id}`);
      }
    }

    // Check if email is taken by another user
    const existingUser = await User.findOne({
      email: email.toLowerCase(),
      _id: { $ne: req.params.id }
    });
    if (existingUser) {
      req.flash('error_msg', 'Email already registered to another user');
      return res.redirect(`/admin/users/edit/${req.params.id}`);
    }

    // Check if username is taken by another user (if provided)
    if (username) {
      const existingUsername = await User.findOne({
        username: username.toLowerCase(),
        _id: { $ne: req.params.id }
      });
      if (existingUsername) {
        req.flash('error_msg', 'Username already taken');
        return res.redirect(`/admin/users/edit/${req.params.id}`);
      }
    }

    // Update user
    const updateData = {
      firstName,
      lastName,
      email: email.toLowerCase(),
      username: username ? username.toLowerCase() : undefined,
      role: role || 'user',
      phone,
      address
    };

    // Only update password if provided
    if (password) {
      const salt = await bcrypt.genSalt(10);
      updateData.password = await bcrypt.hash(password, salt);
    }

    await User.findByIdAndUpdate(req.params.id, updateData);
    req.flash('success_msg', 'User updated successfully');
    res.redirect('/admin/users');
  } catch (error) {
    console.error(error);
    req.flash('error_msg', 'Error updating user');
    res.redirect(`/admin/users/edit/${req.params.id}`);
  }
});

app.post('/admin/users/delete/:id', ensureAuthenticated, ensureAdmin, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (user) {
      // Prevent self-deletion
      if (user._id.toString() === req.user._id.toString()) {
        req.flash('error_msg', 'You cannot delete your own account');
        return res.redirect('/admin/users');
      }
      await logAudit('DELETE', 'USERS', `Deleted user: ${user.email} (${user.firstName})`, req.user, 'high', { deletedUserId: user._id });
    }

    // Check if this is the last admin
    if (user && user.role === 'admin') {
      const adminCount = await User.countDocuments({ role: 'admin' });
      if (adminCount <= 1) {
        req.flash('error_msg', 'Cannot delete the last admin user');
        return res.redirect('/admin/users');
      }
    }

    await User.findByIdAndDelete(req.params.id);
    req.flash('success_msg', 'User deleted successfully');
    res.redirect('/admin/users');
  } catch (error) {
    req.flash('error_msg', 'Error deleting user');
    res.redirect('/admin/users');
  }
});

// Reports
app.get('/admin/reports', ensureAuthenticated, ensureAdmin, async (req, res) => {
  try {
    const totalRevenueResult = await Bill.aggregate([{ $group: { _id: null, total: { $sum: '$totalAmount' } } }]);
    const totalOrders = await Order.countDocuments();
    const topProducts = await Order.aggregate([
      { $unwind: "$items" },
      { $group: { _id: "$items.name", count: { $sum: "$items.quantity" } } },
      { $sort: { count: -1 } },
      { $limit: 5 }
    ]);

    res.render('admin/reports', {
      title: 'Reports - SRI LALITAMBA NURSERY & GARDENS',
      stats: {
        revenue: totalRevenueResult[0]?.total || 0,
        orders: totalOrders,
        topProducts
      },
      page: 'reports'
    });
  } catch (error) {
    req.flash('error_msg', 'Error loading reports');
    res.redirect('/admin/dashboard');
  }
});

// ===== BILLING CATALOG SEARCH API =====

// Catalog search - used by the bill form to search plants
app.get('/api/billing/catalog/search', ensureAuthenticated, ensureAdmin, async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) {
      return res.json({ success: true, results: [] });
    }

    const searchRegex = new RegExp(escapeRegex(q), 'i');
    const plants = await Plant.find({
      isActive: true,
      $or: [
        { name: searchRegex },
        { category: searchRegex }
      ]
    }).select('name price stock category').limit(15);

    const results = plants.map(p => ({
      _id: p._id.toString(),
      name: p.name,
      price: p.price || 0,
      stock: p.stock || 0,
      category: p.category
    }));

    res.json({ success: true, results });
  } catch (error) {
    console.error('Catalog search error:', error);
    res.status(500).json({ success: false, results: [], error: 'Search failed' });
  }
});

// ===== BILLING ROUTES =====

// Get all bills
app.get('/admin/bills', ensureAuthenticated, ensureAdmin, async (req, res) => {
  try {
    const status = req.query.status || 'all';
    let filter = {};

    if (status !== 'all') {
      filter.status = status;
    }

    const bills = await Bill.find(filter).sort({ createdAt: -1 });

    res.render('admin/bills', {
      title: 'Billing Dashboard - SRI LALITAMBA NURSERY & GARDENS',
      bills,
      filters: { status },
      page: 'bills'
    });
  } catch (error) {
    console.error('Error loading bills:', error);
    req.flash('error_msg', 'Error loading bills');
    res.redirect('/admin/dashboard');
  }
});

// Create bill form
app.get('/admin/bills/create', ensureAuthenticated, ensureAdmin, async (req, res) => {
  try {
    const plants = await Plant.find({ isActive: true }).select('name price stock');

    res.render('admin/add-edit-bill', {
      title: 'Create New Bill - SRI LALITAMBA NURSERY & GARDENS',
      bill: null,
      plants,
      page: 'bills'
    });
  } catch (error) {
    console.error('Error loading create bill page:', error);
    req.flash('error_msg', 'Error loading form');
    res.redirect('/admin/bills');
  }
});

// Create bill - POST
app.post('/admin/bills/create', ensureAuthenticated, ensureAdmin, async (req, res) => {
  try {
    // Check database connection
    if (mongoose.connection.readyState !== 1) {
      req.flash('error_msg', 'Database not connected. Please try again later.');
      return res.redirect('/admin/bills/create');
    }

    const {
      customerName,
      customerPhone,
      billDate,
      dueDate,
      paymentMethod,
      items,
      subTotal,
      tax,
      discount,
      totalAmount,
      status,
      notes,
      isFarmerBill
    } = req.body;

    // Parse items if it's a string
    let parsedItems = typeof items === 'string' ? JSON.parse(items) : items;

    // Validate items
    if (!parsedItems || parsedItems.length === 0) {
      req.flash('error_msg', 'Please add at least one item to the bill');
      return res.redirect('/admin/bills/create');
    }

    // Process items to ensure they have the correct structure
    parsedItems = parsedItems.map(item => {
      const quantity = Number(item.quantity) || 1;
      const unitPrice = Number(item.unitPrice) || Number(item.price) || 0;
      const lineTotal = quantity * unitPrice;

      return {
        plantId: item.plantId || null,
        packetSize: item.packetSize || '1 unit',
        plantName: item.plantName || item.description || '',
        quantity: quantity,
        unitPrice: unitPrice,
        lineTotal: lineTotal
      };
    });

    // Calculate totals
    const finalSubTotal = parsedItems.reduce((sum, item) => sum + item.lineTotal, 0);
    const finalTax = parseFloat(tax) || 0;
    const finalDiscount = parseFloat(discount) || 0;
    const finalTotal = finalSubTotal + finalTax - finalDiscount;

    const newBill = new Bill({
      customerName,
      customerPhone,
      billDate: billDate || new Date(),
      dueDate: dueDate || null,
      paymentMethod: paymentMethod || 'cash',
      items: parsedItems,
      subTotal: finalSubTotal,
      tax: finalTax,
      discount: finalDiscount,
      totalAmount: finalTotal,
      status: status || 'pending',
      notes: notes || '',
      createdBy: req.user._id,
      isFarmerBill: isFarmerBill === 'true',
      paidAmount: (status === 'paid') ? finalTotal : 0,
      balanceAmount: (status === 'paid') ? 0 : finalTotal
    });

    // If marked as paid, add an initial payment record
    if (status === 'paid') {
      newBill.payments.push({
        amount: finalTotal,
        mode: paymentMethod || 'cash',
        date: billDate || new Date(),
        notes: 'Initial full payment'
      });
    }

    await newBill.save();
    
    // Audit Log
    await logAudit('CREATE', 'BILLS', `Created bill: ${newBill.billNumber} for ${customerName} (₹${finalTotal})`, req.user, 'medium', { billId: newBill._id });

    // Update plant stock if plantId is associated
    for (const item of parsedItems) {
      if (item.plantId) {
        await Plant.findByIdAndUpdate(item.plantId, {
          $inc: { stock: -item.quantity }
        });
      }
    }

    req.flash('success_msg', `Bill ${newBill.billNumber} created successfully!`);
    res.redirect('/admin/bills');
  } catch (error) {
    console.error('Error creating bill:', error);
    req.flash('error_msg', 'Error creating bill');
    res.redirect('/admin/bills/create');
  }
});

// View single bill
app.get('/admin/bills/:id', ensureAuthenticated, ensureAdmin, async (req, res) => {
  try {
    const bill = await Bill.findById(req.params.id);

    if (!bill) {
      req.flash('error_msg', 'Bill not found');
      return res.redirect('/admin/bills');
    }

    res.render('admin/view-bill', {
      title: `Bill ${bill.billNumber} - SRI LALITAMBA NURSERY & GARDENS`,
      bill,
      page: 'bills'
    });
  } catch (error) {
    console.error('Error viewing bill:', error);
    req.flash('error_msg', 'Error loading bill');
    res.redirect('/admin/bills');
  }
});

// Edit bill form
app.get('/admin/bills/:id/edit', ensureAuthenticated, ensureAdmin, async (req, res) => {
  try {
    const bill = await Bill.findById(req.params.id);
    const plants = await Plant.find({ isActive: true }).select('name price stock');

    if (!bill) {
      req.flash('error_msg', 'Bill not found');
      return res.redirect('/admin/bills');
    }

    res.render('admin/add-edit-bill', {
      title: `Edit Bill ${bill.billNumber} - SRI LALITAMBA NURSERY & GARDENS`,
      bill,
      plants,
      page: 'bills'
    });
  } catch (error) {
    console.error('Error loading edit bill page:', error);
    req.flash('error_msg', 'Error loading bill');
    res.redirect('/admin/bills');
  }
});

// Update bill - POST
app.post('/admin/bills/edit/:id', ensureAuthenticated, ensureAdmin, async (req, res) => {
  try {
    const {
      customerName,
      customerPhone,
      billDate,
      dueDate,
      paymentMethod,
      items,
      subTotal,
      tax,
      discount,
      totalAmount,
      status,
      notes,
      isFarmerBill
    } = req.body;

    // Parse items if it's a string
    let parsedItems = typeof items === 'string' ? JSON.parse(items) : items;

    // Validate items
    if (!parsedItems || parsedItems.length === 0) {
      req.flash('error_msg', 'Please add at least one item to the bill');
      return res.redirect(`/admin/bills/${req.params.id}/edit`);
    }

    // Process items to ensure they have the correct structure
    parsedItems = parsedItems.map(item => {
      const quantity = Number(item.quantity) || 1;
      const unitPrice = Number(item.unitPrice) || Number(item.price) || 0;
      const lineTotal = quantity * unitPrice;

      return {
        plantId: item.plantId || null,
        packetSize: item.packetSize || '1 unit',
        plantName: item.plantName || item.description || '',
        quantity: quantity,
        unitPrice: unitPrice,
        lineTotal: lineTotal,
        // Legacy support
        description: item.plantName || item.description || '',
        price: unitPrice,
        amount: lineTotal
      };
    });

    const bill = await Bill.findById(req.params.id);

    if (!bill) {
      req.flash('error_msg', 'Bill not found');
      return res.redirect('/admin/bills');
    }

    // Restore stock for old items (if plantId exists)
    for (const oldItem of bill.items) {
      if (oldItem.plantId) {
        await Plant.findByIdAndUpdate(oldItem.plantId, {
          $inc: { stock: oldItem.quantity }
        });
      }
    }

    // Recalculate totals from items
    const calculatedSubTotal = parsedItems.reduce((sum, item) => sum + item.lineTotal, 0);
    const finalSubTotal = parseFloat(subTotal) || calculatedSubTotal;
    const finalTax = parseFloat(tax) || 0;
    const finalDiscount = parseFloat(discount) || 0;
    const finalTotal = finalSubTotal + finalTax - finalDiscount;

    // Update bill
    bill.customerName = customerName;
    bill.customerPhone = customerPhone;
    bill.billDate = billDate;
    bill.dueDate = dueDate;
    bill.paymentMethod = paymentMethod;
    bill.items = parsedItems;
    bill.subTotal = finalSubTotal;
    bill.tax = finalTax;
    bill.discount = finalDiscount;
    bill.totalAmount = finalTotal;
    bill.status = status;
    bill.notes = notes;
    bill.isFarmerBill = isFarmerBill === 'true';

    await bill.save();
    
    // Audit Log
    await logAudit('UPDATE', 'BILLS', `Updated bill: ${bill.billNumber} (New Total: ₹${finalTotal})`, req.user, 'medium', { billId: bill._id });

    // Deduct stock for new items
    for (const item of parsedItems) {
      if (item.plantId) {
        await Plant.findByIdAndUpdate(item.plantId, {
          $inc: { stock: -item.quantity }
        });
      }
    }

    req.flash('success_msg', `Bill ${bill.billNumber} updated successfully!`);
    res.redirect('/admin/bills');
  } catch (error) {
    console.error('Error updating bill:', error);
    req.flash('error_msg', 'Error updating bill');
    res.redirect(`/admin/bills/${req.params.id}/edit`);
  }
});

// Delete bill - POST
app.post('/admin/bills/delete/:id', ensureAuthenticated, ensureAdmin, async (req, res) => {
  try {
    const bill = await Bill.findById(req.params.id);

    if (!bill) {
      req.flash('error_msg', 'Bill not found');
      return res.redirect('/admin/bills');
    }

    // Restore stock for deleted bill items
    for (const item of bill.items) {
      if (item.plantId) {
        await Plant.findByIdAndUpdate(item.plantId, {
          $inc: { stock: item.quantity }
        });
      }
    }

    await Bill.findByIdAndDelete(req.params.id);

    req.flash('success_msg', `Bill ${bill.billNumber} deleted successfully`);
    res.redirect('/admin/bills');
  } catch (error) {
    console.error('Error deleting bill:', error);
    req.flash('error_msg', 'Error deleting bill');
    res.redirect('/admin/bills');
  }
});

// Print bill
app.get('/admin/bills/:id/print', ensureAuthenticated, ensureAdmin, async (req, res) => {
  try {
    const bill = await Bill.findById(req.params.id);

    if (!bill) {
      req.flash('error_msg', 'Bill not found');
      return res.redirect('/admin/bills');
    }

    res.render('admin/print-bill', {
      title: `Print Bill ${bill.billNumber}`,
      bill,
      layout: false // No layout for print page
    });
  } catch (error) {
    console.error('Error loading print view:', error);
    req.flash('error_msg', 'Error loading print view');
    res.redirect('/admin/bills');
  }
});

// Generate PDF Bill
app.get('/admin/bills/:id/pdf', ensureAuthenticated, ensureAdmin, async (req, res) => {
  try {
    const bill = await Bill.findById(req.params.id).populate('createdBy', 'firstName lastName');

    if (!bill) {
      req.flash('error_msg', 'Bill not found');
      return res.redirect('/admin/bills');
    }

    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const filename = `Sri_Lalitamba_Invoice_${bill.billNumber}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    doc.pipe(res);

    // Theme Colors
    const primaryColor = '#1b5e20';
    const secondaryColor = '#455a64';
    const textColor = '#1a1a1a';
    const lightGray = '#f8fafc';

    // Header Background
    doc.rect(0, 0, 600, 150).fill('#e8f5e9');
    
    // Brand Name
    doc.fillColor(primaryColor)
       .fontSize(24)
       .font('Helvetica-Bold')
       .text('SRI LALITAMBA', 50, 45);
    doc.text('NURSERY & GARDENS', 50, 75);
    
    doc.fillColor(secondaryColor)
       .fontSize(8)
       .font('Helvetica')
       .text('Kadiyapulanka, Andhra Pradesh, 533126', 50, 105)
       .text('Ph: +91 99633 72123 | lalitambanursery@gmail.com', 50, 118);

    // Invoice Label
    doc.fillColor(primaryColor)
       .fontSize(35)
       .font('Helvetica-Bold')
       .text('INVOICE', 350, 45, { align: 'right', width: 200 });
    
    // Meta Info Box
    doc.rect(400, 90, 150, 45).fill(primaryColor);
    doc.fillColor('#ffffff')
       .fontSize(8)
       .text('INVOICE NUMBER', 410, 100)
       .fontSize(11)
       .text(`#${bill.billNumber}`, 410, 112);

    doc.moveDown(5);

    // Horizontal Line
    doc.moveTo(50, 160).lineTo(550, 160).strokeColor('#e2e8f0').stroke();

    // Details Grid
    const startY = 180;
    
    // Billed To
    doc.fillColor(secondaryColor).fontSize(8).font('Helvetica-Bold').text('BILLED TO', 50, startY);
    doc.fillColor(textColor).fontSize(11).font('Helvetica-Bold').text(bill.customerName, 50, startY + 15);
    if (bill.customerPhone) {
      doc.font('Helvetica').fontSize(9).text(bill.customerPhone, 50, startY + 30);
    }

    // Invoice Info
    doc.fillColor(secondaryColor).fontSize(8).font('Helvetica-Bold').text('INVOICE DETAILS', 350, startY);
    doc.fillColor(textColor).fontSize(9).font('Helvetica').text('Date Issued:', 350, startY + 15);
    doc.font('Helvetica-Bold').text(new Date(bill.billDate).toLocaleDateString('en-IN'), 430, startY + 15);
    
    doc.font('Helvetica').text('Status:', 350, startY + 30);
    doc.font('Helvetica-Bold').text(bill.status.toUpperCase(), 430, startY + 30);
    
    doc.font('Helvetica').text('Payment:', 350, startY + 45);
    doc.font('Helvetica-Bold').text(bill.paymentMethod.toUpperCase(), 430, startY + 45);

    // Table Header
    const tableTop = 280;
    doc.rect(50, tableTop, 500, 30).fill(lightGray);
    doc.fillColor(secondaryColor).fontSize(8).font('Helvetica-Bold');
    doc.text('S.NO', 60, tableTop + 10);
    doc.text('PLANT & DESCRIPTION', 100, tableTop + 10);
    doc.text('PRICE', 300, tableTop + 10, { width: 60, align: 'right' });
    doc.text('QTY', 380, tableTop + 10, { width: 40, align: 'right' });
    doc.text('AMOUNT', 450, tableTop + 10, { width: 90, align: 'right' });

    // Table Border
    doc.moveTo(50, tableTop + 30).lineTo(550, tableTop + 30).strokeColor(primaryColor).lineWidth(2).stroke();

    // Items
    let currentY = tableTop + 40;
    bill.items.forEach((item, index) => {
      // Add a new page if we are too close to the bottom
      if (currentY > 700) {
        doc.addPage();
        currentY = 50; // Reset to top
        
        // Redraw table header
        doc.rect(50, currentY, 500, 30).fill(lightGray);
        doc.fillColor(secondaryColor).fontSize(8).font('Helvetica-Bold');
        doc.text('S.NO', 60, currentY + 10);
        doc.text('PLANT & DESCRIPTION', 100, currentY + 10);
        doc.text('PRICE', 300, currentY + 10, { width: 60, align: 'right' });
        doc.text('QTY', 380, currentY + 10, { width: 40, align: 'right' });
        doc.text('AMOUNT', 450, currentY + 10, { width: 90, align: 'right' });
        doc.moveTo(50, currentY + 30).lineTo(550, currentY + 30).strokeColor(primaryColor).lineWidth(2).stroke();
        
        currentY += 40;
      }

      if (index % 2 === 1) {
        doc.rect(50, currentY - 5, 500, 35).fill('#fafafa');
      }
      
      const pName = item.plantName || item.description || 'Plant';
      doc.fillColor(textColor).fontSize(10).font('Helvetica-Bold').text((index + 1).toString(), 60, currentY);
      doc.text(pName, 100, currentY);
      doc.fillColor(secondaryColor).fontSize(8).font('Helvetica').text(item.packetSize || 'Standard', 100, currentY + 12);
      
      doc.fillColor(textColor).fontSize(10).text(`₹${(item.unitPrice || item.price || 0).toLocaleString()}`, 300, currentY, { width: 60, align: 'right' });
      doc.text(item.quantity.toString(), 380, currentY, { width: 40, align: 'right' });
      doc.font('Helvetica-Bold').text(`₹${(item.lineTotal || ((item.unitPrice || 0) * item.quantity)).toLocaleString()}`, 450, currentY, { width: 90, align: 'right' });
      
      currentY += 35;
      doc.moveTo(50, currentY - 5).lineTo(550, currentY - 5).strokeColor('#f1f5f9').lineWidth(1).stroke();
    });

    // Handle Summary Section Page Breaks
    if (currentY > 600) {
        doc.addPage();
        currentY = 50;
    }

    // Summary
    const summaryY = currentY + 20;
    doc.fillColor(secondaryColor).fontSize(10).text('Subtotal', 350, summaryY);
    doc.fillColor(textColor).font('Helvetica-Bold').text(`₹${(bill.subTotal || 0).toLocaleString()}`, 450, summaryY, { width: 90, align: 'right' });
    
    let nextY = summaryY + 20;
    if (bill.tax > 0) {
      doc.fillColor(secondaryColor).font('Helvetica').text('Tax Amount', 350, nextY);
      doc.fillColor(textColor).text(`+₹${bill.tax.toLocaleString()}`, 450, nextY, { width: 90, align: 'right' });
      nextY += 20;
    }
    if (bill.discount > 0) {
      doc.fillColor('#dc3545').text('Special Discount', 350, nextY);
      doc.text(`-₹${bill.discount.toLocaleString()}`, 450, nextY, { width: 90, align: 'right' });
      nextY += 20;
    }

    const totalBoxY = nextY + 10;
    doc.rect(340, totalBoxY, 210, 40).fill(primaryColor);
    doc.fillColor('#ffffff').fontSize(14).text('TOTAL AMOUNT', 350, totalBoxY + 13);
    doc.fontSize(16).text(`₹${(bill.totalAmount || 0).toLocaleString()}`, 450, totalBoxY + 12, { width: 90, align: 'right' });

    // Notes
    if (bill.notes) {
      doc.fillColor(primaryColor).fontSize(9).font('Helvetica-Bold').text('NOTES & TERMS', 50, totalBoxY + 80);
      doc.rect(50, totalBoxY + 95, 250, 60).fill(lightGray);
      doc.fillColor(secondaryColor).fontSize(8).font('Helvetica-Oblique').text(bill.notes, 60, totalBoxY + 105, { width: 230 });
    }

    // Footer - dynamically placed at the very bottom of the page
    doc.fillColor(secondaryColor).fontSize(9).font('Helvetica').text('Thank you for choosing SRI LALITAMBA NURSERY & GARDENS', 0, doc.page.height - 70, { align: 'center', width: doc.page.width });
    doc.fontSize(7).text('Kadiyapulanka, Andhra Pradesh | lalitambanursery@gmail.com', 0, doc.page.height - 55, { align: 'center', width: doc.page.width });

    doc.end();

  } catch (error) {
    console.error('PDF error:', error);
    req.flash('error_msg', 'Error generating PDF');
    res.redirect('/admin/bills');
  }
});

// Contact page
app.get('/contact', async (req, res) => {
  try {
    const nurseryReviews = await Review.find({ type: 'nursery', isActive: true })
      .populate('user', 'firstName lastName')
      .sort({ createdAt: -1 })
      .limit(10);
    
    res.render('contact', { 
      title: 'Contact Us - SRI LALITAMBA NURSERY & GARDENS',
      reviews: nurseryReviews || [],
      page: 'contact'
    });
  } catch (error) {
    console.error('Contact page reviews error:', error);
    res.render('contact', { 
      title: 'Contact Us - SRI LALITAMBA NURSERY & GARDENS',
      reviews: [],
      page: 'contact'
    });
  }
});

// Process Contact Form
app.post('/contact', async (req, res) => {
  try {
    const { firstName, lastName, email, phone, subject, message } = req.body;
    
    // Simple validation
    if (!firstName || !lastName || !email || !subject || !message) {
      if (req.xhr) return res.status(400).json({ success: false, message: 'Please fill in all required fields' });
      req.flash('error_msg', 'Please fill in all required fields');
      return res.redirect('/contact');
    }

    const newMessage = new Message({
      firstName,
      lastName,
      email,
      phone,
      subject,
      message
    });

    await newMessage.save();

    if (req.xhr) return res.json({ success: true, message: 'Thank you for your message! We will get back to you soon.' });
    
    req.flash('success_msg', 'Thank you for your message! We will get back to you soon.');
    res.redirect('/contact');
  } catch (error) {
    console.error('Contact form error:', error);
    if (req.xhr) return res.status(500).json({ success: false, message: 'Error sending message. Please try again later.' });
    req.flash('error_msg', 'Error sending message. Please try again later.');
    res.redirect('/contact');
  }
});

// Submit Nursery Review
app.post('/reviews/nursery', ensureAuthenticated, async (req, res) => {
  try {
    const { rating, title, comment } = req.body;
    
    // Check if user already reviewed nursery
    const existingReview = await Review.findOne({ user: req.user._id, type: 'nursery' });
    if (existingReview) {
      req.flash('error_msg', 'You have already reviewed our nursery.');
      return res.redirect('/contact#reviews');
    }

    const review = new Review({
      user: req.user._id,
      type: 'nursery',
      rating: parseInt(rating),
      title,
      comment,
      isVerified: true // User is authenticated
    });

    await review.save();
    req.flash('success_msg', 'Thank you for your review!');
    res.redirect('/contact#reviews');
  } catch (error) {
    console.error('Review submission error:', error);
    req.flash('error_msg', 'Error submitting review');
    res.redirect('/contact');
  }
});

// About page
app.get('/about', (req, res) => {
  res.render('about', { 
    title: 'About Us - SRI LALITAMBA NURSERY & GARDENS',
    page: 'about'
  });
});

// ===== ADVANCED ADMIN DASHBOARD API ROUTES =====

// Real-time Dashboard Stats API
app.get('/api/admin/dashboard/stats', ensureAuthenticated, ensureAdmin, async (req, res) => {
  try {
    const now = new Date();
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());

    // Current stats
    const currentStats = {
      totalPlants: await Plant.countDocuments({ isActive: true }),
      totalOrders: await Order.countDocuments(),
      totalUsers: await User.countDocuments({ role: 'user' }),
      totalRevenue: await Bill.aggregate([{ $group: { _id: null, total: { $sum: '$totalAmount' } } }]).then(r => r[0]?.total || 0),
      pendingOrders: await Order.countDocuments({ status: 'pending' }),
      lowStockCount: await Plant.countDocuments({ isActive: true, stock: { $lte: 5 } })
    };

    // Last month stats for comparison
    const lastMonthStats = {
      totalPlants: await Plant.countDocuments({ isActive: true, createdAt: { $lte: lastMonth } }),
      totalOrders: await Order.countDocuments({ createdAt: { $lte: lastMonth } }),
      totalUsers: await User.countDocuments({ role: 'user', createdAt: { $lte: lastMonth } }),
      totalRevenue: await Bill.aggregate([
        { $match: { createdAt: { $lte: lastMonth } } },
        { $group: { _id: null, total: { $sum: '$totalAmount' } } }
      ]).then(r => r[0]?.total || 0)
    };

    // Calculate growth percentages
    const growth = {
      plants: lastMonthStats.totalPlants > 0 ?
        ((currentStats.totalPlants - lastMonthStats.totalPlants) / lastMonthStats.totalPlants * 100).toFixed(1) : 0,
      orders: lastMonthStats.totalOrders > 0 ?
        ((currentStats.totalOrders - lastMonthStats.totalOrders) / lastMonthStats.totalOrders * 100).toFixed(1) : 0,
      users: lastMonthStats.totalUsers > 0 ?
        ((currentStats.totalUsers - lastMonthStats.totalUsers) / lastMonthStats.totalUsers * 100).toFixed(1) : 0,
      revenue: lastMonthStats.totalRevenue > 0 ?
        ((currentStats.totalRevenue - lastMonthStats.totalRevenue) / lastMonthStats.totalRevenue * 100).toFixed(1) : 0
    };

    res.json({ success: true, stats: currentStats, growth });
  } catch (error) {
    console.error('Stats API error:', error);
    res.status(500).json({ success: false, message: 'Error fetching stats' });
  }
});

// Revenue Chart Data API
app.get('/api/admin/dashboard/revenue-chart', ensureAuthenticated, ensureAdmin, async (req, res) => {
  try {
    const period = req.query.period || 'week'; // week, month, year
    const now = new Date();
    let startDate, labels, groupBy;

    if (period === 'week') {
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
      labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      groupBy = { $dayOfWeek: '$createdAt' };
    } else if (period === 'month') {
      startDate = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
      labels = [];
      for (let i = 29; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
        labels.push(`${d.getDate()}/${d.getMonth() + 1}`);
      }
      groupBy = { $dayOfMonth: '$createdAt' };
    } else {
      startDate = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
      labels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      groupBy = { $month: '$createdAt' };
    }

    const revenueData = await Bill.aggregate([
      { $match: { createdAt: { $gte: startDate } } },
      { $group: { _id: groupBy, total: { $sum: '$totalAmount' } } },
      { $sort: { _id: 1 } }
    ]);

    const data = new Array(labels.length).fill(0);
    revenueData.forEach(item => {
      const index = item._id - 1;
      if (index >= 0 && index < data.length) {
        data[index] = item.total;
      }
    });

    res.json({ success: true, labels, data });
  } catch (error) {
    console.error('Revenue chart API error:', error);
    res.status(500).json({ success: false, message: 'Error fetching revenue data' });
  }
});

// Search API
app.get('/api/admin/search', ensureAuthenticated, ensureAdmin, async (req, res) => {
  try {
    const query = req.query.q || '';
    const type = req.query.type || 'all'; // all, plants, orders, users

    let results = { plants: [], orders: [], users: [] };

    if (!query) {
      return res.json({ success: true, results, query });
    }

    const searchRegex = new RegExp(escapeRegex(query), 'i');

    if (type === 'all' || type === 'plants') {
      results.plants = await Plant.find({
        $or: [
          { name: searchRegex },
          { category: searchRegex },
          { description: searchRegex }
        ]
      }).limit(5).select('name category price stock');
    }

    if (type === 'all' || type === 'orders') {
      const orderOrFilters = [{ status: searchRegex }];
      if (mongoose.Types.ObjectId.isValid(query)) {
        orderOrFilters.unshift({ _id: new mongoose.Types.ObjectId(query) });
      }
      results.orders = await Order.find({ $or: orderOrFilters })
        .limit(5)
        .populate('user', 'firstName lastName email');
    }

    if (type === 'all' || type === 'users') {
      results.users = await User.find({
        $or: [
          { firstName: searchRegex },
          { lastName: searchRegex },
          { email: searchRegex },
          { username: searchRegex }
        ]
      }).limit(5).select('firstName lastName email username role');
    }

    res.json({ success: true, results, query });
  } catch (error) {
    console.error('Search API error:', error);
    res.status(500).json({ success: false, message: 'Error performing search' });
  }
});

// API: Get Single Order Details (for Quick View)
app.get('/api/admin/orders/:id', ensureAuthenticated, ensureAdmin, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id).populate('user', 'firstName lastName email phone');
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    res.json({ success: true, order });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Generate Order Invoice PDF
app.get('/admin/orders/:id/pdf', ensureAuthenticated, ensureAdmin, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id).populate('user');
    if (!order) return res.status(404).send('Order not found');

    const doc = new PDFDocument({ margin: 50 });
    let filename = `Invoice-${order._id.toString().slice(-8).toUpperCase()}.pdf`;
    
    res.setHeader('Content-disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-type', 'application/pdf');

    doc.pipe(res);

    // Header
    doc.fontSize(20).text('SRI LALITAMBA NURSERY & GARDENS', { align: 'center' });
    doc.fontSize(10).text('Gandhinagaram, Chemudulanka, East Godavari', { align: 'center' });
    doc.text('Phone: +91 99633 72123', { align: 'center' });
    doc.moveDown();
    doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
    doc.moveDown();

    // Order Info
    doc.fontSize(16).text('ORDER INVOICE', { underline: true });
    doc.fontSize(10).text(`Order ID: #${order._id.toString().toUpperCase()}`);
    doc.text(`Date: ${new Date(order.createdAt).toLocaleString()}`);
    doc.text(`Status: ${order.status.toUpperCase()}`);
    doc.moveDown();

    // Customer Info
    doc.fontSize(12).text('Billed To:');
    doc.fontSize(10).text(order.shippingAddress.fullName);
    doc.text(order.shippingAddress.phone);
    doc.text(order.shippingAddress.address);
    doc.moveDown();

    // Items Table
    doc.fontSize(12).text('Order Items:', { underline: true });
    doc.moveDown(0.5);
    
    order.items.forEach(item => {
      doc.fontSize(10).text(`${item.name} (${item.size}) x ${item.quantity} - ₹${(item.price * item.quantity).toLocaleString()}`);
    });

    doc.moveDown();
    doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
    doc.moveDown();

    // Total
    doc.fontSize(14).text(`TOTAL AMOUNT: ₹${order.totalAmount.toLocaleString()}`, { align: 'right' });
    
    doc.end();
  } catch (error) {
    console.error(error);
    res.status(500).send('Error generating PDF');
  }
});

// Alias for print manifest
app.get('/admin/orders/:id/print', ensureAuthenticated, ensureAdmin, async (req, res) => {
  res.redirect(`/admin/orders/${req.params.id}/pdf`);
});

// Export Dashboard as PDF
app.get('/api/admin/export/pdf', ensureAuthenticated, ensureAdmin, async (req, res) => {
  try {
    const stats = {
      totalPlants: await Plant.countDocuments({ isActive: true }),
      totalOrders: await Order.countDocuments(),
      totalUsers: await User.countDocuments({ role: 'user' }),
      totalRevenue: await Bill.aggregate([{ $group: { _id: null, total: { $sum: '$totalAmount' } } }]).then(r => r[0]?.total || 0)
    };

    const doc = new PDFDocument();
    res.setHeader('Content-disposition', `attachment; filename="Dashboard-Report-${Date.now()}.pdf"`);
    res.setHeader('Content-type', 'application/pdf');
    doc.pipe(res);

    doc.fontSize(25).text('DASHBOARD REPORT', { align: 'center' });
    doc.fontSize(12).text(`Generated: ${new Date().toLocaleString()}`, { align: 'center' });
    doc.moveDown(2);

    doc.fontSize(16).text('Business Statistics:');
    doc.fontSize(12).text(`- Total Active Plants: ${stats.totalPlants}`);
    doc.fontSize(12).text(`- Total Lifetime Orders: ${stats.totalOrders}`);
    doc.fontSize(12).text(`- Registered Users: ${stats.totalUsers}`);
    doc.fontSize(14).text(`- Total Revenue: ₹${stats.totalRevenue.toLocaleString()}`, { color: 'green' });

    doc.end();
  } catch (error) {
    console.error('PDF export error:', error);
    res.status(500).send('Error generating PDF');
  }
});

// Export Dashboard as Excel/CSV
app.get('/api/admin/export/excel', ensureAuthenticated, ensureAdmin, async (req, res) => {
  try {
    const orders = await Order.find().populate('user', 'firstName lastName email').sort({ createdAt: -1 });

    // Generate CSV content
    let csv = 'Order ID,Customer Name,Customer Email,Status,Amount,Date\n';
    orders.forEach(order => {
      csv += `${order._id},${order.user?.firstName || ''} ${order.user?.lastName || ''},${order.user?.email || ''},${order.status},${order.totalAmount},${order.createdAt}\n`;
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="orders-export-${Date.now()}.csv"`);
    res.send(csv);
  } catch (error) {
    console.error('Excel export error:', error);
    res.status(500).json({ success: false, message: 'Error generating Excel file' });
  }
});

// Activity Log API
app.get('/api/admin/activity-log', ensureAuthenticated, ensureAdmin, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;

    // Get recent activities from different collections
    const recentOrders = await Order.find().sort({ createdAt: -1 }).limit(5).populate('user', 'firstName email');
    const recentUsers = await User.find().sort({ createdAt: -1 }).limit(5);
    const recentPlants = await Plant.find().sort({ createdAt: -1 }).limit(5);
    const recentBills = await Bill.find().sort({ createdAt: -1 }).limit(5);

    // Combine and format activities
    let activities = [];

    recentOrders.forEach(order => {
      activities.push({
        type: 'order',
        icon: 'shopping-cart',
        color: 'success',
        title: 'New order placed',
        description: `Order #${order._id.toString().slice(-6)} - ₹${order.totalAmount}`,
        time: order.createdAt,
        user: order.user?.firstName || 'Customer'
      });
    });

    recentPlants.forEach(plant => {
      activities.push({
        type: 'plant',
        icon: 'seedling',
        color: 'primary',
        title: 'Plant added to inventory',
        description: `${plant.name} - ${plant.stock} units`,
        time: plant.createdAt
      });
    });

    recentUsers.forEach(user => {
      activities.push({
        type: 'user',
        icon: 'user-plus',
        color: 'info',
        title: 'New user registered',
        description: user.email,
        time: user.createdAt
      });
    });

    recentBills.forEach(bill => {
      activities.push({
        type: 'bill',
        icon: 'file-invoice',
        color: 'secondary',
        title: 'Bill generated',
        description: `Bill #${bill.billNumber || bill._id.toString().slice(-6)} - ₹${bill.totalAmount}`,
        time: bill.createdAt
      });
    });

    // Sort by time and limit
    activities.sort((a, b) => new Date(b.time) - new Date(a.time));
    activities = activities.slice(0, limit);

    // Add relative time
    activities.forEach(activity => {
      const diff = Date.now() - new Date(activity.time).getTime();
      const minutes = Math.floor(diff / 60000);
      const hours = Math.floor(diff / 3600000);
      const days = Math.floor(diff / 86400000);

      if (minutes < 1) activity.relativeTime = 'Just now';
      else if (minutes < 60) activity.relativeTime = `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
      else if (hours < 24) activity.relativeTime = `${hours} hour${hours > 1 ? 's' : ''} ago`;
      else activity.relativeTime = `${days} day${days > 1 ? 's' : ''} ago`;
    });

    res.json({ success: true, activities });
  } catch (error) {
    console.error('Activity log API error:', error);
    res.status(500).json({ success: false, message: 'Error fetching activity log' });
  }
});

// Bulk Actions API
app.post('/api/admin/bulk-action', ensureAuthenticated, ensureAdmin, async (req, res) => {
  try {
    const { action, model, ids } = req.body;

    if (!action || !model || !ids || !Array.isArray(ids)) {
      return res.status(400).json({ success: false, message: 'Invalid request' });
    }

    let affected = 0;
    let Model;

    // Select model
    switch (model) {
      case 'plants': Model = Plant; break;
      case 'orders': Model = Order; break;
      case 'users': Model = User; break;
      case 'bills': Model = Bill; break;
      default: return res.status(400).json({ success: false, message: 'Invalid model' });
    }

    // Perform bulk action
    switch (action) {
      case 'delete':
        const deleteResult = await Model.deleteMany({ _id: { $in: ids } });
        affected = deleteResult.deletedCount;
        break;

      case 'activate':
        const activateResult = await Model.updateMany(
          { _id: { $in: ids } },
          { $set: { isActive: true } }
        );
        affected = activateResult.modifiedCount;
        break;

      case 'deactivate':
        const deactivateResult = await Model.updateMany(
          { _id: { $in: ids } },
          { $set: { isActive: false } }
        );
        affected = deactivateResult.modifiedCount;
        break;

      case 'update-status':
        if (!req.body.status) {
          return res.status(400).json({ success: false, message: 'Status required' });
        }
        const statusResult = await Model.updateMany(
          { _id: { $in: ids } },
          { $set: { status: req.body.status } }
        );
        affected = statusResult.modifiedCount;
        break;

      default:
        return res.status(400).json({ success: false, message: 'Invalid action' });
    }

    res.json({ success: true, message: `${affected} items ${action}ed successfully`, affected });
  } catch (error) {
    console.error('Bulk action error:', error);
    res.status(500).json({ success: false, message: 'Error performing bulk action' });
  }
});

// Notifications API
app.get('/api/admin/notifications', ensureAuthenticated, ensureAdmin, async (req, res) => {
  try {
    const notifications = [];

    // Low stock notifications
    const lowStockCount = await Plant.countDocuments({ isActive: true, stock: { $lte: 5 } });
    if (lowStockCount > 0) {
      notifications.push({
        type: 'warning',
        icon: 'exclamation-triangle',
        title: 'Low Stock Alert',
        message: `${lowStockCount} plant${lowStockCount > 1 ? 's' : ''} running low on stock`,
        count: lowStockCount,
        link: '/admin/plants',
        priority: 'high'
      });
    }

    // Pending orders notification
    const pendingOrders = await Order.countDocuments({ status: 'pending' });
    if (pendingOrders > 0) {
      notifications.push({
        type: 'info',
        icon: 'clock',
        title: 'Pending Orders',
        message: `${pendingOrders} order${pendingOrders > 1 ? 's' : ''} awaiting processing`,
        count: pendingOrders,
        link: '/admin/orders',
        priority: 'medium'
      });
    }

    // New users today
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const newUsersToday = await User.countDocuments({
      createdAt: { $gte: startOfDay },
      role: 'user'
    });
    if (newUsersToday > 0) {
      notifications.push({
        type: 'success',
        icon: 'user-plus',
        title: 'New Users',
        message: `${newUsersToday} new user${newUsersToday > 1 ? 's' : ''} registered today`,
        count: newUsersToday,
        link: '/admin/users',
        priority: 'low'
      });
    }

    // Out of stock
    const outOfStock = await Plant.countDocuments({ isActive: true, stock: 0 });
    if (outOfStock > 0) {
      notifications.push({
        type: 'danger',
        icon: 'times-circle',
        title: 'Out of Stock',
        message: `${outOfStock} plant${outOfStock > 1 ? 's' : ''} completely out of stock`,
        count: outOfStock,
        link: '/admin/plants',
        priority: 'high'
      });
    }

    res.json({ success: true, notifications, count: notifications.length });
  } catch (error) {
    console.error('Notifications API error:', error);
    res.status(500).json({ success: false, message: 'Error fetching notifications' });
  }
});

// Analytics API
app.get('/api/admin/analytics', ensureAuthenticated, ensureAdmin, async (req, res) => {
  try {
    const period = req.query.period || '30'; // days
    const days = parseInt(period);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // Sales analytics
    const salesByDay = await Order.aggregate([
      { $match: { createdAt: { $gte: startDate } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          orders: { $sum: 1 },
          revenue: { $sum: '$totalAmount' }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // Top selling plants
    const topPlants = await Order.aggregate([
      { $match: { createdAt: { $gte: startDate } } },
      { $unwind: '$items' },
      {
        $group: {
          _id: '$items.name',
          totalSold: { $sum: '$items.quantity' },
          revenue: { $sum: { $multiply: ['$items.quantity', '$items.price'] } }
        }
      },
      { $sort: { totalSold: -1 } },
      { $limit: 10 }
    ]);

    // Customer analytics
    const newCustomers = await User.countDocuments({
      createdAt: { $gte: startDate },
      role: 'user'
    });

    const repeatCustomers = await Order.aggregate([
      { $match: { createdAt: { $gte: startDate } } },
      { $group: { _id: '$user', orders: { $sum: 1 } } },
      { $match: { orders: { $gte: 2 } } },
      { $count: 'count' }
    ]).then(r => r[0]?.count || 0);

    // Category analysis
    const categoryStats = await Plant.aggregate([
      { $match: { isActive: true } },
      {
        $group: {
          _id: '$category',
          count: { $sum: 1 },
          totalStock: { $sum: '$stock' },
          avgPrice: { $avg: '$price' }
        }
      },
      { $sort: { count: -1 } }
    ]);

    res.json({
      success: true,
      analytics: {
        period: days,
        salesByDay,
        topPlants,
        customers: { new: newCustomers, repeat: repeatCustomers },
        categories: categoryStats
      }
    });
  } catch (error) {
    console.error('Analytics API error:', error);
    res.status(500).json({ success: false, message: 'Error fetching analytics' });
  }
});

// Dashboard Settings
app.get('/api/admin/settings', ensureAuthenticated, ensureAdmin, (req, res) => {
  res.json({
    success: true,
    settings: {
      dashboardLayout: req.session.dashboardLayout || 'default',
      chartPeriod: req.session.chartPeriod || 'week',
      notifications: req.session.notificationsEnabled !== false,
      autoRefresh: req.session.autoRefresh || false,
      theme: req.session.theme || 'light'
    }
  });
});

app.post('/api/admin/settings', ensureAuthenticated, ensureAdmin, (req, res) => {
  try {
    const { dashboardLayout, chartPeriod, notifications, autoRefresh, theme } = req.body;

    if (dashboardLayout) req.session.dashboardLayout = dashboardLayout;
    if (chartPeriod) req.session.chartPeriod = chartPeriod;
    if (typeof notifications !== 'undefined') req.session.notificationsEnabled = notifications;
    if (typeof autoRefresh !== 'undefined') req.session.autoRefresh = autoRefresh;
    if (theme) req.session.theme = theme;

    res.json({ success: true, message: 'Settings saved successfully' });
  } catch (error) {
    console.error('Settings save error:', error);
    res.status(500).json({ success: false, message: 'Error saving settings' });
  }
});


// Review Routes
app.post('/reviews/submit', ensureAuthenticated, async (req, res) => {
  try {
    const { plantId, rating, title, comment } = req.body;

    // Validation
    if (!plantId || !rating || !title || !comment) {
      return res.json({ success: false, message: 'Please fill in all fields' });
    }

    if (rating < 1 || rating > 5) {
      return res.json({ success: false, message: 'Rating must be between 1 and 5' });
    }

    // Check if plant exists
    const plant = await Plant.findById(plantId);
    if (!plant) {
      return res.json({ success: false, message: 'Plant not found' });
    }

    // Check if user already reviewed
    const existingReview = await Review.findOne({ user: req.user._id, plant: plantId });
    if (existingReview) {
      return res.json({ success: false, message: 'You have already reviewed this plant' });
    }

    // Check if user has ordered this plant (for verified purchase)
    const hasOrdered = await Order.findOne({
      user: req.user._id,
      'items.name': plant.name,
      status: { $in: ['completed', 'delivered'] }
    });

    // Create review
    const review = new Review({
      user: req.user._id,
      plant: plantId,
      rating: parseInt(rating),
      title: title.trim(),
      comment: comment.trim(),
      isVerified: !!hasOrdered
    });

    await review.save();

    // Update plant ratings
    const ratingStats = await Review.calculateAverageRating(plantId);
    await Plant.findByIdAndUpdate(plantId, {
      'ratings.average': ratingStats.average,
      'ratings.count': ratingStats.count
    });

    res.json({ success: true, message: 'Review submitted successfully' });
  } catch (error) {
    console.error('Review submission error:', error);
    res.json({ success: false, message: 'Error submitting review' });
  }
});

app.post('/reviews/:id/helpful', ensureAuthenticated, async (req, res) => {
  try {
    const review = await Review.findById(req.params.id);
    if (!review) {
      return res.json({ success: false, message: 'Review not found' });
    }

    // Check if user already marked as helpful
    const hasMarked = review.helpful.users.some(
      userId => userId.toString() === req.user._id.toString()
    );

    if (hasMarked) {
      return res.json({ success: false, message: 'You have already marked this as helpful' });
    }

    // Add user to helpful list
    review.helpful.users.push(req.user._id);
    review.helpful.count += 1;
    await review.save();

    res.json({ success: true, count: review.helpful.count });
  } catch (error) {
    console.error('Helpful review error:', error);
    res.json({ success: false, message: 'Error marking review as helpful' });
  }
});

// Image serving routes
app.get('/images/:imageName', async (req, res) => {
  try {
    const imageName = req.params.imageName;
    const image = await ImageService.getImage(imageName);

    if (!image) {
      // If image not found in database, try to serve from file system
      const fs = require('fs');
      const path = require('path');
      const filePath = path.join(__dirname, 'public/images', imageName);

      if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
      } else {
        res.status(404).send('Image not found');
      }
      return;
    }

    // Serve image from database
    res.set('Content-Type', image.contentType);
    res.set('Cache-Control', 'public, max-age=31536000'); // Cache for 1 year
    res.send(image.data);
  } catch (error) {
    console.error('Error serving image:', error);
    res.status(500).send('Error serving image');
  }
});

// Image management API routes
app.get('/api/images', async (req, res) => {
  try {
    const images = await ImageService.getAllImages();
    res.json({
      success: true,
      images: images.map(img => ({
        name: img.name,
        filename: img.filename,
        contentType: img.contentType,
        size: img.size,
        uploadedAt: img.uploadedAt
      }))
    });
  } catch (error) {
    console.error('Error fetching images:', error);
    res.status(500).json({ success: false, error: 'Error fetching images' });
  }
});

// Settings Management
app.get('/admin/settings', ensureAuthenticated, ensureAdmin, (req, res) => {
  try {
    const settings = {
      appName: process.env.APP_NAME || 'SRI LALITAMBA NURSERY & GARDENS',
      appUrl: process.env.APP_URL || 'http://localhost:3000',
      adminEmail: process.env.ADMIN_EMAIL || 'lalitambanursery@gmail.com',
      supportPhone: '+91 99633 72123',
      contactPhone: '+91 99633 72123',
      contactMobile: '+91 99633 72123',
      contactEmail: 'lalitambanursery@gmail.com',
      weekdaysHours: '6:00 AM - 6:00 PM',
      weekendHours: '7:00 AM - 1:00 PM',
      address: 'Gandhinagaram, Near Kadiypulanka, Chemudulanka - 533 234, East Godavari District, Andhra Pradesh',
      businessDescription: 'Transform your space with nature\'s finest. Since 2007, we\'ve been dedicated to providing premium quality exotic flora and expert landscaping solutions for your dream spaces.'
    };

    res.render('admin/settings', {
      title: 'Settings - SRI LALITAMBA NURSERY & GARDENS',
      settings,
      dbConnected: req.dbConnected,
      user: req.user,
      page: 'settings',
      nodeEnv: process.env.NODE_ENV || 'development',
      nodeVersion: process.version,
      port: process.env.PORT || 3000,
      messages: {
        success: req.flash('success_msg'),
        error: req.flash('error_msg')
      }
    });
  } catch (error) {
    console.error('Settings page error:', error);
    req.flash('error_msg', 'Error loading settings');
    res.redirect('/admin/dashboard');
  }
});

app.post('/admin/settings/update', ensureAuthenticated, ensureAdmin, async (req, res) => {
  try {
    const {
      appName,
      appUrl,
      adminEmail,
      supportPhone,
      contactPhone,
      contactMobile,
      contactEmail,
      weekdaysHours,
      weekendHours,
      address,
      businessDescription
    } = req.body;

    // Update environment variables
    if (appName) process.env.APP_NAME = appName;
    if (appUrl) process.env.APP_URL = appUrl;
    if (adminEmail) process.env.ADMIN_EMAIL = adminEmail;

    // Note: In production, you would update the .env file here

    req.flash('success_msg', 'Settings updated successfully!');
    res.redirect('/admin/settings');
  } catch (error) {
    console.error('Settings update error:', error);
    req.flash('error_msg', 'Error updating settings');
    res.redirect('/admin/settings');
  }
});

app.use((req, res, next) => {
  res.status(404).render('404', {
    title: 'Page Not Found',
    user: req.user,
    dbConnected: req.dbConnected
  });
});

// Enhanced error handling middleware
app.use((error, req, res, next) => {
  console.error('=== SERVER ERROR ===');
  console.error('Error:', error);
  console.error('Stack:', error.stack);
  console.error('URL:', req.url);
  console.error('Method:', req.method);
  console.error('DB Connected:', req.dbConnected);
  console.error('==================');

  // Handle specific database errors
  if (error.name === 'MongooseError' || error.name === 'MongoError' || error.name === 'MongooseServerSelectionError') {
    console.log('Database error detected, rendering database error page');
    return res.status(503).render('500', {
      title: 'Database Connection Error',
      error: 'MongoDB Atlas connection error',
      message: 'Our cloud database is temporarily unavailable. Please check your internet connection and refresh the page.',
      dbConnected: false,
      user: req.user
    });
  }

  // Handle validation errors
  if (error.name === 'ValidationError') {
    console.log('Validation error detected');
    return res.status(400).render('500', {
      title: 'Validation Error',
      error: 'Data validation error',
      message: 'There was an error with the data provided. Please check your input and try again.',
      dbConnected: req.dbConnected,
      user: req.user
    });
  }

  // Handle other errors
  res.status(500).render('500', {
    title: 'Server Error',
    error: error.message || 'Internal server error',
    message: 'Our gardeners are working hard to fix a glitch in the system. Please try again in a few minutes.',
    dbConnected: req.dbConnected,
    user: req.user
  });
});

// 404 handler
app.use((req, res, next) => {
  res.status(404).render('404', {
    title: 'Page Not Found',
    dbConnected: req.dbConnected,
    user: req.user
  });
});

// Dashboard Revenue Chart Data
app.get('/api/admin/dashboard/revenue-chart', ensureAuthenticated, ensureAdmin, async (req, res) => {
  try {
    const period = req.query.period || 'week';
    const days = period === 'month' ? 30 : 7;
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - days);

    // Aggregate daily revenue from Bills
    const revenueData = await Bill.aggregate([
      {
        $match: {
          date: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$date" } },
          total: { $sum: "$totalAmount" }
        }
      },
      { $sort: { "_id": 1 } }
    ]);

    // Format for Chart.js
    const labels = [];
    const data = [];
    const dateMap = new Map(revenueData.map(item => [item._id, item.total]));

    for (let i = days; i >= 0; i--) {
      const d = new Date();
      d.setDate(endDate.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const label = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
      
      labels.push(label);
      data.push(dateMap.get(dateStr) || 0);
    }

    res.json({ success: true, labels, data });
  } catch (error) {
    console.error('Revenue Chart API Error:', error);
    res.status(500).json({ success: false, message: 'Error fetching revenue data' });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Visit: http://localhost:${PORT}`);
});

module.exports = app;
