const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
    orderNumber: {
        type: String,
        unique: true,
        required: true
    },
    // رقم الطلب المتسلسل القصير
    number: {
        type: Number,
        unique: true,
        sparse: true,  // السماح بـ null للطلبات القديمة
        index: true
    },
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
    carInfo: {
        make: String,
        model: String,
        year: Number,
        vin: String,
        condition: String,
        mileage: Number,
        transmission: String,
        fullName: String
    },
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
        price: Number,
        images: [String],
        partImage: String,
        imageUrl: String,
        // ✅ إضافة حقول الضمان
        warranty: {
            type: Boolean,
            default: false
        },
        warrantyDuration: String,  // مثل: "3 أشهر", "6 أشهر", "سنة"
        warrantyStartDate: Date,   // تاريخ بدء الضمان
        warrantyEndDate: Date      // تاريخ انتهاء الضمان
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
    deliveryOption: {
        type: String,
        enum: ['free', 'standard', 'express'],
        default: 'free'
    },
    deliveryFee: {
        type: Number,
        default: 0
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
    images: [String],
    timeline: [{
        status: String,
        date: Date,
        description: String
    }],
    archived: {
        type: Boolean,
        default: false
    },
    archivedAt: {
        type: Date
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

orderSchema.pre('save', async function(next) {
    if (!this.orderNumber) {
        const timestamp = Date.now();
        const random = Math.floor(Math.random() * 1000);
        this.orderNumber = `ORD-${timestamp}-${random}`;
    }
    
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