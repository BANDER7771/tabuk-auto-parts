const router = require('express').Router();
const mongoose = require('mongoose');
const Order = require('../models/Order');
const { sendOrderNotification } = require('../config/whatsapp-meta');
const upload = require('../middleware/upload');
// تم إزالة استيراد البريد الإلكتروني - نستخدم الواتساب فقط

// Helper function: جلب رقم الطلب التالي بشكل ذري
async function nextOrderNumber() {
    const col = mongoose.connection.collection('counters');
    const result = await col.findOneAndUpdate(
        { _id: 'orders' },
        { 
            $inc: { seq: 1 },
            $setOnInsert: { seq: 99 } // البدء من 99، أول زيادة = 100
        },
        { 
            upsert: true,
            returnDocument: 'after'
        }
    );
    return result.value.seq;
}

// فحص صحة الخدمة
router.get('/health', (req, res) => res.json({ ok: true, route: 'orders' }));

// إنشاء طلب جديد مع معالجة أخطاء multer
router.post('/', (req, res, next) => {
    upload.single('partImage')(req, res, (err) => {
        if (err) {
            console.error('❌ Multer error:', err);
            console.error('Error details:', {
                message: err.message,
                code: err.code,
                field: err.field,
                stack: err.stack
            });
            
            if (err.message && err.message.includes('Unexpected end of form')) {
                return res.status(400).json({
                    message: 'خطأ في إرسال النموذج. الرجاء التأكد من ملء جميع الحقول والمحاولة مرة أخرى.',
                    error: 'Form submission error'
                });
            }
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(400).json({
                    message: 'حجم الملف كبير جداً. الحد الأقصى 10MB.',
                    error: 'File too large'
                });
            }
            if (err.message && err.message.includes('Only image files are allowed')) {
                return res.status(400).json({
                    message: 'يُسمح فقط برفع ملفات الصور (JPG, PNG, GIF)',
                    error: 'Invalid file type'
                });
            }
            
            // خطأ عام
            return res.status(400).json({
                message: 'خطأ في رفع الصورة. الرجاء التأكد من أن الملف صورة صحيحة وحجمها أقل من 10MB.',
                error: err.message || err.code || 'Upload error',
                details: process.env.NODE_ENV === 'development' ? err.stack : undefined
            });
        }
        next();
    });
}, async (req, res) => {
    try {
        // فحص وجود البيانات مع تشخيص مفصل
        console.log('🔍 Order Request debugging:');
        console.log('- Content-Type:', req.headers['content-type']);
        console.log('- Body exists:', !!req.body);
        console.log('- Body keys:', req.body ? Object.keys(req.body) : 'No body');
        console.log('- File (single):', !!req.file);
        console.log('- Raw body:', req.body);

        // التحقق من وجود البيانات الأساسية بدلاً من فحص req.body فارغ
        const hasRequiredData = req.body && (
            req.body.fullName || 
            req.body.phone || 
            req.body.carNameCategory || 
            req.body.carYear || 
            req.body.partDetails
        );

        if (!hasRequiredData) {
            console.log('❌ لا توجد بيانات مطلوبة في الطلب');
            return res.status(400).json({ 
                message: 'لم يتم استلام البيانات بشكل صحيح. الرجاء التأكد من ملء جميع الحقول المطلوبة.',
                error: 'Required fields missing',
                debug: {
                    contentType: req.headers['content-type'],
                    bodyExists: !!req.body,
                    bodyKeys: req.body ? Object.keys(req.body) : [],
                    hasFile: !!req.file
                }
            });
        }

        const {
            fullName,
            phone,
            carNameCategory,
            carYear,
            partDetails,
            urgency,
            delivery,
            notes,
            email,
            city
        } = req.body;

        // فحص البيانات المطلوبة (البيانات المبسطة الجديدة)
        if (!fullName || !phone || !carNameCategory || !carYear || !partDetails) {
            return res.status(400).json({ 
                message: 'البيانات المطلوبة مفقودة',
                required: ['fullName', 'phone', 'carNameCategory', 'carYear', 'partDetails']
            });
        }

        // الحصول على رقم متسلسل قصير للطلب
        let sequentialNumber;
        try {
            sequentialNumber = await nextOrderNumber();
            console.log('✅ رقم الطلب المتسلسل:', sequentialNumber);
        } catch (seqError) {
            console.warn('⚠️ فشل الحصول على رقم متسلسل، استخدام fallback:', seqError?.message);
            // في حالة الفشل، استخدام رقم عشوائي
            sequentialNumber = null;
        }

        // إنشاء رقم طلب فريد
        const orderNumber = sequentialNumber 
            ? `ORD-${sequentialNumber}` 
            : 'ORD-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4).toUpperCase();

        // حساب رسوم التوصيل
        let deliveryFee = 0;
        const deliveryOption = delivery || 'free';
        
        switch (deliveryOption) {
            case 'express':
                deliveryFee = 50;
                break;
            case 'standard':
                deliveryFee = 25;
                break;
            case 'free':
            default:
                deliveryFee = 0;
                break;
        }

        // تحليل اسم السيارة وفئتها
        const carParts = carNameCategory.split(' ');
        const carMake = carParts[0] || carNameCategory;
        const carModel = carParts.slice(1).join(' ') || 'غير محدد';

        // إنشاء طلب جديد
        const order = new Order({
            orderNumber: orderNumber,
            number: sequentialNumber,  // الرقم المتسلسل القصير
            customerName: fullName,
            customerPhone: phone,
            customerEmail: '',
            items: [{
                partName: partDetails,
                quantity: 1,
                // حفظ الصورة بشكل صحيح - Cloudinary أو Local
                partImage: req.file ? (req.file.path || `/uploads/${req.file.filename}`) : null,
                imageUrl: req.file ? (req.file.path || `/uploads/${req.file.filename}`) : null,
                images: req.file ? [req.file.path || `/uploads/${req.file.filename}`] : []
            }],            carInfo: {
                make: carMake,
                model: carModel,
                year: parseInt(carYear),
                fullName: carNameCategory // حفظ الاسم الكامل كما أدخله المستخدم
            },
            urgency: urgency || 'normal',
            deliveryOption: deliveryOption,
            deliveryFee: deliveryFee,
            notes: notes,
            shippingAddress: {
                name: fullName,
                phone: phone,
                city: city || 'تبوك',
                district: '',
                street: '',
                details: notes
            },
            totalAmount: deliveryFee, // رسوم التوصيل + سعر القطعة (سيتم تحديده لاحقاً)
            status: 'pending'
        });

        try {
            await order.save();
            console.log('✅ تم حفظ الطلب في قاعدة البيانات:', order.orderNumber);
        } catch (dbError) {
            console.error('❌ خطأ في حفظ الطلب في قاعدة البيانات:', dbError.message);
            
            // حفظ الطلب في ملف محلي كبديل
            const fs = require('fs');
            const path = require('path');
            
            try {
                const ordersFile = path.join(__dirname, '../backup_orders.json');
                let backupOrders = [];
                
                if (fs.existsSync(ordersFile)) {
                    const data = fs.readFileSync(ordersFile, 'utf8');
                    backupOrders = JSON.parse(data);
                }
                
                backupOrders.push({
                    ...order.toObject(),
                    savedAt: new Date(),
                    source: 'backup_due_to_db_error'
                });
                
                fs.writeFileSync(ordersFile, JSON.stringify(backupOrders, null, 2));
                console.log('✅ تم حفظ الطلب في الملف الاحتياطي');
            } catch (fileError) {
                console.error('❌ خطأ في حفظ الطلب في الملف الاحتياطي:', fileError.message);
            }
        }

        // ===== Email notify (admin) =====
        let emailNotify = { ok: false, reason: 'no_action' };
        try {
            const sendEmail = req.app?.locals?.sendEmail;
            const to = process.env.NOTIFY_EMAIL; // بريد المستلم
            if (typeof sendEmail === 'function' && to) {
                const orderId  = (order?._id || '').toString();
                const orderNo  = order?.orderNumber || order?.number || orderId.slice(-6);
                const parts    = [
                    `طلب جديد #${orderNo}`,
                    `الاسم: ${order?.customerName || '-'}`,
                    `الجوال: ${order?.customerPhone || '-'}`,
                    `المدينة: ${order?.shippingAddress?.city || '-'}`,
                    `السيارة: ${order?.carInfo?.fullName || `${order?.carInfo?.make || ''} ${order?.carInfo?.model || ''}`} ${order?.carInfo?.year || ''}`,
                    `القطعة: ${order?.items?.[0]?.partName || partDetails || '-'}`,
                    `التوصيل: ${order?.deliveryOption || delivery || '-'}`,
                    `ملاحظات: ${order?.notes || notes || '-'}`
                ];
                const subject = `طلب جديد #${orderNo}`;
                const text    = parts.join('\n');
                const link    = process.env.APP_PUBLIC_URL ? `${process.env.APP_PUBLIC_URL}/orders/${orderId}` : '';
                const html    = `<div style="font-family:system-ui,sans-serif;direction:rtl;">
                    <h3>طلب جديد #${orderNo}</h3>
                    <ul>
                        <li><b>الاسم:</b> ${order?.customerName || '-'}</li>
                        <li><b>الجوال:</b> ${order?.customerPhone || '-'}</li>
                        <li><b>المدينة:</b> ${order?.shippingAddress?.city || '-'}</li>
                        <li><b>السيارة:</b> ${order?.carInfo?.fullName || `${order?.carInfo?.make || ''} ${order?.carInfo?.model || ''}`} ${order?.carInfo?.year || ''}</li>
                        <li><b>القطعة:</b> ${order?.items?.[0]?.partName || partDetails || '-'}</li>
                        <li><b>التوصيل:</b> ${order?.deliveryOption || delivery || '-'}</li>
                        <li><b>ملاحظات:</b> ${order?.notes || notes || '-'}</li>
                    </ul>
                    ${link ? `<p><a href="${link}">فتح الطلب</a></p>` : ''}
                </div>`;
                emailNotify = await sendEmail(to, subject, text, html);
                console.log('Email notify result:', emailNotify);
            }
        } catch (e) {
            console.error('email notify error:', e?.message);
            emailNotify = { ok: false, reason: 'error', error: e?.message };
        }

        // ===== WA: notify delivery and customer on order created =====
        const sendWA = req.app?.locals?.sendWhatsApp;
        let waToDriver = { ok: false, reason: 'no_action' };
        let waToCustomer = { ok: false, reason: 'no_action' };
        
        // Send to delivery driver
        try {
            const drv = process.env.DELIVERY_WHATSAPP; // e.g., 966545376792
            if (typeof sendWA === 'function' && drv) {
                const orderNo = order?.orderNumber || order?.number || (order?._id || '').toString().slice(-6);
                const text = `تم استلام طلب #${orderNo}. تواصل للتسليم.`;
                waToDriver = await sendWA(drv, text);
                console.log('WA to driver result:', waToDriver);
            }
        } catch (e) {
            console.error('WA driver err:', e?.message);
            waToDriver = { ok: false, reason: 'error', error: e?.message };
        }
        
        // Send to customer (يفضّل القوالب إن توفرت لتجاوز نافذة 24 ساعة)
        try {
            const phone = String(order?.customerPhone || order?.customer?.phone || order?.phone || '');
            if (typeof sendWA === 'function' && phone) {
                const orderId = (order?._id || '').toString();
                const orderNo = order?.orderNumber || order?.number || orderId.slice(-6);
                const link = process.env.APP_PUBLIC_URL ? `${process.env.APP_PUBLIC_URL}/orders/${orderId}` : '';
                const tpl = process.env.WA_TEMPLATE_SID_ORDER_CREATED;
                const text = `تم استلام طلبك رقم ${orderNo}. سنوافيك بالتحديثات.${link ? '\n' + link : ''}`;
                
                waToCustomer = tpl
                    ? await sendWA(phone, null, { contentSid: tpl, vars: { "1": orderNo, "2": link || "" } })
                    : await sendWA(phone, text);
                console.log('WA to customer result:', waToCustomer);
            }
        } catch (e) {
            console.error('WA customer err:', e?.message);
            waToCustomer = { ok: false, reason: 'error', error: e?.message };
        }

        // إرسال إشعار واتساب فقط
        const deliveryText = deliveryOption === 'express' ? 'مستعجل (1-2 ساعة) - 50 ريال' : 
                           deliveryOption === 'standard' ? 'سريع (3-5 ساعات) - 25 ريال' : 
                           'عادي (12-24 ساعة) - مجاني';
        
        const notificationData = {
            orderNumber: order.orderNumber,
            customerName: order.customerName,
            customerPhone: order.customerPhone,
            orderType: 'طلب قطع غيار',
            carMake: order.carInfo.make,
            carModel: order.carInfo.model,
            carYear: order.carInfo.year,
            carFullName: order.carInfo.fullName,
            description: `${order.items[0].partName}\nالتوصيل: ${deliveryText}${req.file ? '\n📷 يحتوي على صورة' : ''}`,
            createdAt: order.createdAt,
            hasImage: !!req.file
        };

        // إرسال إشعار واتساب
        try {
            const sendWA = req.app?.locals?.sendWhatsApp;
            const phone = String(order?.customer?.phone || order?.customerPhone || order?.phone || '').trim();
            if (typeof sendWA === 'function' && phone) {
                const msgText = notificationData.description
                    ? `طلبك ${notificationData.orderNumber}\n${notificationData.description}`
                    : `تم استلام طلبك رقم ${notificationData.orderNumber}.`;
                await sendWA(phone, msgText);
            } else {
                console.warn('WA skip (create): no sender or phone');
            }
        } catch (whatsappError) {
            console.error('خطأ في إرسال إشعار الواتساب:', whatsappError?.message || whatsappError);
        }

        // Return actual notification status
        res.status(201).json({
            message: 'تم استلام طلبك بنجاح',
            orderNumber: order.orderNumber,
            id: order.orderNumber,
            orderId: order._id,
            order: {
                orderNumber: order.orderNumber,
                customerName: order.customerName,
                status: order.status,
                createdAt: order.createdAt
            },
            driverNotify: waToDriver,
            customerNotify: waToCustomer,
            emailNotify: emailNotify
        });
    } catch (error) {
        console.error('❌ خطأ في إنشاء الطلب:', error);
        
        // معالجة أخطاء multer المحددة
        if (error.message && error.message.includes('Unexpected end of form')) {
            return res.status(400).json({ 
                message: 'خطأ في إرسال النموذج. الرجاء التأكد من ملء جميع الحقول والمحاولة مرة أخرى.',
                error: 'Form submission error'
            });
        }
        
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ 
                message: 'حجم الملف كبير جداً. الحد الأقصى 10MB.',
                error: 'File too large'
            });
        }
        
        if (error.code === 'LIMIT_UNEXPECTED_FILE') {
            return res.status(400).json({ 
                message: 'نوع الملف غير مدعوم. يُسمح فقط بملفات الصور.',
                error: 'Invalid file type'
            });
        }
        
        res.status(500).json({ 
            message: 'خطأ في إنشاء الطلب. الرجاء المحاولة مرة أخرى.', 
            error: error.message 
        });
    }
});

