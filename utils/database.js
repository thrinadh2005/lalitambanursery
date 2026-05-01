const mongoose = require('mongoose');
const logger = require('../utils/logger');

// Database indexes for performance optimization
const createIndexes = async () => {
  try {
    const db = mongoose.connection.db;
    
    // Users collection indexes
    await db.collection('users').createIndexes([
      { key: { email: 1 }, unique: true },
      { key: { username: 1 }, unique: true },
      { key: { role: 1 } },
      { key: { createdAt: -1 } },
      { key: { isActive: 1 } }
    ]);
    
    // Plants collection indexes
    await db.collection('plants').createIndexes([
      { key: { name: 'text', description: 'text' } }, // Text search
      { key: { category: 1 } },
      { key: { price: 1 } },
      { key: { stock: 1 } },
      { key: { size: 1 } },
      { key: { isActive: 1 } },
      { key: { createdAt: -1 } },
      { key: { category: 1, isActive: 1, createdAt: -1 } }, // Compound index
      { key: { price: 1, isActive: 1 } } // Compound index
    ]);
    
    // Orders collection indexes
    await db.collection('orders').createIndexes([
      { key: { user: 1 } },
      { key: { status: 1 } },
      { key: { createdAt: -1 } },
      { key: { totalAmount: 1 } },
      { key: { 'items.plant': 1 } },
      { key: { user: 1, createdAt: -1 } }, // Compound index for user orders
      { key: { status: 1, createdAt: -1 } }, // Compound index for admin orders
      { key: { paymentStatus: 1 } }
    ]);
    
    // Carts collection indexes
    await db.collection('carts').createIndexes([
      { key: { user: 1 }, unique: true },
      { key: { createdAt: -1 } }
    ]);
    
    // Bills collection indexes
    await db.collection('bills').createIndexes([
      { key: { billNumber: 1 }, unique: true },
      { key: { customerName: 'text', customerPhone: 1 } },
      { key: { createdAt: -1 } },
      { key: { totalAmount: 1 } },
      { key: { paymentStatus: 1 } },
      { key: { status: 1 } }
    ]);
    
    // Expenses collection indexes
    await db.collection('expenses').createIndexes([
      { key: { category: 1 } },
      { key: { amount: 1 } },
      { key: { date: -1 } },
      { key: { isActive: 1 } },
      { key: { category: 1, date: -1 } } // Compound index
    ]);
    
    // Investments collection indexes
    await db.collection('investments').createIndexes([
      { key: { type: 1 } },
      { key: { amount: 1 } },
      { key: { date: -1 } },
      { key: { isActive: 1 } }
    ]);
    
    // ImportExport collection indexes
    await db.collection('importexports').createIndexes([
      { key: { type: 1 } },
      { key: { date: -1 } },
      { key: { totalAmount: 1 } },
      { key: { isActive: 1 } }
    ]);
    
    logger.info('✅ Database indexes created successfully');
    
  } catch (error) {
    logger.error('❌ Error creating database indexes:', error);
    throw error;
  }
};

// Database query optimization functions
const optimizationHelpers = {
  // Optimized plant search with pagination
  searchPlants: async (query = {}, options = {}) => {
    const {
      page = 1,
      limit = 12,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      category,
      minPrice,
      maxPrice,
      size,
      searchQuery
    } = options;
    
    // Build search filter
    const filter = { isActive: true };
    
    if (category) filter.category = category;
    if (size) filter.size = size;
    if (minPrice || maxPrice) {
      filter.price = {};
      if (minPrice) filter.price.$gte = minPrice;
      if (maxPrice) filter.price.$lte = maxPrice;
    }
    
    if (searchQuery) {
      filter.$text = { $search: searchQuery };
    }
    
    // Build sort options
    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;
    
    // If text search, add score to sort
    if (searchQuery) {
      sort.score = { $meta: 'textScore' };
    }
    
    const skip = (page - 1) * limit;
    
    try {
      const [plants, total] = await Promise.all([
        mongoose.model('Plant')
          .find(filter)
          .sort(sort)
          .skip(skip)
          .limit(limit)
          .lean(), // Use lean for better performance
        mongoose.model('Plant').countDocuments(filter)
      ]);
      
      return {
        plants,
        pagination: {
          current: page,
          pages: Math.ceil(total / limit),
          total,
          limit
        }
      };
    } catch (error) {
      logger.error('Error in optimized plant search:', error);
      throw error;
    }
  },
  
  // Optimized user orders with aggregation
  getUserOrders: async (userId, options = {}) => {
    const { page = 1, limit = 10, status } = options;
    const skip = (page - 1) * limit;
    
    const matchStage = { user: mongoose.Types.ObjectId(userId) };
    if (status) matchStage.status = status;
    
    try {
      const result = await mongoose.model('Order').aggregate([
        { $match: matchStage },
        { $sort: { createdAt: -1 } },
        { $skip: skip },
        { $limit: limit },
        {
          $lookup: {
            from: 'plants',
            localField: 'items.plant',
            foreignField: '_id',
            as: 'plantDetails'
          }
        },
        {
          $addFields: {
            items: {
              $map: {
                input: '$items',
                as: 'item',
                in: {
                  $mergeObjects: [
                    '$$item',
                    {
                      $arrayElemAt: [
                        {
                          $filter: {
                            input: '$plantDetails',
                            cond: { $eq: ['$$this._id', '$$item.plant'] }
                          }
                        },
                        0
                      ]
                    }
                  ]
                }
              }
            }
          }
        },
        { $project: { plantDetails: 0 } },
        {
          $facet: {
            orders: [],
            totalCount: [{ $count: 'count' }]
          }
        }
      ]);
      
      const orders = result[0].orders;
      const totalCount = result[0].totalCount[0]?.count || 0;
      
      return {
        orders,
        pagination: {
          current: page,
          pages: Math.ceil(totalCount / limit),
          total: totalCount,
          limit
        }
      };
    } catch (error) {
      logger.error('Error in optimized user orders:', error);
      throw error;
    }
  }
};

module.exports = {
  createIndexes,
  optimizationHelpers
};
