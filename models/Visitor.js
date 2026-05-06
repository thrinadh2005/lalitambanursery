const mongoose = require('mongoose');

const visitorSchema = new mongoose.Schema({
  ip: {
    type: String,
    required: true,
    index: true
  },
  userAgent: {
    type: String,
    default: ''
  },
  path: {
    type: String,
    default: '/'
  },
  visitedAt: {
    type: Date,
    default: Date.now,
    index: true
  }
});

// Compound index for efficient unique-IP-per-day queries
visitorSchema.index({ ip: 1, visitedAt: -1 });

module.exports = mongoose.model('Visitor', visitorSchema);
