const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
    name: { 
        type: String, 
        required: true,
        trim: true
    },
    email: { 
        type: String, 
        unique: true, 
        required: true,
        lowercase: true,
        trim: true
    },
    phone: { 
        type: String, 
        unique: true, 
        required: true,
        trim: true
    },
    password: { 
        type: String, 
        required: true,
        minlength: 6
    },
    role: { 
        type: String, 
        enum: ['user', 'admin', 'shop'], 
        default: 'user' 
    },
    isVerified: {
        type: Boolean,
        default: false
    },
    verificationToken: String,
    resetPasswordToken: String,
    resetPasswordExpires: Date,
    lastLogin: Date,
    createdAt: { 
        type: Date, 
        default: Date.now 
    }
});

// تشفير كلمة المرور قبل الحفظ
userSchema.pre('save', async function(next) {
    // إذا لم تتغير كلمة المرور، تجاوز التشفير
    if (!this.isModified('password')) return next();
    
    try {
        // تشفير كلمة المرور
        const salt = await bcrypt.genSalt(12);
        this.password = await bcrypt.hash(this.password, salt);
        next();
    } catch (error) {
        next(error);
    }
});

// مقارنة كلمة المرور
userSchema.methods.comparePassword = async function(candidatePassword) {
    try {
        return await bcrypt.compare(candidatePassword, this.password);
    } catch (error) {
        throw error;
    }
};

// إزالة كلمة المرور من النتائج
userSchema.methods.toJSON = function() {
    const userObject = this.toObject();
    delete userObject.password;
    delete userObject.verificationToken;
    delete userObject.resetPasswordToken;
    delete userObject.resetPasswordExpires;
    return userObject;
};

// الفهارس تتم إدارتها تلقائياً من خلال unique: true في التعريف

module.exports = mongoose.model('User', userSchema);
