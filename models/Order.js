const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
    orderNumber: {
        type: String,
        unique: true,
        required: true
    },
    // معلومات العميل - بدون الحاجة لتسجيل دخول
    customerName: {
        type: String,
        required: true
    },
    customerPhone: {
        type: String,
        required: true
    },
    customerEmail: {
        type: String
    },
    // معلومات السيارة
    carInfo: {
        make: String,
        model: String,
        year: Number,
        vin: String
    },
    // القطع المطلوبة
    items: [{
        partName: String,
        partId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Part'
        },
        quantity: {
            type: Number,
            default: 1
        },
        price: Number
    }],
    totalAmount: {
        type: Number,
        default: 0
    },
    status: {
        type: String,
        enum: ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'],
        default: 'pending'
    },
    urgency: {
        type: String,
        enum: ['normal', 'rush'],
        default: 'normal'
    },
    paymentMethod: {
        type: String,
        enum: ['cash', 'card', 'transfer', 'tamara', 'tabby'],
        default: 'cash'
    },
    paymentStatus: {
        type: String,
        enum: ['pending', 'paid', 'failed'],
        default: 'pending'
    },
    shippingAddress: {
        name: String,
        phone: String,
        city: String,
        district: String,
        street: String,
        details: String
    },
    trackingNumber: String,
    notes: String,
    timeline: [{
        status: String,
        date: Date,
        description: String
    }],
    createdAt: {
        type: Date,
        default: Date.now
    }
});

// Generate order number
orderSchema.pre('save', async function(next) {
    if (!this.orderNumber) {
        const timestamp = Date.now();
        const random = Math.floor(Math.random() * 1000);
        this.orderNumber = `ORD-${timestamp}-${random}`;
    }
    
    // إضافة الحالة الأولية للـ timeline
    if (this.isNew) {
        this.timeline.push({
            status: 'pending',
            date: new Date(),
            description: 'تم استلام الطلب'
        });
    }
    
    next();
});

module.exports = mongoose.model('Order', orderSchema);