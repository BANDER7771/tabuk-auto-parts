const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');

// إعداد Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});

// إعداد التخزين السحابي
const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'tabuk-auto-parts', // مجلد في Cloudinary
        allowed_formats: ['jpg', 'jpeg', 'png', 'gif', 'webp'],
        transformation: [
            { width: 1200, height: 800, crop: 'limit', quality: 'auto' },
            { fetch_format: 'auto' }
        ],
        public_id: (req, file) => {
            const timestamp = Date.now();
            const random = Math.floor(Math.random() * 1000);
            return `${file.fieldname}-${timestamp}-${random}`;
        }
    },
});

// إعداد multer مع Cloudinary
const upload = multer({
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB
        files: 10 // حد أقصى 10 ملفات
    },
    fileFilter: (req, file, cb) => {
        // فحص نوع الملف
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('يُسمح فقط بملفات الصور'), false);
        }
    }
});

// دالة لحذف صورة من Cloudinary
const deleteImage = async (publicId) => {
    try {
        const result = await cloudinary.uploader.destroy(publicId);
        return result;
    } catch (error) {
        console.error('خطأ في حذف الصورة من Cloudinary:', error);
        throw error;
    }
};

// دالة للحصول على رابط الصورة المحسن
const getOptimizedImageUrl = (publicId, options = {}) => {
    const defaultOptions = {
        width: 800,
        height: 600,
        crop: 'fill',
        quality: 'auto',
        fetch_format: 'auto'
    };
    
    const finalOptions = { ...defaultOptions, ...options };
    
    return cloudinary.url(publicId, finalOptions);
};

module.exports = {
    cloudinary,
    upload,
    deleteImage,
    getOptimizedImageUrl
};
