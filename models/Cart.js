const mongoose = require('mongoose');

const cartItemSchema = new mongoose.Schema({
  plant: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Plant',
    required: true
  },

  name: {
    type: String,
    required: true
  },
  image: {
    type: String,
    default: ''
  },
  addedAt: {
    type: Date,
    default: Date.now
  }
});

const cartSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  items: [cartItemSchema],

  lastUpdated: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Update totals before saving
cartSchema.pre('save', function(next) {
  this.lastUpdated = new Date();
  next();
});

// Index for better performance
cartSchema.index({ user: 1 });
cartSchema.index({ lastUpdated: -1 });

module.exports = mongoose.model('Cart', cartSchema);
