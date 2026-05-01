const mongoose = require('mongoose');

const importExportItemSchema = new mongoose.Schema({
  plant: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Plant'
  },
  customPlantName: {
    type: String,
    trim: true
  },
  quantity: {
    type: Number,
    required: true,
    min: 1
  },
  unitPrice: {
    type: Number,
    required: true,
    min: 0
  },
  totalPrice: {
    type: Number,
    required: true,
    min: 0
  },
  description: {
    type: String,
    trim: true
  },
  category: {
    type: String,
    enum: ['seeds', 'saplings', 'plants', 'equipment', 'supplies', 'fertilizers', 'pesticides'],
    default: 'plants'
  }
});

const importExportSchema = new mongoose.Schema({
  type: {
    type: String,
    required: true,
    enum: ['import', 'export']
  },
  referenceNumber: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    uppercase: true
  },
  transactionDate: {
    type: Date,
    default: Date.now,
    required: true
  },
  partner: {
    name: {
      type: String,
      required: true,
      trim: true
    },
    company: {
      type: String,
      trim: true
    },
    contact: {
      type: String,
      trim: true
    },
    email: {
      type: String,
      trim: true,
      lowercase: true
    },
    address: {
      street: String,
      city: String,
      state: String,
      country: {
        type: String,
        default: 'India'
      },
      postalCode: String
    }
  },
  items: [importExportItemSchema],
  totalQuantity: {
    type: Number,
    default: 0
  },
  totalAmount: {
    type: Number,
    required: true,
    min: 0
  },
  currency: {
    type: String,
    default: 'INR',
    enum: ['INR', 'USD', 'EUR', 'GBP']
  },
  exchangeRate: {
    type: Number,
    min: 0,
    default: 1
  },
  paymentTerms: {
    type: String,
    enum: ['immediate', '7_days', '15_days', '30_days', '45_days', '60_days', 'custom'],
    default: '30_days'
  },
  customPaymentTerms: {
    type: String,
    trim: true
  },
  shippingDetails: {
    method: {
      type: String,
      enum: ['air', 'sea', 'land', 'courier'],
      default: 'land'
    },
    carrier: {
      type: String,
      trim: true
    },
    trackingNumber: {
      type: String,
      trim: true
    },
    estimatedDelivery: Date,
    actualDelivery: Date,
    cost: {
      type: Number,
      min: 0
    }
  },
  customsDetails: {
    declarationNumber: {
      type: String,
      trim: true
    },
    dutyAmount: {
      type: Number,
      min: 0
    },
    clearanceDate: Date,
    documents: [{
      type: {
        type: String,
        enum: ['invoice', 'packing_list', 'certificate', 'permit', 'insurance'],
        required: true
      },
      url: {
        type: String,
        required: true
      },
      filename: {
        type: String,
        required: true
      },
      uploadedAt: {
        type: Date,
        default: Date.now
      }
    }]
  },
  status: {
    type: String,
    enum: ['draft', 'confirmed', 'in_transit', 'delivered', 'cancelled', 'on_hold'],
    default: 'draft'
  },
  priority: {
    type: String,
    enum: ['low', 'normal', 'high', 'urgent'],
    default: 'normal'
  },
  notes: {
    type: String,
    trim: true
  },
  recordedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Indexes for better performance
importExportSchema.index({ type: 1, transactionDate: -1 });
importExportSchema.index({ referenceNumber: 1 });
importExportSchema.index({ 'partner.name': 1 });
importExportSchema.index({ status: 1 });
importExportSchema.index({ recordedBy: 1 });

// Virtual for formatted transaction date
importExportSchema.virtual('formattedTransactionDate').get(function() {
  return this.transactionDate.toLocaleDateString('en-IN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
});

// Virtual for status badge
importExportSchema.virtual('statusBadge').get(function() {
  const badges = {
    draft: 'secondary',
    confirmed: 'info',
    in_transit: 'warning',
    delivered: 'success',
    cancelled: 'danger',
    on_hold: 'warning'
  };
  return badges[this.status] || 'secondary';
});

// Virtual for priority badge
importExportSchema.virtual('priorityBadge').get(function() {
  const badges = {
    low: 'secondary',
    normal: 'info',
    high: 'warning',
    urgent: 'danger'
  };
  return badges[this.priority] || 'secondary';
});

// Pre-save middleware to calculate totals
importExportSchema.pre('save', function(next) {
  this.totalQuantity = this.items.reduce((total, item) => total + item.quantity, 0);
  this.totalAmount = this.items.reduce((total, item) => total + item.totalPrice, 0);
  next();
});

// Static method to get import/export summary
importExportSchema.statics.getSummary = async function(startDate, endDate) {
  const matchConditions = {
    isActive: true,
    transactionDate: { $gte: startDate, $lte: endDate }
  };

  const result = await this.aggregate([
    { $match: matchConditions },
    {
      $group: {
        _id: {
          type: '$type',
          month: { $month: '$transactionDate' },
          year: { $year: '$transactionDate' }
        },
        totalAmount: { $sum: '$totalAmount' },
        totalQuantity: { $sum: '$totalQuantity' },
        count: { $sum: 1 }
      }
    },
    {
      $sort: { '_id.year': 1, '_id.month': 1, '_id.type': 1 }
    }
  ]);

  return result;
};

// Static method to get top partners
importExportSchema.statics.getTopPartners = async function(type, limit = 10) {
  const result = await this.aggregate([
    {
      $match: {
        type: type,
        isActive: true,
        status: { $in: ['delivered', 'confirmed'] }
      }
    },
    {
      $group: {
        _id: '$partner.name',
        totalAmount: { $sum: '$totalAmount' },
        totalTransactions: { $sum: 1 },
        lastTransaction: { $max: '$transactionDate' }
      }
    },
    {
      $sort: { totalAmount: -1 }
    },
    {
      $limit: limit
    }
  ]);

  return result;
};

module.exports = mongoose.model('ImportExport', importExportSchema);
