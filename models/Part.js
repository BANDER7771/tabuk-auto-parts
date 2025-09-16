const mongoose = require('mongoose');

const partSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true
    },
    nameAr: {
        type: String,
        required: true
    },
    description: {
        type: String,
        required: true
    },
    category: {
        type: String,
        required: true,
        enum: ['محرك', 'جير', 'كهرباء', 'تبريد', 'فرامل', 'عفشة', 'بودي', 'داخلية', 'أخرى']
    },
    carMake: {
        type: String,
        required: true
    },
    carModel: {
        type: String,
        required: true
    },
    carYear: {
        from: Number,
        to: Number
    },
    price: {
        type: Number,
        required: true
    },
    condition: {
        type: String,
        enum: ['جديد', 'مستعمل', 'مجدد'],
        required: true
    },
    images: [{
        type: String
    }],
    quantity: {
        type: Number,
        default: 1
    },
    shop: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Shop',
        required: true
    },
    warranty: {
        type: Number, // بالأيام
        default: 0
    },
    views: {
        type: Number,
        default: 0
    },
    isAvailable: {
        type: Boolean,
        default: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

// إضافة فهرس للبحث
partSchema.index({ name: 'text', nameAr: 'text', description: 'text' });

module.exports = mongoose.model('Part', partSchema);