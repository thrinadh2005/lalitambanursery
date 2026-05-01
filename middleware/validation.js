const Joi = require('joi');
const logger = require('../utils/logger');

// Generic validation middleware
const validate = (schema, property = 'body') => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req[property], {
      abortEarly: false,
      stripUnknown: true
    });

    if (error) {
      const errorMessage = error.details.map(detail => detail.message).join(', ');
      logger.warn(`Validation error: ${errorMessage}`, {
        ip: req.ip,
        url: req.originalUrl,
        method: req.method,
        body: req.body
      });
      
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: error.details.map(detail => ({
          field: detail.path.join('.'),
          message: detail.message
        }))
      });
    }

    req[property] = value;
    next();
  };
};

// Validation schemas
const schemas = {
  // User registration
  register: Joi.object({
    firstName: Joi.string().trim().min(2).max(50).required(),
    lastName: Joi.string().trim().min(2).max(50).required(),
    email: Joi.string().email().required(),
    username: Joi.string().alphanum().min(3).max(30).required(),
    password: Joi.string().min(6).required(),
    confirmPassword: Joi.string().valid(Joi.ref('password')).required(),
    phone: Joi.string().pattern(/^[0-9]{10}$/).optional(),
    address: Joi.string().max(200).optional()
  }),

  // User login
  login: Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().required()
  }),

  // Plant creation/update
  plant: Joi.object({
    name: Joi.string().trim().min(1).max(100).required(),
    description: Joi.string().min(10).max(2000).required(),
    category: Joi.string().valid('herbs', 'flowers', 'vegetables', 'fruits', 'trees', 'shrubs', 'indoor', 'outdoor').required(),
    price: Joi.number().positive().precision(2).required(),
    stock: Joi.number().integer().min(0).required(),
    size: Joi.string().valid('small', 'medium', 'large', 'extra-large').required(),
    careInstructions: Joi.string().max(1000).optional(),
    wateringFrequency: Joi.string().valid('daily', 'weekly', 'bi-weekly', 'monthly').optional(),
    sunlight: Joi.string().valid('full-sun', 'partial-sun', 'shade').optional(),
    soilType: Joi.string().max(100).optional(),
    isActive: Joi.boolean().default(true)
  }),

  // Order creation
  order: Joi.object({
    items: Joi.array().items(
      Joi.object({
        plant: Joi.string().hex().length(24).required(),
        quantity: Joi.number().integer().min(1).max(100).required(),
        size: Joi.string().valid('small', 'medium', 'large', 'extra-large').required()
      })
    ).min(1).required(),
    shippingAddress: Joi.object({
      fullName: Joi.string().trim().min(2).max(100).required(),
      address: Joi.string().trim().min(5).max(200).required(),
      city: Joi.string().trim().min(2).max(50).required(),
      state: Joi.string().trim().min(2).max(50).required(),
      zipCode: Joi.string().pattern(/^[0-9]{6}$/).required(),
      country: Joi.string().default('India'),
      phone: Joi.string().pattern(/^[0-9]{10}$/).required()
    }).required(),
    paymentMethod: Joi.string().valid('cod', 'online').default('cod'),
    notes: Joi.string().max(500).optional()
  }),

  // Order status update
  orderStatus: Joi.object({
    status: Joi.string().valid('pending', 'processing', 'shipped', 'delivered', 'cancelled').required()
  }),

  // Contact form
  contact: Joi.object({
    name: Joi.string().trim().min(2).max(100).required(),
    email: Joi.string().email().required(),
    subject: Joi.string().trim().min(5).max(200).required(),
    message: Joi.string().min(10).max(1000).required(),
    phone: Joi.string().pattern(/^[0-9]{10}$/).optional()
  }),

  // Search and filter
  search: Joi.object({
    query: Joi.string().trim().min(1).max(100).optional(),
    category: Joi.string().valid('herbs', 'flowers', 'vegetables', 'fruits', 'trees', 'shrubs', 'indoor', 'outdoor').optional(),
    minPrice: Joi.number().min(0).optional(),
    maxPrice: Joi.number().positive().optional(),
    size: Joi.string().valid('small', 'medium', 'large', 'extra-large').optional(),
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(50).default(12),
    sortBy: Joi.string().valid('name', 'price', 'createdAt', 'stock').default('createdAt'),
    sortOrder: Joi.string().valid('asc', 'desc').default('desc')
  }),

  // Password change
  passwordChange: Joi.object({
    currentPassword: Joi.string().required(),
    newPassword: Joi.string().min(6).required(),
    confirmPassword: Joi.string().valid(Joi.ref('newPassword')).required()
  }),

  // Profile update
  profileUpdate: Joi.object({
    firstName: Joi.string().trim().min(2).max(50).optional(),
    lastName: Joi.string().trim().min(2).max(50).optional(),
    phone: Joi.string().pattern(/^[0-9]{10}$/).optional(),
    address: Joi.string().max(200).optional()
  }).min(1)
};

module.exports = {
  validate,
  schemas
};