// الحصول على جميع الطلبات (للوحة الإدارة)
router.get('/admin', async (req, res) => {
    try {
        let orders = [];
        let backupOrders = [];
        
        // محاولة جلب الطلبات من قاعدة البيانات (استثناء المؤرشفة)
        try {
            orders = await Order.find({ archived: { $ne: true } })
                .sort({ createdAt: -1 })
                .populate('items.partId');
        } catch (dbError) {
            console.error('❌ Database error in /admin:', dbError.message);
        }
        
        // جلب الطلبات الاحتياطية من الملف
        const fs = require('fs');
        const path = require('path');
        const backupFile = path.join(__dirname, '../backup_orders.json');
        
        if (fs.existsSync(backupFile)) {
            try {
                const data = fs.readFileSync(backupFile, 'utf8');
                backupOrders = JSON.parse(data);
            } catch (fileError) {
                console.error('❌ Backup file read error:', fileError.message);
            }
        }
        
        res.json({
            orders: orders,
            backupOrders: backupOrders,
            totalOrders: orders.length + backupOrders.length,
            dbStatus: orders.length > 0 ? 'connected' : 'disconnected'
        });
    } catch (error) {
        console.error('❌ Error in GET /admin:', error);
        res.status(500).json({ 
            message: 'خطأ في جلب الطلبات', 
            error: error.message 
        });
    }
});

