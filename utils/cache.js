const NodeCache = require('node-cache');
const logger = require('../utils/logger');
const config = require('../config');

// Cache configuration
const cacheConfig = {
  stdTTL: 300, // 5 minutes default TTL
  checkperiod: 60, // Check for expired keys every 60 seconds
  useClones: false, // Better performance
  deleteOnExpire: true,
  enableLegacyCallbacks: false,
  maxKeys: 1000 // Maximum number of keys
};

// Create cache instances for different purposes
const caches = {
  // General application cache
  app: new NodeCache(cacheConfig),
  
  // User-specific cache (shorter TTL)
  user: new NodeCache({
    ...cacheConfig,
    stdTTL: 180, // 3 minutes
    maxKeys: 500
  }),
  
  // Plant data cache (longer TTL)
  plants: new NodeCache({
    ...cacheConfig,
    stdTTL: 600, // 10 minutes
    maxKeys: 200
  }),
  
  // Static content cache (longest TTL)
  static: new NodeCache({
    ...cacheConfig,
    stdTTL: 3600, // 1 hour
    maxKeys: 100
  })
};

// Cache middleware factory
const cacheMiddleware = (cacheName, keyGenerator, ttl) => {
  return (req, res, next) => {
    const cache = caches[cacheName];
    if (!cache) {
      return next();
    }

    const key = keyGenerator(req);
    const cachedData = cache.get(key);

    if (cachedData) {
      logger.debug(`Cache hit for key: ${key}`);
      return res.json(cachedData);
    }

    // Store original res.json
    const originalJson = res.json;
    
    // Override res.json to cache response
    res.json = function(data) {
      // Only cache successful responses
      if (res.statusCode === 200) {
        cache.set(key, data, ttl);
        logger.debug(`Cache set for key: ${key}`);
      }
      return originalJson.call(this, data);
    };

    next();
  };
};

// Cache helper functions
const cacheHelpers = {
  // Get value from cache
  get: (cacheName, key) => {
    const cache = caches[cacheName];
    return cache ? cache.get(key) : null;
  },

  // Set value in cache
  set: (cacheName, key, value, ttl) => {
    const cache = caches[cacheName];
    if (cache) {
      return cache.set(key, value, ttl);
    }
    return false;
  },

  // Delete value from cache
  del: (cacheName, key) => {
    const cache = caches[cacheName];
    if (cache) {
      return cache.del(key);
    }
    return 0;
  },

  // Clear cache
  flush: (cacheName) => {
    const cache = caches[cacheName];
    if (cache) {
      return cache.flushAll();
    }
    return false;
  },

  // Get cache stats
  stats: (cacheName) => {
    const cache = caches[cacheName];
    if (cache) {
      return cache.getStats();
    }
    return null;
  },

  // Cache invalidation patterns
  invalidatePattern: (cacheName, pattern) => {
    const cache = caches[cacheName];
    if (!cache) return 0;

    const keys = cache.keys();
    const regex = new RegExp(pattern);
    const keysToDelete = keys.filter(key => regex.test(key));
    
    return cache.del(keysToDelete);
  }
};

// Key generators for different routes
const keyGenerators = {
  // Plants gallery cache key
  plantsGallery: (req) => {
    const { page = 1, category, minPrice, maxPrice, size, searchQuery } = req.query;
    return `plants_gallery_${page}_${category || 'all'}_${minPrice || '0'}_${maxPrice || '999999'}_${size || 'all'}_${searchQuery || 'none'}`;
  },

  // Plant details cache key
  plantDetails: (req) => {
    return `plant_details_${req.params.id}`;
  },

  // User orders cache key
  userOrders: (req) => {
    const { page = 1, status } = req.query;
    return `user_orders_${req.user.id}_${page}_${status || 'all'}`;
  },

  // Admin dashboard stats cache key
  adminStats: () => {
    return 'admin_dashboard_stats';
  },

  // Featured plants cache key
  featuredPlants: () => {
    return 'featured_plants';
  }
};

// Cache invalidation helpers
const cacheInvalidation = {
  // Invalidate plant-related caches
  invalidatePlants: (plantId) => {
    cacheHelpers.invalidatePattern('plants', 'plants_gallery_.*');
    cacheHelpers.invalidatePattern('static', 'featured_plants');
    if (plantId) {
      cacheHelpers.del('plants', `plant_details_${plantId}`);
    }
  },

  // Invalidate user-related caches
  invalidateUser: (userId) => {
    cacheHelpers.invalidatePattern('user', `user_orders_${userId}_.*`);
  },

  // Invalidate admin caches
  invalidateAdmin: () => {
    cacheHelpers.invalidatePattern('app', 'admin_.*');
    cacheHelpers.invalidatePattern('static', 'featured_plants');
  },

  // Invalidate all caches
  invalidateAll: () => {
    Object.keys(caches).forEach(cacheName => {
      cacheHelpers.flush(cacheName);
    });
    logger.info('All caches flushed');
  }
};

// Cache warming functions
const cacheWarming = {
  // Warm up frequently accessed data
  warmUpCommonData: async () => {
    try {
      const Plant = require('../models/Plant');
      
      // Cache featured plants
      const featuredPlants = await Plant.find({ isActive: true, featured: true })
        .limit(6)
        .sort({ createdAt: -1 })
        .lean();
      
      cacheHelpers.set('static', 'featured_plants', featuredPlants, 3600);
      
      logger.info('Cache warming completed for common data');
    } catch (error) {
      logger.error('Error during cache warming:', error);
    }
  }
};

// Cache monitoring
const cacheMonitoring = {
  // Log cache statistics periodically
  logStats: () => {
    Object.keys(caches).forEach(cacheName => {
      const stats = cacheHelpers.stats(cacheName);
      if (stats) {
        logger.info(`Cache stats for ${cacheName}:`, {
          keys: stats.keys,
          hits: stats.hits,
          misses: stats.misses,
          hitRate: stats.hits > 0 ? (stats.hits / (stats.hits + stats.misses) * 100).toFixed(2) + '%' : '0%',
          ksize: stats.ksize,
          vsize: stats.vsize
        });
      }
    });
  },

  // Health check for caches
  healthCheck: () => {
    const health = {};
    Object.keys(caches).forEach(cacheName => {
      const cache = caches[cacheName];
      health[cacheName] = {
        status: 'healthy',
        keys: cache.keys().length,
        memoryUsage: cache.getStats().ksize + cache.getStats().vsize
      };
    });
    return health;
  }
};

// Set up periodic cache monitoring
if (config.env === 'production') {
  setInterval(() => {
    cacheMonitoring.logStats();
  }, 5 * 60 * 1000); // Log every 5 minutes
}

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('Closing caches...');
  Object.keys(caches).forEach(cacheName => {
    caches[cacheName].close();
  });
});

process.on('SIGINT', () => {
  logger.info('Closing caches...');
  Object.keys(caches).forEach(cacheName => {
    caches[cacheName].close();
  });
});

module.exports = {
  cacheMiddleware,
  cacheHelpers,
  cacheInvalidation,
  cacheWarming,
  cacheMonitoring,
  keyGenerators,
  caches
};
