# إعداد MongoDB Atlas مع Railway

## الخطوات المطلوبة:

### 1. إنشاء قاعدة بيانات MongoDB Atlas

#### أ. إنشاء حساب:
1. اذهب إلى [MongoDB Atlas](https://cloud.mongodb.com)
2. أنشئ حساب مجاني أو سجل دخول
3. اضغط "Build a Database"

#### ب. إنشاء Cluster:
1. اختر "M0 Sandbox" (مجاني)
2. اختر المنطقة الأقرب (مثل: AWS / eu-west-1)
3. اضغط "Create Cluster"
4. انتظر 3-5 دقائق حتى يكتمل الإعداد

#### ج. إعداد Database User:
1. اذهب إلى "Database Access" في القائمة الجانبية
2. اضغط "Add New Database User"
3. اختر "Password" كطريقة المصادقة
4. أدخل:
   - Username: `tabuk-admin`
   - Password: كلمة مرور قوية (احفظها!)
5. في Database User Privileges، اختر "Read and write to any database"
6. اضغط "Add User"

#### د. إعداد Network Access:
1. اذهب إلى "Network Access" في القائمة الجانبية
2. اضغط "Add IP Address"
3. اضغط "Allow access from anywhere" (0.0.0.0/0)
4. اضغط "Confirm"

#### هـ. الحصول على Connection String:
1. اذهب إلى "Database" في القائمة الجانبية
2. اضغط "Connect" بجانب cluster الخاص بك
3. اختر "Connect your application"
4. اختر "Node.js" و "4.1 or later"
5. انسخ Connection String
6. استبدل `<password>` بكلمة مرور المستخدم
7. استبدل `myFirstDatabase` بـ `tabuk-auto-parts`

**مثال على Connection String:**
```
mongodb+srv://tabuk-admin:YOUR_PASSWORD@cluster0.xxxxx.mongodb.net/tabuk-auto-parts?retryWrites=true&w=majority
```

### 2. إضافة المتغير في Railway

#### أ. في لوحة تحكم Railway:
1. اذهب إلى مشروعك
2. اضغط على "Variables" في القائمة الجانبية
3. اضغط "New Variable"
4. أضف:
   - **Name:** `MONGODB_URI`
   - **Value:** Connection String الذي نسخته (مع كلمة المرور الصحيحة)
5. اضغط "Add"

#### ب. إعادة النشر:
1. اضغط "Deployments" في القائمة الجانبية
2. اضغط "Redeploy" على آخر deployment
3. انتظر 5-10 دقائق

### 3. التحقق من النجاح

#### في لوجز Railway، يجب أن ترى:
```
✅ تم الاتصال بقاعدة البيانات MongoDB
🌐 قاعدة البيانات جاهزة ودائمة
🔗 الرابط: mongodb+srv://***:***@cluster0.xxxxx.mongodb.net/tabuk-auto-parts
🚀 السيرفر يعمل على البورت 10000
```

#### بدلاً من:
```
❌ متغير قاعدة البيانات غير محدد
⚠️ سيتم تشغيل الخادم بدون قاعدة بيانات (وضع احتياطي)
```

### 4. اختبار النظام

#### أ. اختبر رفع طلب:
1. اذهب إلى موقعك على Railway
2. اذهب إلى `/request-part.html`
3. املأ النموذج واضغط "إرسال الطلب"
4. يجب أن تحصل على رسالة نجاح مع رقم الطلب

#### ب. تحقق من صفحة الإدارة:
1. اذهب إلى `/admin.html`
2. يجب أن ترى الطلبات الجديدة

### 5. استكشاف الأخطاء

#### مشكلة: "Authentication failed"
**الحل:**
- تأكد من كلمة المرور في Connection String
- تأكد من أن المستخدم له صلاحيات صحيحة

#### مشكلة: "IP not whitelisted"
**الحل:**
- تأكد من إضافة 0.0.0.0/0 في Network Access
- أو أضف IP عناوين Railway المحددة

#### مشكلة: "Connection timeout"
**الحل:**
- تأكد من أن Cluster يعمل
- تحقق من إعدادات الشبكة

### 6. الأمان (اختياري)

#### لتحسين الأمان:
1. بدلاً من "Allow access from anywhere"
2. أضف IP عناوين Railway المحددة فقط
3. استخدم كلمة مرور قوية للمستخدم
4. قم بتدوير كلمة المرور بانتظام

**النظام جاهز للعمل مع قاعدة البيانات! 🎉**