// الحصول على الطلبات المؤرشفة (للوحة الإدارة)
router.get('/admin/archived', async (req, res) => {
    try {
        let archivedOrders = [];
        
        // محاولة جلب الطلبات المؤرشفة من قاعدة البيانات
        try {
            archivedOrders = await Order.find({ archived: true })
                .sort({ archivedAt: -1 })
                .populate('items.partId');
        } catch (dbError) {
            console.error('❌ Database error in /admin/archived:', dbError.message);
        }
        
        res.json({
            archivedOrders: archivedOrders,
            totalArchived: archivedOrders.length,
            dbStatus: archivedOrders.length > 0 ? 'connected' : 'disconnected'
        });
    } catch (error) {
        console.error('❌ Error in GET /admin/archived:', error);
        res.status(500).json({ 
            message: 'خطأ في جلب الطلبات المؤرشفة', 
            error: error.message 
        });
    }
});

// تحديث حالة الطلب للإدارة
router.put('/admin/:id/status', async (req, res) => {
    try {
        const { status, description } = req.body;
        
        if (!status) {
            return res.status(400).json({ 
                message: 'الحالة مطلوبة',
                error: 'Status is required'
            });
        }

        const order = await Order.findById(req.params.id);

        if (!order) {
            return res.status(404).json({ 
                message: 'الطلب غير موجود' 
            });
        }

        // تحديث الحالة
        order.status = status;
        
        // إضافة إلى Timeline
        order.timeline.push({
            status: status,
            date: new Date(),
            description: description || `تم تحديث الحالة إلى ${status}`
        });

        await order.save();
        console.log('✅ Order status updated:', order.orderNumber, 'to', status);

        // ===== WA: notify on status updated =====
        let waStatusUpdate = { ok: false, reason: 'no_action' };
        try {
            const sendWA = req.app?.locals?.sendWhatsApp;
            const phone = String(order?.customerPhone || order?.customer?.phone || order?.phone || '');
            if (typeof sendWA === 'function' && phone) {
                const orderId = (order?._id || '').toString();
                const orderNo = order?.orderNumber || order?.number || orderId.slice(-6);
                const link = process.env.APP_PUBLIC_URL ? `${process.env.APP_PUBLIC_URL}/orders/${orderId}` : '';
                const tpl = process.env.WA_TEMPLATE_SID_STATUS_UPDATED;
                const txt = `تم تحديث حالة طلبك رقم ${orderNo} إلى: ${order?.status || 'غير محددة'}.${link ? '\n' + link : ''}`;
                
                waStatusUpdate = tpl
                    ? await sendWA(phone, null, { contentSid: tpl, vars: { "1": orderNo, "2": order.status, "3": link || "" } })
                    : await sendWA(phone, txt);
                console.log('WA status update result:', waStatusUpdate);
            }
        } catch (e) {
            console.error('WA status err:', e?.message);
            waStatusUpdate = { ok: false, reason: 'error', error: e?.message };
        }

        res.json({
            message: 'تم تحديث حالة الطلب',
            order,
            waStatus: waStatusUpdate
        });
    } catch (error) {
        console.error('❌ Error in PUT /admin/:id/status:', error);
        res.status(500).json({ 
            message: 'خطأ في تحديث الطلب', 
            error: error.message 
        });
    }
});

