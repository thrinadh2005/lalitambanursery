const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: false
    },
    items: [{
        plant: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Plant',
            required: false
        },
        quantity: {
            type: Number,
            required: true,
            min: 1
        },
        price: {
            type: Number,
            required: false,
            default: 0
        },
        name: String,
        image: String,
        size: {
            type: String,
            required: false,
            default: 'medium'
        },
        packetSize: {
            type: String,
            required: false
        },
        sno: {
            type: String,
            required: false
        },
        source: {
            type: String,
            required: true,
            enum: ['gallery', 'custom'],
            default: 'gallery'
        }
    }],
    totalAmount: {
        type: Number,
        required: false,
        default: 0,
        min: 0
    },
    shippingAddress: {
        fullName: { type: String, required: true },
        address: { type: String, required: true },
        city: { type: String, required: true },
        state: { type: String, required: true },
        zipCode: { type: String, required: true },
        country: { type: String, default: 'India' },
        phone: { type: String, required: true }
    },
    paymentMethod: {
        type: String,
        default: 'cod',
        enum: ['cod', 'online']
    },
    paymentStatus: {
        type: String,
        enum: ['pending', 'completed', 'failed', 'refunded'],
        default: 'pending'
    },
    status: {
        type: String,
        enum: ['pending', 'processing', 'shipped', 'delivered', 'cancelled'],
        default: 'pending'
    },
    deliveryDeadline: {
        type: Date,
        required: true
    },
    notes: {
        type: String,
        required: false,
        default: ''
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('Order', orderSchema);
