const mongoose = require('mongoose');
const slugify = require('slugify');

const plantSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  slug: {
    type: String,
    unique: true,
    lowercase: true
  },
  description: {
    type: String,
    required: true
  },
  price: {
    type: Number,
    required: false,
    min: 0
  },
  category: {
    type: String,
    required: true,
    trim: true
  },
  stock: {
    type: Number,
    required: false,
    default: 0,
    min: 0
  },
  images: [{
    url: { type: String },
    public_id: { type: String }
  }],
  isActive: {
    type: Boolean,
    default: true
  },
  isFeatured: {
    type: Boolean,
    default: false
  },
  ratings: {
    average: { type: Number, default: 0 },
    count: { type: Number, default: 0 }
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Virtual for single image access (backward compatibility and easier access)
plantSchema.virtual('image').get(function () {
  if (this.images && this.images.length > 0) {
    return this.images[0].url;
  }
  return 'https://images.unsplash.com/photo-1521327178065-090c00497f1f?q=80&w=1000&auto=format&fit=crop';
});


// Create slug from name before saving
plantSchema.pre('save', async function (next) {
  if (this.isModified('name') || !this.slug) {
    let baseSlug = slugify(this.name, { lower: true, strict: true });
    let uniqueSlug = baseSlug;
    let count = 1;

    // Check if slug exists and ensure uniqueness
    while (await this.constructor.findOne({ slug: uniqueSlug, _id: { $ne: this._id } })) {
      uniqueSlug = `${baseSlug}-${count}`;
      count++;
    }
    this.slug = uniqueSlug;
  }
  next();
});

// Add text index for search
plantSchema.index({ name: 'text', description: 'text', category: 'text' });

module.exports = mongoose.model('Plant', plantSchema);
