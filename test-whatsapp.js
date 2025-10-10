#!/usr/bin/env node
/**
 * سكريبت اختبار إرسال إشعارات الواتس اب
 * 
 * للتشغيل:
 * node test-whatsapp.js
 */

require('dotenv').config();

console.log('🔍 اختبار إعدادات الواتس اب...\n');

// فحص المتغيرات البيئية
const requiredVars = {
    'TWILIO_ACCOUNT_SID': process.env.TWILIO_ACCOUNT_SID,
    'TWILIO_AUTH_TOKEN': process.env.TWILIO_AUTH_TOKEN,
    'TWILIO_FROM_WHATSAPP': process.env.TWILIO_FROM_WHATSAPP,
    'ADMIN_WHATSAPP_1': process.env.ADMIN_WHATSAPP_1
};

console.log('📋 فحص المتغيرات البيئية:');
console.log('─'.repeat(40));

let allVarsSet = true;
for (const [name, value] of Object.entries(requiredVars)) {
    if (value) {
        // إخفاء جزء من القيمة للأمان
        const masked = value.length > 10 
            ? value.substring(0, 6) + '****' + value.substring(value.length - 4)
            : '****';
        console.log(`✅ ${name}: ${masked}`);
    } else {
        console.log(`❌ ${name}: غير مُعرّف`);
        allVarsSet = false;
    }
}

console.log('─'.repeat(40));

if (!allVarsSet) {
    console.log('\n⚠️ تحذير: بعض المتغيرات البيئية مفقودة!');
    console.log('تأكد من تعريف جميع المتغيرات في ملف .env\n');
    process.exit(1);
}

// محاولة إرسال رسالة اختبار
console.log('\n📤 محاولة إرسال رسالة اختبار...\n');

const twilio = require('twilio');
const client = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
);

// تجهيز رقم المرسل
let fromNumber = process.env.TWILIO_FROM_WHATSAPP;
if (!fromNumber.startsWith('whatsapp:')) {
    fromNumber = `whatsapp:${fromNumber}`;
}

// تجهيز رقم المستقبل
let toNumber = process.env.ADMIN_WHATSAPP_1;
if (!toNumber.startsWith('+')) {
    toNumber = `+${toNumber}`;
}
toNumber = `whatsapp:${toNumber}`;

const testMessage = `🔔 *رسالة اختبار من نظام تشاليح تبوك*

✅ إعدادات الواتس اب تعمل بشكل صحيح!

📅 التاريخ: ${new Date().toLocaleString('ar-SA')}
🔧 هذه رسالة اختبار تلقائية

━━━━━━━━━━━━━━━━━━━━━━
✅ النظام جاهز لإرسال الإشعارات`;

console.log(`📱 من: ${fromNumber}`);
console.log(`📱 إلى: ${toNumber}`);
console.log('─'.repeat(40));

client.messages
    .create({
        from: fromNumber,
        to: toNumber,
        body: testMessage
    })
    .then(message => {
        console.log('\n✅ تم إرسال الرسالة بنجاح!');
        console.log(`📊 Message SID: ${message.sid}`);
        console.log(`📊 Status: ${message.status}`);
        console.log(`📊 Date Created: ${message.dateCreated}`);
        console.log('\n🎉 إعدادات الواتس اب تعمل بشكل ممتاز!');
    })
    .catch(error => {
        console.log('\n❌ فشل إرسال الرسالة!');
        console.log('─'.repeat(40));
        console.error('خطأ:', error.message);
        
        if (error.code) {
            console.error(`رمز الخطأ: ${error.code}`);
        }
        
        if (error.moreInfo) {
            console.error(`معلومات إضافية: ${error.moreInfo}`);
        }

        console.log('\n💡 حلول مقترحة:');
        console.log('─'.repeat(40));
        
        if (error.code === 20003) {
            console.log('• تأكد من صحة بيانات حساب Twilio');
            console.log('• تحقق من TWILIO_ACCOUNT_SID و TWILIO_AUTH_TOKEN');
        } else if (error.code === 21211) {
            console.log('• رقم الهاتف غير صحيح');
            console.log('• تأكد من صيغة الرقم: +966XXXXXXXXX');
        } else if (error.code === 63003) {
            console.log('• رقم الواتس اب المرسل غير مُفعّل في Twilio');
            console.log('• تأكد من تفعيل رقم الواتس اب في لوحة تحكم Twilio');
        } else if (error.code === 63016) {
            console.log('• المستقبل لم يبدأ محادثة مع رقم الواتس اب');
            console.log('• يجب على المستقبل إرسال رسالة أولاً لرقم الواتس اب');
        } else {
            console.log('• راجع إعدادات Twilio في: https://console.twilio.com');
            console.log('• تأكد من رصيد الحساب في Twilio');
        }
        
        process.exit(1);
    });