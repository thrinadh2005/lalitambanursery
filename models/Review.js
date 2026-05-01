const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  plant: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Plant',
    required: false // Optional for general nursery reviews
  },
  type: {
    type: String,
    enum: ['plant', 'nursery'],
    default: 'plant'
  },
  order: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order'
  },
  rating: {
    type: Number,
    required: true,
    min: 1,
    max: 5
  },
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  comment: {
    type: String,
    required: true,
    trim: true,
    maxlength: 500
  },
  images: [{
    url: {
      type: String,
      required: true
    },
    alt: {
      type: String,
      default: ''
    }
  }],
  isVerified: {
    type: Boolean,
    default: false
  },
  helpful: {
    count: {
      type: Number,
      default: 0
    },
    users: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }]
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Compound index to ensure one review per user per plant
reviewSchema.index({ user: 1, plant: 1 }, { unique: true });
reviewSchema.index({ plant: 1, rating: -1 });
reviewSchema.index({ createdAt: -1 });

// Virtual for formatted date
reviewSchema.virtual('formattedDate').get(function () {
  return this.createdAt.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
});

// Method to check if user has already reviewed this plant
reviewSchema.statics.hasUserReviewed = async function (userId, plantId) {
  const review = await this.findOne({ user: userId, plant: plantId });
  return !!review;
};

// Method to calculate average rating for a plant
reviewSchema.statics.calculateAverageRating = async function (plantId) {
  const result = await this.aggregate([
    { $match: { plant: new mongoose.Types.ObjectId(plantId), isActive: true } },
    {
      $group: {
        _id: '$plant',
        averageRating: { $avg: '$rating' },
        totalReviews: { $sum: 1 }
      }
    }
  ]);

  return result.length > 0 ? {
    average: Math.round(result[0].averageRating * 10) / 10,
    count: result[0].totalReviews
  } : { average: 0, count: 0 };
};

module.exports = mongoose.model('Review', reviewSchema);
