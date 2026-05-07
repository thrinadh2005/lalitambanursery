const mongoose = require('mongoose');

const billSchema = new mongoose.Schema({
    billNumber: {
        type: String,
        unique: true
    },
    customerName: {
        type: String,
        required: true,
        trim: true
    },
    customerPhone: {
        type: String,
        trim: true
    },
    items: [{
        plantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Plant' },
        packetSize: { type: String, default: '' }, // e.g. "5/6", "8/10", "1 unit"
        plantName: { type: String, default: '' }, // Plant name
    }],
    tax: {
        type: Number,
        default: 0
    },
    discount: {
        type: Number,
        default: 0
    },

    status: {
        type: String,
        enum: ['pending', 'paid', 'partially_paid', 'overdue', 'cancelled'],
        default: 'pending'
    },
    paymentMethod: {
        type: String,
        enum: ['cash', 'bank_transfer', 'cheque', 'upi', 'credit', 'other'],
        default: 'cash'
    },
    payments: [{
        amount: { type: Number, required: true },
        mode: { 
            type: String, 
            enum: ['cash', 'bank_transfer', 'cheque', 'upi', 'other'],
            required: true 
        },
        date: { type: Date, default: Date.now },
        reference: String,
        notes: String
    }],

    isFarmerBill: {
        type: Boolean,
        default: false
    },
    orderId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Order'
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    billDate: {
        type: Date,
        default: Date.now
    },
    dueDate: {
        type: Date
    },
    notes: String
}, {
    timestamps: true
});

// Pre-save hook for totals and status
billSchema.pre('save', async function (next) {


    if (!this.billNumber) {
        const date = new Date();
        const dateStr = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;

        // Get count of bills created today
        const startOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        const endOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
        const todayCount = await this.constructor.countDocuments({
            createdAt: { $gte: startOfDay, $lt: endOfDay }
        });

        const billNumber = `BLL-${dateStr}-${String(todayCount + 1).padStart(3, '0')}`;
        this.billNumber = billNumber;
    }
    next();
});

module.exports = mongoose.model('Bill', billSchema);
