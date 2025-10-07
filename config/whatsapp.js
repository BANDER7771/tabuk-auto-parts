// config/whatsapp.js
// إعدادات إشعارات الواتساب

function parseAdminNumbers() {
    const numbers = [];

    if (process.env.ADMIN_WHATSAPP_NUMBERS) {
        numbers.push(
            ...process.env.ADMIN_WHATSAPP_NUMBERS
                .split(',')
                .map(num => num && num.trim())
                .filter(Boolean)
        );
    }

    numbers.push(process.env.ADMIN_WHATSAPP_1);
    numbers.push(process.env.ADMIN_WHATSAPP_2);

    const uniqueNumbers = [...new Set(numbers.filter(Boolean))];

    if (uniqueNumbers.length === 0) {
        console.warn('⚠️ لم يتم تعريف أرقام واتساب. سيتم استخدام رقم افتراضي.');
        return ['966511780209']; // رقمك المسجل
    }

    return uniqueNumbers;
}

const ADMIN_WHATSAPP_NUMBERS = parseAdminNumbers();

class WhatsAppConfigurationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'WhatsAppConfigurationError';
    }
}

// إرسال إشعار واتساب باستخدام Template المعتمد
const sendWhatsAppNotification = async (orderData) => {
    console.log('🔍 WhatsApp Debug - بدء إرسال الإشعار');
    console.log('📱 أرقام الإدارة:', ADMIN_WHATSAPP_NUMBERS);
    
    if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
        throw new WhatsAppConfigurationError('إعدادات Twilio غير مُعرفة');
    }

    if (ADMIN_WHATSAPP_NUMBERS.length === 0) {
        throw new WhatsAppConfigurationError('لا توجد أرقام واتساب مُعرفة');
    }

    let successCount = 0;
    const errors = [];

    for (const phoneNumber of ADMIN_WHATSAPP_NUMBERS) {
        try {
            await sendTemplateMessage(phoneNumber, orderData);
            successCount += 1;
            console.log(`✅ تم إرسال إشعار واتساب إلى: ${phoneNumber.substring(0, 6)}****`);
        } catch (error) {
            const errorMessage = error.message || error.toString();
            errors.push(`${phoneNumber}: ${errorMessage}`);
            console.error(`❌ خطأ في إرسال واتساب إلى ${phoneNumber.substring(0, 6)}****:`, errorMessage);
        }
    }

    if (successCount === 0) {
        throw new Error(`فشل إرسال إشعارات الواتساب لجميع الأرقام. التفاصيل: ${errors.join(' | ')}`);
    }
};

// إرسال رسالة باستخدام Template
const sendTemplateMessage = async (phoneNumber, orderData) => {
    try {
        const twilioClient = require('twilio')(
            process.env.TWILIO_ACCOUNT_SID,
            process.env.TWILIO_AUTH_TOKEN
        );

        // تنظيف رقم الهاتف وإضافة +
        let cleanPhone = phoneNumber.replace(/[^0-9]/g, '');
        if (!cleanPhone.startsWith('+')) {
            cleanPhone = '+' + cleanPhone;
        }

        console.log(`📞 إرسال Template Message إلى: ${cleanPhone}`);

        // حساب المبلغ (إذا كان موجوداً)
        const amount = orderData.totalAmount || orderData.price || '0';
        
        // تحديد الحالة
        const status = orderData.status || 'قيد المراجعة';

        // رقم واتساب المسجل في Twilio
        const fromNumber = process.env.TWILIO_FROM_WHATSAPP || 'whatsapp:+966511780209';
        const fromFormatted = fromNumber.startsWith('whatsapp:') ? fromNumber : `whatsapp:${fromNumber}`;

        // معاملات Template حسب قالبك:
        // {{1}} = رقم الطلب
        // {{2}} = المبلغ
        // {{3}} = الحالة
        const contentVariables = {
            "1": orderData.orderNumber || 'N/A',
            "2": amount.toString(),
            "3": status
        };

        console.log('📋 Content Variables:', JSON.stringify(contentVariables));
        console.log('📤 From:', fromFormatted);
        console.log('📥 To:', `whatsapp:${cleanPhone}`);

        // إرسال الرسالة باستخدام Content Template
        const message = await twilioClient.messages.create({
            from: fromFormatted,
            to: `whatsapp:${cleanPhone}`,
            contentSid: 'HX1a819c43fcfcebe0b1c1e10b98f848aa', // Template SID
            contentVariables: JSON.stringify(contentVariables)
        });

        console.log(`✅ تم إرسال واتساب Twilio بنجاح!`);
        console.log(`📊 Message SID: ${message.sid}`);
        console.log(`📊 Status: ${message.status}`);

        return message;

    } catch (error) {
        console.error(`❌ Twilio Error:`, error.message);
        
        if (error.code) {
            console.error(`📋 Error Code: ${error.code}`);
        }
        
        if (error.moreInfo) {
            console.error(`📖 More Info: ${error.moreInfo}`);
        }

        if (error.status) {
            console.error(`📊 HTTP Status: ${error.status}`);
        }
        
        throw error;
    }
};

module.exports = {
    sendWhatsAppNotification
};