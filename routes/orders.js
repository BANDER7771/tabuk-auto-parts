const router = require('express').Router();
const Order = require('../models/Order');

// إنشاء طلب جديد
router.post('/', async (req, res) => {
    try {
        const {
            name,
            phone,
            car_make,
            car_model,
            model_year,
            vin,
            part_name,
            urgency,
            notes,
            email,
            city
        } = req.body;

        // إنشاء طلب جديد
        const order = new Order({
            customerName: name,
            customerPhone: phone,
            customerEmail: email,
            items: [{
                partName: part_name,
                quantity: 1
            }],
            carInfo: {
                make: car_make,
                model: car_model,
                year: model_year,
                vin: vin
            },
            urgency: urgency || 'normal',
            notes: notes,
            shippingAddress: {
                name: name,
                phone: phone,
                city: city || 'تبوك',
                district: '',
                street: '',
                details: notes
            },
            totalAmount: 0, // سيتم تحديده لاحقاً
            status: 'pending'
        });

        await order.save();

        res.status(201).json({
            message: 'تم استلام طلبك بنجاح',
            id: order.orderNumber,
            order
        });
    } catch (error) {
        res.status(500).json({ 
            message: 'خطأ في إنشاء الطلب', 
            error: error.message 
        });
    }
});

// الحصول على جميع الطلبات (للوحة الإدارة)
router.get('/admin', async (req, res) => {
    try {
        const orders = await Order.find()
            .sort({ createdAt: -1 })
            .populate('items.partId');
        
        res.json(orders);
    } catch (error) {
        res.status(500).json({ 
            message: 'خطأ في جلب الطلبات', 
            error: error.message 
        });
    }
});

// تحديث حالة الطلب للإدارة
router.put('/admin/:id/status', async (req, res) => {
    try {
        const { status, description } = req.body;
        
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

        res.json({
            message: 'تم تحديث حالة الطلب',
            order
        });
    } catch (error) {
        res.status(500).json({ 
            message: 'خطأ في تحديث الطلب', 
            error: error.message 
        });
    }
});

// تتبع الطلبات بالجوال
router.get('/track/:phone', async (req, res) => {
    try {
        const orders = await Order.find({ 
            customerPhone: req.params.phone 
        }).sort({ createdAt: -1 });
        
        res.json(orders);
    } catch (error) {
        res.status(500).json({ 
            message: 'خطأ في تتبع الطلبات', 
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

        res.json({
            message: 'تم تحديث حالة الطلب',
            order
        });
    } catch (error) {
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

        res.json({ 
            message: 'تم إلغاء الطلب بنجاح' 
        });
    } catch (error) {
        res.status(500).json({ 
            message: 'خطأ في إلغاء الطلب', 
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
        res.status(500).json({ 
            message: 'خطأ في تتبع الطلبات', 
            error: error.message 
        });
    }
});

module.exports = router;