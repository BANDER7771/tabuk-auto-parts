const multer = require('multer');
const path = require('path');

// استيراد إعداد Cloudinary
let cloudinaryUpload;
try {
    const { upload: cloudinaryUploadConfig } = require('../config/cloudinary');
    cloudinaryUpload = cloudinaryUploadConfig;
} catch (error) {
    console.warn('⚠️ Cloudinary غير متاح، سيتم استخدام التخزين المحلي');
    cloudinaryUpload = null;
}

// إعداد التخزين المحلي كبديل
const localStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const fileFilter = (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
        return cb(null, true);
    } else {
        cb(new Error('يُسمح فقط بملفات الصور'));
    }
};

// إعداد multer للتخزين المحلي
const localUpload = multer({
    storage: localStorage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    fileFilter
});

// استخدام Cloudinary إذا كان متاحاً، وإلا استخدام التخزين المحلي
const upload = cloudinaryUpload || localUpload;

module.exports = upload;