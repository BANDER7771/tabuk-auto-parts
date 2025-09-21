const mongoose = require('mongoose');

const shopSchema = new mongoose.Schema({
    name: { 
        type: String, 
        required: true,
        trim: true
    },
    nameAr: { 
        type: String, 
        required: true,
        trim: true
    },
    description: {
        type: String,
        trim: true
    },
    phone: { 
        type: String, 
        required: true,
        trim: true
    },
    whatsapp: {
        type: String,
        trim: true
    },
    location: {
        address: {
            type: String,
            required: true,
            trim: true
        },
        city: { 
            type: String, 
            default: 'تبوك',
            trim: true
        },
        district: {
            type: String,
            trim: true
        },
        coordinates: { 
            lat: {
                type: Number,
                min: -90,
                max: 90
            }, 
            lng: {
                type: Number,
                min: -180,
                max: 180
            }
        }
    },
    owner: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User',
        required: true
    },
    rating: { 
        type: Number, 
        default: 0,
        min: 0,
        max: 5
    },
    reviewsCount: {
        type: Number,
        default: 0
    },
    isVerified: { 
        type: Boolean, 
        default: false 
    },
    isActive: {
        type: Boolean,
        default: true
    },
    businessLicense: {
        number: String,
        image: String
    },
    workingHours: {
        saturday: { open: String, close: String },
        sunday: { open: String, close: String },
        monday: { open: String, close: String },
        tuesday: { open: String, close: String },
        wednesday: { open: String, close: String },
        thursday: { open: String, close: String },
        friday: { open: String, close: String }
    },
    specialties: [{
        type: String,
        enum: ['محرك', 'جير', 'كهرباء', 'تبريد', 'فرامل', 'عفشة', 'بودي', 'داخلية', 'أخرى']
    }],
    images: [{
        type: String
    }],
    socialMedia: {
        instagram: String,
        twitter: String,
        facebook: String
    },
    totalSales: {
        type: Number,
        default: 0
    },
    joinDate: {
        type: Date,
        default: Date.now
    },
    lastActive: {
        type: Date,
        default: Date.now
    },
    createdAt: { 
        type: Date, 
        default: Date.now 
    }
});

// فهرسة للبحث والأداء
shopSchema.index({ name: 'text', nameAr: 'text', description: 'text' });
shopSchema.index({ 'location.city': 1 });
shopSchema.index({ isVerified: 1, isActive: 1 });
shopSchema.index({ rating: -1 });
shopSchema.index({ specialties: 1 });

// تحديث آخر نشاط
shopSchema.methods.updateLastActive = function() {
    this.lastActive = new Date();
    return this.save();
};

module.exports = mongoose.model('Shop', shopSchema);
