const nodemailer = require('nodemailer');

// إعدادات البريد الإلكتروني
const createTransporter = () => {
    return nodemailer.createTransporter({
        host: process.env.EMAIL_HOST || 'smtp.gmail.com',
        port: process.env.EMAIL_PORT || 587,
        secure: false, // true for 465, false for other ports
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS
        },
        tls: {
            rejectUnauthorized: false
        }
    });
};

// إرسال إشعار طلب جديد
const sendNewOrderNotification = async (orderData) => {
    try {
        const transporter = createTransporter();
        
        const mailOptions = {
            from: `"تبوك قطع غيار" <${process.env.EMAIL_USER}>`,
            to: process.env.ADMIN_EMAIL || process.env.EMAIL_USER,
            subject: `طلب جديد #${orderData.orderNumber} - ${orderData.customerName}`,
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <div style="background: #2c3e50; color: white; padding: 20px; text-align: center;">
                        <h1>طلب جديد - تبوك قطع غيار</h1>
                    </div>
                    
                    <div style="padding: 20px; background: #f8f9fa;">
                        <h2>تفاصيل الطلب</h2>
                        <table style="width: 100%; border-collapse: collapse;">
                            <tr>
                                <td style="padding: 10px; border: 1px solid #ddd; background: #e9ecef;"><strong>رقم الطلب:</strong></td>
                                <td style="padding: 10px; border: 1px solid #ddd;">${orderData.orderNumber}</td>
                            </tr>
                            <tr>
                                <td style="padding: 10px; border: 1px solid #ddd; background: #e9ecef;"><strong>اسم العميل:</strong></td>
                                <td style="padding: 10px; border: 1px solid #ddd;">${orderData.customerName}</td>
                            </tr>
                            <tr>
                                <td style="padding: 10px; border: 1px solid #ddd; background: #e9ecef;"><strong>رقم الجوال:</strong></td>
                                <td style="padding: 10px; border: 1px solid #ddd;">${orderData.customerPhone}</td>
                            </tr>
                            <tr>
                                <td style="padding: 10px; border: 1px solid #ddd; background: #e9ecef;"><strong>البريد الإلكتروني:</strong></td>
                                <td style="padding: 10px; border: 1px solid #ddd;">${orderData.customerEmail || 'غير محدد'}</td>
                            </tr>
                            <tr>
                                <td style="padding: 10px; border: 1px solid #ddd; background: #e9ecef;"><strong>نوع الطلب:</strong></td>
                                <td style="padding: 10px; border: 1px solid #ddd;">${orderData.orderType}</td>
                            </tr>
                            <tr>
                                <td style="padding: 10px; border: 1px solid #ddd; background: #e9ecef;"><strong>السيارة:</strong></td>
                                <td style="padding: 10px; border: 1px solid #ddd;">${orderData.carMake} ${orderData.carModel} ${orderData.carYear}</td>
                            </tr>
                            <tr>
                                <td style="padding: 10px; border: 1px solid #ddd; background: #e9ecef;"><strong>الوصف:</strong></td>
                                <td style="padding: 10px; border: 1px solid #ddd;">${orderData.description}</td>
                            </tr>
                            <tr>
                                <td style="padding: 10px; border: 1px solid #ddd; background: #e9ecef;"><strong>التاريخ:</strong></td>
                                <td style="padding: 10px; border: 1px solid #ddd;">${new Date(orderData.createdAt).toLocaleString('ar-SA')}</td>
                            </tr>
                        </table>
                        
                        <div style="margin-top: 20px; text-align: center;">
                            <a href="${process.env.FRONTEND_URL || 'https://tabuk-auto-parts.onrender.com'}/admin.html" 
                               style="background: #3498db; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">
                                عرض الطلب في لوحة التحكم
                            </a>
                        </div>
                    </div>
                    
                    <div style="background: #34495e; color: white; padding: 15px; text-align: center; font-size: 12px;">
                        <p>هذا إشعار تلقائي من نظام تبوك قطع غيار</p>
                    </div>
                </div>
            `
        };

        const result = await transporter.sendMail(mailOptions);
        console.log('✅ تم إرسال إشعار الطلب الجديد:', result.messageId);
        return result;
    } catch (error) {
        console.error('❌ خطأ في إرسال إشعار الطلب:', error);
        throw error;
    }
};

// إرسال إشعار تحديث حالة الطلب
const sendOrderStatusUpdate = async (orderData, newStatus) => {
    try {
        const transporter = createTransporter();
        
        const statusMessages = {
            'pending': 'في الانتظار',
            'processing': 'قيد المعالجة',
            'completed': 'مكتمل',
            'cancelled': 'ملغي'
        };
        
        const mailOptions = {
            from: `"تبوك قطع غيار" <${process.env.EMAIL_USER}>`,
            to: orderData.customerEmail || process.env.ADMIN_EMAIL,
            subject: `تحديث حالة الطلب #${orderData.orderNumber}`,
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <div style="background: #27ae60; color: white; padding: 20px; text-align: center;">
                        <h1>تحديث حالة الطلب</h1>
                    </div>
                    
                    <div style="padding: 20px; background: #f8f9fa;">
                        <h2>مرحباً ${orderData.customerName}</h2>
                        <p>تم تحديث حالة طلبك رقم <strong>#${orderData.orderNumber}</strong></p>
                        
                        <div style="background: white; padding: 15px; border-radius: 5px; margin: 15px 0;">
                            <h3>الحالة الجديدة: ${statusMessages[newStatus] || newStatus}</h3>
                        </div>
                        
                        <p>شكراً لاختيارك خدماتنا. سنتواصل معك قريباً.</p>
                    </div>
                    
                    <div style="background: #34495e; color: white; padding: 15px; text-align: center; font-size: 12px;">
                        <p>هذا إشعار تلقائي من نظام تبوك قطع غيار</p>
                    </div>
                </div>
            `
        };

        const result = await transporter.sendMail(mailOptions);
        console.log('✅ تم إرسال إشعار تحديث الحالة:', result.messageId);
        return result;
    } catch (error) {
        console.error('❌ خطأ في إرسال إشعار تحديث الحالة:', error);
        throw error;
    }
};

module.exports = {
    sendNewOrderNotification,
    sendOrderStatusUpdate
};