router.get('/', async (req, res) => {
    try {
        const { status, phone } = req.query;
        
        let query = {};
        if (status) query.status = status;
        if (phone) query.customerPhone = phone;

        const orders = await Order.find(query)
            .sort({ createdAt: -1 })
            .limit(50);

        res.json(orders);
    } catch (error) {
        console.error('❌ Error in GET /:', error);
        res.status(500).json({ 
            message: 'خطأ في جلب الطلبات', 
            error: error.message 
        });
    }
});

// الحصول على طلب واحد
router.get('/:orderNumber', async (req, res) => {
    try {
        const order = await Order.findOne({ 
            orderNumber: req.params.orderNumber 
        });

        if (!order) {
            return res.status(404).json({ 
                message: 'الطلب غير موجود' 
            });
        }

        res.json(order);
    } catch (error) {
        console.error('❌ Error in GET /:orderNumber:', error);
        res.status(500).json({ 
            message: 'خطأ في جلب الطلب', 
            error: error.message 
        });
    }
});

// تحديث حالة الطلب
router.put('/:orderNumber/status', async (req, res) => {
    try {
        const { status, description } = req.body;
        
        if (!status) {
            return res.status(400).json({ 
                message: 'الحالة مطلوبة',
                error: 'Status is required'
            });
        }

        const order = await Order.findOne({ 
            orderNumber: req.params.orderNumber 
        });

        if (!order) {
            return res.status(404).json({ 
                message: 'الطلب غير موجود' 
            });
        }

        // تحديث الحالة
        order.status = status;
        
        // إضافة إلى Timeline
        order.timeline.push({
            status: status,
            date: new Date(),
            description: description || `تم تحديث الحالة إلى ${status}`
        });

        await order.save();
        console.log('✅ Order status updated:', order.orderNumber, 'to', status);

        // ===== WA: notify on status updated =====
        let waStatusUpdate = { ok: false, reason: 'no_action' };
        try {
            const sendWA = req.app?.locals?.sendWhatsApp;
            const phone = String(order?.customerPhone || order?.customer?.phone || order?.phone || '');
            if (typeof sendWA === 'function' && phone) {
                const orderId = (order?._id || '').toString();
                const orderNo = order?.orderNumber || order?.number || orderId.slice(-6);
                const link = process.env.APP_PUBLIC_URL ? `${process.env.APP_PUBLIC_URL}/orders/${orderId}` : '';
                const tpl = process.env.WA_TEMPLATE_SID_STATUS_UPDATED;
                const txt = `تم تحديث حالة طلبك رقم ${orderNo} إلى: ${order?.status || 'غير محددة'}.${link ? '\n' + link : ''}`;
                
                waStatusUpdate = tpl
                    ? await sendWA(phone, null, { contentSid: tpl, vars: { "1": orderNo, "2": order.status, "3": link || "" } })
                    : await sendWA(phone, txt);
                console.log('WA status update result:', waStatusUpdate);
            }
        } catch (e) {
            console.error('WA status err:', e?.message);
            waStatusUpdate = { ok: false, reason: 'error', error: e?.message };
        }

        res.json({
            message: 'تم تحديث حالة الطلب',
            order,
            waStatus: waStatusUpdate
        });
    } catch (error) {
        console.error('❌ Error in PUT /:orderNumber/status:', error);
        res.status(500).json({ 
            message: 'خطأ في تحديث الطلب', 
            error: error.message 
        });
    }
});

