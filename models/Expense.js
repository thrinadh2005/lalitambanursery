const mongoose = require('mongoose');

const expenseSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  description: {
    type: String,
    trim: true,
    maxlength: 500
  },
  category: {
    type: String,
    required: true,
    enum: [
      'labor',
      'utilities',
      'maintenance',
      'supplies',
      'transportation',
      'marketing',
      'insurance',
      'taxes',
      'equipment',
      'pest_control',
      'fertilizers',
      'seeds',
      'packaging',
      'other'
    ],
    default: 'other'
  },
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  currency: {
    type: String,
    default: 'INR',
    enum: ['INR', 'USD', 'EUR']
  },
  expenseDate: {
    type: Date,
    default: Date.now,
    required: true
  },
  paymentMethod: {
    type: String,
    enum: ['cash', 'card', 'bank_transfer', 'upi', 'cheque'],
    default: 'cash'
  },
  vendor: {
    name: {
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
    }
  },
  receipt: {
    url: String,
    filename: String
  },
  tags: [{
    type: String,
    trim: true
  }],
  isRecurring: {
    type: Boolean,
    default: false
  },
  recurringFrequency: {
    type: String,
    enum: ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'],
    required: function() {
      return this.isRecurring;
    }
  },
  nextDueDate: {
    type: Date
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
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'paid'],
    default: 'pending'
  },
  notes: {
    type: String,
    trim: true
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Indexes for better performance
expenseSchema.index({ category: 1, expenseDate: -1 });
expenseSchema.index({ recordedBy: 1 });
expenseSchema.index({ status: 1 });
expenseSchema.index({ expenseDate: -1 });
expenseSchema.index({ isRecurring: 1, nextDueDate: 1 });

// Virtual for formatted expense date
expenseSchema.virtual('formattedExpenseDate').get(function() {
  return this.expenseDate.toLocaleDateString('en-IN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
});

// Virtual for status badge
expenseSchema.virtual('statusBadge').get(function() {
  const badges = {
    pending: 'warning',
    approved: 'info',
    rejected: 'danger',
    paid: 'success'
  };
  return badges[this.status] || 'secondary';
});

// Pre-save middleware for recurring expenses
expenseSchema.pre('save', function(next) {
  if (this.isRecurring && this.isModified('expenseDate')) {
    const nextDate = new Date(this.expenseDate);

    switch (this.recurringFrequency) {
      case 'daily':
        nextDate.setDate(nextDate.getDate() + 1);
        break;
      case 'weekly':
        nextDate.setDate(nextDate.getDate() + 7);
        break;
      case 'monthly':
        nextDate.setMonth(nextDate.getMonth() + 1);
        break;
      case 'quarterly':
        nextDate.setMonth(nextDate.getMonth() + 3);
        break;
      case 'yearly':
        nextDate.setFullYear(nextDate.getFullYear() + 1);
        break;
    }

    this.nextDueDate = nextDate;
  }
  next();
});

// Static method to get monthly expense summary
expenseSchema.statics.getMonthlySummary = async function(year, month) {
  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 1);

  const result = await this.aggregate([
    {
      $match: {
        expenseDate: { $gte: startDate, $lt: endDate },
        status: 'paid',
        isActive: true
      }
    },
    {
      $group: {
        _id: '$category',
        totalAmount: { $sum: '$amount' },
        count: { $sum: 1 }
      }
    },
    {
      $sort: { totalAmount: -1 }
    }
  ]);

  return result;
};

// Static method to get expense trends
expenseSchema.statics.getExpenseTrends = async function(months = 6) {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - months);

  const result = await this.aggregate([
    {
      $match: {
        expenseDate: { $gte: startDate, $lte: endDate },
        status: 'paid',
        isActive: true
      }
    },
    {
      $group: {
        _id: {
          year: { $year: '$expenseDate' },
          month: { $month: '$expenseDate' }
        },
        totalAmount: { $sum: '$amount' },
        count: { $sum: 1 }
      }
    },
    {
      $sort: { '_id.year': 1, '_id.month': 1 }
    }
  ]);

  return result.map(item => ({
    period: `${item._id.year}-${String(item._id.month).padStart(2, '0')}`,
    totalAmount: item.totalAmount,
    count: item.count
  }));
};

module.exports = mongoose.model('Expense', expenseSchema);
