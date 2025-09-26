# إعداد Railway للنشر

## الخطوات المطلوبة:

### 1. إعداد المتغيرات البيئية في Railway
في لوحة تحكم Railway، أضف المتغيرات التالية:

#### **متغيرات أساسية:**
```
NODE_ENV=production
PORT=3000
```

#### **قاعدة البيانات (مطلوب):**
```
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/tabuk-auto-parts
```
أو
```
DATABASE_URL=mongodb+srv://username:password@cluster.mongodb.net/tabuk-auto-parts
```

#### **Cloudinary (اختياري للصور):**
```
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
```

#### **البريد الإلكتروني (اختياري):**
```
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=your_email@gmail.com
EMAIL_PASS=your_app_password
```

### 2. إعداد قاعدة البيانات MongoDB Atlas

#### أ. إنشاء Cluster:
1. اذهب إلى [MongoDB Atlas](https://cloud.mongodb.com)
2. أنشئ حساب جديد أو سجل دخول
3. أنشئ Cluster مجاني
4. انتظر حتى يكتمل الإعداد (5-10 دقائق)

#### ب. إعداد المستخدم:
1. اذهب إلى Database Access
2. أضف مستخدم جديد
3. اختر "Password" كطريقة المصادقة
4. أعط المستخدم صلاحيات "Read and write to any database"

#### ج. إعداد Network Access:
1. اذهب إلى Network Access
2. أضف IP Address
3. اختر "Allow access from anywhere" (0.0.0.0/0)
4. أو أضف IP عناوين Railway المحددة

#### د. الحصول على Connection String:
1. اذهب إلى Clusters
2. اضغط "Connect"
3. اختر "Connect your application"
4. انسخ Connection String
5. استبدل `<password>` بكلمة مرور المستخدم
6. استبدل `<dbname>` بـ `tabuk-auto-parts`

### 3. النشر على Railway

#### أ. ربط GitHub:
1. اذهب إلى [Railway](https://railway.app)
2. سجل دخول بحساب GitHub
3. أنشئ مشروع جديد
4. اختر "Deploy from GitHub repo"
5. اختر repository: `tabuk-auto-parts`

#### ب. إعداد المتغيرات:
1. اذهب إلى Variables في لوحة تحكم المشروع
2. أضف جميع المتغيرات المذكورة أعلاه
3. احفظ التغييرات

#### ج. النشر:
1. سيتم النشر تلقائياً بعد إضافة المتغيرات
2. انتظر حتى يكتمل البناء (5-10 دقائق)
3. ستحصل على رابط الموقع

**ملاحظة:** إذا فشل البناء بسبب Nixpacks، جرب:
- احذف ملف `nixpacks.toml` إذا كان موجوداً
- أو غير Builder إلى "Dockerfile" في إعدادات المشروع

### 4. التحقق من النشر

#### أ. فحص اللوجز:
1. اذهب إلى Deployments
2. اضغط على آخر deployment
3. تحقق من اللوجز للتأكد من:
   - ✅ تم الاتصال بقاعدة البيانات
   - ✅ الخادم يعمل على البورت المحدد
   - ✅ لا توجد أخطاء

#### ب. اختبار الموقع:
1. افتح رابط الموقع
2. جرب رفع طلب قطع غيار
3. جرب رفع طلب بيع سيارة
4. تحقق من صفحة الإدارة

### 5. استكشاف الأخطاء

#### مشكلة: MONGODB_URI غير محدد
**الحل:**
- تأكد من إضافة `MONGODB_URI` في Variables
- أو استخدم `DATABASE_URL` بدلاً منه

#### مشكلة: خطأ SSL/TLS
**الحل:**
- تأكد من أن MongoDB Atlas يدعم TLS 1.2+
- تحقق من Network Access في MongoDB Atlas

#### مشكلة: الصور لا ترفع
**الحل:**
- أضف متغيرات Cloudinary
- أو سيتم استخدام التخزين المحلي (مؤقت)

### 6. المميزات

#### ✅ النظام يدعم:
- رفع طلبات قطع الغيار
- رفع طلبات بيع السيارات مع الصور
- صفحة إدارة للطلبات
- نظام احتياطي عند انقطاع قاعدة البيانات
- تخزين سحابي للصور (Cloudinary)
- إشعارات بريد إلكتروني

#### 🚀 الأداء:
- خادم سريع ومحسن
- ضغط البيانات
- حماية أمنية
- معالجة أخطاء ذكية

**الموقع جاهز للاستخدام! 🎉**