// إلغاء طلب
router.delete('/:orderNumber', async (req, res) => {
    try {
        const order = await Order.findOne({ 
            orderNumber: req.params.orderNumber 
        });

        if (!order) {
            return res.status(404).json({ 
                message: 'الطلب غير موجود' 
            });
        }

        order.status = 'cancelled';
        order.timeline.push({
            status: 'cancelled',
            date: new Date(),
            description: 'تم إلغاء الطلب'
        });

        await order.save();
        console.log('✅ Order cancelled:', order.orderNumber);

        res.json({ 
            message: 'تم إلغاء الطلب بنجاح' 
        });
    } catch (error) {
        console.error('❌ Error in DELETE /:orderNumber:', error);
        res.status(500).json({ 
            message: 'خطأ في إلغاء الطلب', 
            error: error.message 
        });
    }
});

// حذف طلب نهائياً (للإدارة فقط)
router.delete('/admin/:id', async (req, res) => {
    try {
        const order = await Order.findById(req.params.id);

        if (!order) {
            return res.status(404).json({ 
                message: 'الطلب غير موجود' 
            });
        }

        await Order.findByIdAndDelete(req.params.id);
        console.log('✅ Order permanently deleted:', order.orderNumber);

        res.json({ 
            message: 'تم حذف الطلب نهائياً' 
        });
    } catch (error) {
        console.error('❌ Error in DELETE /admin/:id:', error);
        res.status(500).json({ 
            message: 'خطأ في حذف الطلب', 
            error: error.message 
        });
    }
});

// أرشفة طلب (للإدارة فقط)
router.put('/admin/:id/archive', async (req, res) => {
    try {
        const order = await Order.findById(req.params.id);

        if (!order) {
            return res.status(404).json({ 
                message: 'الطلب غير موجود' 
            });
        }

        // إضافة حقل archived إلى الطلب
        order.archived = true;
        order.archivedAt = new Date();
        order.timeline.push({
            status: 'archived',
            date: new Date(),
            description: 'تم أرشفة الطلب'
        });

        await order.save();
        console.log('✅ Order archived:', order.orderNumber);

        res.json({ 
            message: 'تم أرشفة الطلب بنجاح',
            order
        });
    } catch (error) {
        console.error('❌ Error in PUT /admin/:id/archive:', error);
        res.status(500).json({ 
            message: 'خطأ في أرشفة الطلب', 
            error: error.message 
        });
    }
});

// استرجاع طلب مؤرشف (للإدارة فقط)
router.put('/admin/:id/restore', async (req, res) => {
    try {
        const order = await Order.findById(req.params.id);

        if (!order) {
            return res.status(404).json({ 
                message: 'الطلب غير موجود' 
            });
        }

        // إزالة حقل archived
        order.archived = false;
        order.archivedAt = undefined;
        order.timeline.push({
            status: 'restored',
            date: new Date(),
            description: 'تم استرجاع الطلب من الأرشيف'
        });

        await order.save();
        console.log('✅ Order restored:', order.orderNumber);

        res.json({ 
            message: 'تم استرجاع الطلب بنجاح',
            order
        });
    } catch (error) {
        console.error('❌ Error in PUT /admin/:id/restore:', error);
        res.status(500).json({ 
            message: 'خطأ في استرجاع الطلب', 
            error: error.message 
        });
    }
});

// تتبع الطلب بالهاتف
router.get('/track/:phone', async (req, res) => {
    try {
        const orders = await Order.find({ 
            customerPhone: req.params.phone 
        })
        .sort({ createdAt: -1 })
        .limit(10);

        res.json(orders);
    } catch (error) {
        console.error('❌ Error in GET /track/:phone:', error);
        res.status(500).json({ 
            message: 'خطأ في تتبع الطلبات', 
            error: error.message 
        });
    }
});

// إنشاء طلب بيع سيارة
router.post('/sell-car', upload.array('images', 10), async (req, res) => {
    try {
        // فحص وجود البيانات مع تشخيص مفصل
        console.log('🔍 Sell Car Request debugging:');
        console.log('- Content-Type:', req.headers['content-type']);
        console.log('- Body exists:', !!req.body);
        console.log('- Body keys:', req.body ? Object.keys(req.body) : 'No body');
        console.log('- Files (array):', req.files ? req.files.length : 0);

        if (!req.body || Object.keys(req.body).length === 0) {
            console.log('❌ Empty request body received');
            return res.status(400).json({ 
                message: 'لم يتم استلام البيانات بشكل صحيح',
                error: 'Request body is undefined or empty',
                debug: {
                    contentType: req.headers['content-type'],
                    bodyExists: !!req.body,
                    bodyKeys: req.body ? Object.keys(req.body) : [],
                    filesCount: req.files ? req.files.length : 0
                }
            });
        }

        const {
            fullName,
            phone,
            carMake,
            carModel,
            carYear,
            condition,
            mileage,
            transmission,
            description,
            city,
            sellReason,
            violations,
            expectedPrice
        } = req.body;

        // فحص البيانات المطلوبة
        if (!fullName || !phone || !carMake || !carModel || !carYear) {
            console.log('❌ Required fields missing for sell-car');
            return res.status(400).json({ 
                message: 'البيانات المطلوبة مفقودة',
                required: ['fullName', 'phone', 'carMake', 'carModel', 'carYear']
            });
        }

        // معالجة الصور المرفوعة
        const images = req.files ? req.files.map(file => {
            // إذا كان يستخدم Cloudinary، استخدم الرابط الكامل
            if (file.path && file.path.includes('cloudinary')) {
                return file.path;
            }
            // إذا كان تخزين محلي، استخدم اسم الملف
            return `/uploads/${file.filename || file.originalname}`;
        }) : [];

        // الحصول على رقم متسلسل قصير للطلب
        let sequentialNumber;
        try {
            sequentialNumber = await nextOrderNumber();
            console.log('✅ رقم طلب بيع السيارة المتسلسل:', sequentialNumber);
        } catch (seqError) {
            console.warn('⚠️ فشل الحصول على رقم متسلسل، استخدام fallback:', seqError?.message);
            sequentialNumber = null;
        }

        // إنشاء رقم طلب فريد
        const orderNumber = sequentialNumber 
            ? `ORD-${sequentialNumber}` 
            : 'ORD-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4).toUpperCase();

        // إنشاء طلب بيع سيارة
        const order = new Order({
            orderNumber: orderNumber,
            number: sequentialNumber,  // الرقم المتسلسل القصير
            customerName: fullName,
            customerPhone: phone,
            items: [{
                partName: `سيارة ${carMake} ${carModel} ${carYear}`,
                quantity: 1,
                images: images
            }],
            carInfo: {
                make: carMake,
                model: carModel,
                year: parseInt(carYear),
                condition: condition,
                mileage: mileage ? parseInt(mileage) : null,
                transmission: transmission
            },
            notes: `حالة السيارة: ${condition}${mileage ? `\nالكيلومترات: ${mileage}` : ''}${transmission ? `\nنوع الجير: ${transmission}` : ''}${sellReason ? `\nسبب البيع: ${sellReason}` : ''}${violations ? `\nالمخالفات: ${violations}` : ''}${description ? `\nوصف إضافي: ${description}` : ''}${expectedPrice ? `\nالسعر المتوقع: ${expectedPrice} ريال` : ''}`,
            shippingAddress: {
                name: fullName,
                phone: phone,
                city: city || 'تبوك',
                details: 'طلب بيع سيارة'
            },
            totalAmount: expectedPrice ? parseInt(expectedPrice) : 0,
            status: 'pending',
            images: images
        });

        try {
            await order.save();
            console.log('✅ تم حفظ طلب بيع السيارة في قاعدة البيانات:', order.orderNumber);
        } catch (dbError) {
            console.error('❌ خطأ في حفظ طلب بيع السيارة في قاعدة البيانات:', dbError.message);
            
            // حفظ الطلب في ملف محلي كبديل
            const fs = require('fs');
            const path = require('path');
            
            try {
                const ordersFile = path.join(__dirname, '../backup_orders.json');
                let backupOrders = [];
                
                if (fs.existsSync(ordersFile)) {
                    const data = fs.readFileSync(ordersFile, 'utf8');
                    backupOrders = JSON.parse(data);
                }
                
                backupOrders.push({
                    ...order.toObject(),
                    savedAt: new Date(),
                    source: 'backup_due_to_db_error',
                    type: 'sell-car'
                });
                
                fs.writeFileSync(ordersFile, JSON.stringify(backupOrders, null, 2));
                console.log('✅ تم حفظ طلب بيع السيارة في الملف الاحتياطي');
            } catch (fileError) {
                console.error('❌ خطأ في حفظ طلب بيع السيارة في الملف الاحتياطي:', fileError.message);
            }
        }

        // ===== Email notify (admin) for sell-car =====
        let emailNotify = { ok: false, reason: 'no_action' };
        try {
            const sendEmail = req.app?.locals?.sendEmail;
            const to = process.env.NOTIFY_EMAIL; // بريد المستلم
            if (typeof sendEmail === 'function' && to) {
                const orderId  = (order?._id || '').toString();
                const orderNo  = order?.orderNumber || order?.number || orderId.slice(-6);
                const parts    = [
                    `طلب بيع سيارة جديد #${orderNo}`,
                    `الاسم: ${order?.customerName || fullName || '-'}`,
                    `الجوال: ${order?.customerPhone || phone || '-'}`,
                    `المدينة: ${city || '-'}`,
                    `السيارة: ${carMake} ${carModel} ${carYear}`,
                    `الحالة: ${condition || '-'}`,
                    `الكيلومترات: ${mileage || '-'}`,
                    `نوع الجير: ${transmission || '-'}`,
                    `السعر المتوقع: ${expectedPrice || '-'} ريال`,
                    `سبب البيع: ${sellReason || '-'}`,
                    `المخالفات: ${violations || '-'}`
                ];
                const subject = `طلب بيع سيارة #${orderNo}`;
                const text    = parts.join('\n');
                const link    = process.env.APP_PUBLIC_URL ? `${process.env.APP_PUBLIC_URL}/orders/${orderId}` : '';
                const html    = `<div style="font-family:system-ui,sans-serif;direction:rtl;">
                    <h3>طلب بيع سيارة جديد #${orderNo}</h3>
                    <ul>
                        <li><b>الاسم:</b> ${order?.customerName || fullName || '-'}</li>
                        <li><b>الجوال:</b> ${order?.customerPhone || phone || '-'}</li>
                        <li><b>المدينة:</b> ${city || '-'}</li>
                        <li><b>السيارة:</b> ${carMake} ${carModel} ${carYear}</li>
                        <li><b>الحالة:</b> ${condition || '-'}</li>
                        <li><b>الكيلومترات:</b> ${mileage || '-'}</li>
                        <li><b>نوع الجير:</b> ${transmission || '-'}</li>
                        <li><b>السعر المتوقع:</b> ${expectedPrice || '-'} ريال</li>
                        <li><b>سبب البيع:</b> ${sellReason || '-'}</li>
                        <li><b>المخالفات:</b> ${violations || '-'}</li>
                        <li><b>عدد الصور:</b> ${images.length}</li>
                    </ul>
                    ${link ? `<p><a href="${link}">فتح الطلب</a></p>` : ''}
                </div>`;
                emailNotify = await sendEmail(to, subject, text, html);
                console.log('Email notify result (sell-car):', emailNotify);
            }
        } catch (e) {
            console.error('email notify error (sell-car):', e?.message);
            emailNotify = { ok: false, reason: 'error', error: e?.message };
        }

        // إرسال إشعار واتساب فقط
        const notificationData = {
            orderNumber: order.orderNumber,
            customerName: order.customerName,
            customerPhone: order.customerPhone,
            orderType: 'طلب بيع سيارة',
            carMake: order.carInfo.make,
            carModel: order.carInfo.model,
            carYear: order.carInfo.year,
            description: order.items[0].partName,
            createdAt: order.createdAt
        };

        // إرسال إشعار واتساب
        try {
            const sendWA = req.app?.locals?.sendWhatsApp;
            const phone = String(order?.customer?.phone || order?.customerPhone || order?.phone || '').trim();
            if (typeof sendWA === 'function' && phone) {
                const msgText = `تم استلام طلب بيع سيارتك رقم ${order.orderNumber}. سنراجع التفاصيل ونتواصل معك.`;
                await sendWA(phone, msgText);
            } else {
                console.warn('WA skip (sell-car): no sender or phone');
            }
        } catch (whatsappError) {
            console.error('خطأ في إرسال إشعار الواتساب:', whatsappError?.message || whatsappError);
        }

        res.status(201).json({
            message: 'تم استلام طلب بيع السيارة بنجاح',
            orderNumber: order.orderNumber,
            order: {
                orderNumber: order.orderNumber,
                customerName: order.customerName,
                status: order.status,
                createdAt: order.createdAt
            },
            emailNotify: emailNotify
        });
    } catch (error) {
        console.error('❌ Error in POST /sell-car:', error);
        res.status(500).json({ 
            message: 'خطأ في إنشاء طلب بيع السيارة', 
            error: error.message 
        });
    }
});
router.post('/admin/send-to-delivery', async (req, res) => {
    try {
        const { orderIds, deliveryPhone } = req.body;

        if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
            return res.status(400).json({ 
                message: 'يرجى تحديد طلبات للإرسال' 
            });
        }

        const deliveryNumber = deliveryPhone || process.env.DELIVERY_WHATSAPP || '966545376792';
        const orders = await Order.find({ _id: { $in: orderIds } });

        if (orders.length === 0) {
            return res.status(404).json({ 
                message: 'لم يتم العثور على الطلبات المحددة' 
            });
        }

        let message = `🚚 *طلبات جديدة للتوصيل*\n\n`;
        message += `📦 عدد الطلبات: ${orders.length}\n`;
        message += `📅 ${new Date().toLocaleDateString('ar-SA')}\n\n`;
        message += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;

        orders.forEach((order, index) => {
            const deliveryText = order.deliveryOption === 'express' ? 
                               '🔥 مستعجل (1-2 ساعة)' : 
                               order.deliveryOption === 'standard' ? 
                               '⚡ سريع (3-5 ساعات)' : 
                               '📋 عادي (12-24 ساعة)';

            const hasImage = !!(order.items?.[0]?.imageUrl || order.items?.[0]?.partImage);

            message += `*${index + 1}. طلب رقم:* ${order.orderNumber}\n`;
            message += `👤 *العميل:* ${order.customerName}\n`;
            message += `📱 *الجوال:* ${order.customerPhone}\n`;
            message += `🚗 *السيارة:* ${order.carInfo?.fullName || (order.carInfo?.make + ' ' + order.carInfo?.model)} ${order.carInfo?.year || ''}\n`;
            message += `🔧 *القطعة:* ${order.items?.[0]?.partName || 'غير محدد'}\n`;
            message += `🚚 *التوصيل:* ${deliveryText}\n`;
            
            if (order.shippingAddress?.city) {
                message += `📍 *المدينة:* ${order.shippingAddress.city}\n`;
            }
            
            if (order.notes) {
                message += `📝 *ملاحظات:* ${order.notes}\n`;
            }
            
            if (hasImage) {
                const imageUrl = order.items[0].imageUrl || order.items[0].partImage;
                message += `📷 *صورة القطعة:* ${imageUrl}\n`;
            }
            
            message += `\n━━━━━━━━━━━━━━━━━━━━━━\n\n`;
        });

        message += `\n✅ *يرجى البدء بالتوصيل*\n`;
        message += `📞 *للاستفسار:* تواصل مع الإدارة`;

        // Send to delivery with actual status
        let deliveryResult = { ok: false, reason: 'no_action' };
        try {
            const sendWA = req.app?.locals?.sendWhatsApp;
            if (typeof sendWA === 'function' && deliveryNumber) {
                deliveryResult = await sendWA(deliveryNumber, message);
                console.log('WA to delivery result:', deliveryResult);
            } else {
                console.warn('WA skip (delivery): no sender or phone');
                deliveryResult = { ok: false, reason: 'wa_disabled' };
            }

            if (deliveryResult.ok) {
                res.json({
                    message: `تم إرسال ${orders.length} طلب للمندوب بنجاح`,
                    deliveryNumber: deliveryNumber,
                    orderCount: orders.length,
                    success: true,
                    driverNotify: deliveryResult
                });
            } else {
                res.status(400).json({
                    message: 'فشل الإرسال للمندوب',
                    error: deliveryResult.error || deliveryResult.reason,
                    success: false,
                    driverNotify: deliveryResult
                });
            }
        } catch (error) {
            console.error('خطأ في إرسال للمندوب:', error);
            res.status(500).json({
                message: 'فشل الإرسال للمندوب',
                error: error.message,
                success: false,
                driverNotify: { ok: false, reason: 'exception', error: error.message }
            });
        }
    } catch (error) {
        console.error('❌ Error in POST /admin/send-to-delivery:', error);
        res.status(500).json({ 
            message: 'خطأ في إرسال الطلبات للمندوب', 
            error: error.message 
        });
    }
});
// تحديث السعر والضمان
router.put('/admin/:id/pricing', async (req, res) => {
    try {
        const { price, warranty, warrantyDuration } = req.body;

        if (!price || parseFloat(price) <= 0) {
            return res.status(400).json({ message: 'يرجى إدخال سعر صحيح' });
        }

        const order = await Order.findById(req.params.id);
        if (!order) {
            return res.status(404).json({ message: 'الطلب غير موجود' });
        }

        console.log('📝 Updating pricing:', { price, warranty, warrantyDuration });

        // تحديث السعر والضمان
        if (order.items && order.items[0]) {
            order.items[0].price = parseFloat(price);
            order.items[0].warranty = warranty;
            
            // حساب تاريخ انتهاء الضمان
            if (warranty && warrantyDuration) {
                // تحويل warrantyDuration إلى رقم (عدد الأيام)
                const daysNumber = parseInt(warrantyDuration);
                
                if (isNaN(daysNumber) || daysNumber <= 0) {
                    return res.status(400).json({ message: 'يرجى إدخال عدد أيام صحيح' });
                }
                
                // الحصول على التاريخ الحالي بالتوقيت السعودي
                const now = new Date();
                const saudiOffset = 3 * 60; // +3 ساعات بالدقائق
                const utcTime = now.getTime() + (now.getTimezoneOffset() * 60000);
                const saudiTime = new Date(utcTime + (saudiOffset * 60000));
                
                // تعيين بداية اليوم (00:00:00)
                const startDate = new Date(saudiTime);
                startDate.setHours(0, 0, 0, 0);
                
                // حساب تاريخ الانتهاء
                const endDate = new Date(startDate);
                endDate.setDate(endDate.getDate() + daysNumber);
                endDate.setHours(23, 59, 59, 999); // نهاية اليوم
                
                order.items[0].warrantyDuration = `${daysNumber} يوم`;
                order.items[0].warrantyStartDate = startDate;
                order.items[0].warrantyEndDate = endDate;
                
                console.log('✅ تواريخ الضمان:', {
                    start: startDate.toISOString(),
                    end: endDate.toISOString(),
                    days: daysNumber
                });
            } else {
                // إزالة معلومات الضمان إذا لم يتم تحديده
                order.items[0].warranty = false;
                order.items[0].warrantyDuration = '';
                order.items[0].warrantyStartDate = null;
                order.items[0].warrantyEndDate = null;
            }
        }

        // تحديث المبلغ الإجمالي
        order.totalAmount = (parseFloat(price) || 0) + (order.deliveryFee || 0);
        
        // إضافة للخط الزمني
        const warrantyText = warranty && warrantyDuration ? ` - مع ضمان ${warrantyDuration} يوم` : ' - بدون ضمان';
        order.timeline.push({
            status: 'pricing_updated',
            date: new Date(),
            description: `تم تحديث السعر: ${price} ريال${warrantyText}`
        });

        await order.save();

        console.log('✅ Pricing updated successfully');

        res.json({
            message: 'تم تحديث السعر والضمان بنجاح',
            order: order
        });
    } catch (error) {
        console.error('❌ Error updating pricing:', error);
        res.status(500).json({ 
            message: 'خطأ في تحديث السعر', 
            error: error.message 
        });
    }
});
// الحصول على الطلبات الناجحة (المكتملة)
router.get('/admin/completed', async (req, res) => {
    try {
        const completedOrders = await Order.find({ 
            status: 'delivered',
            archived: { $ne: true }
        })
        .sort({ createdAt: -1 })
        .populate('items.partId');

        res.json({
            completedOrders: completedOrders,
            totalCompleted: completedOrders.length
        });
    } catch (error) {
        console.error('❌ Error in GET /admin/completed:', error);
        res.status(500).json({ 
            message: 'خطأ في جلب الطلبات المكتملة', 
            error: error.message 
        });
    }
});

module.exports = router;
