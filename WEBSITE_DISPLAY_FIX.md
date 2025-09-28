# 🔧 إصلاح مشكلة عرض الموقع - HTML يظهر كنص خام

## 🚨 **المشكلة:**
الموقع يظهر كود HTML خام بدلاً من الصفحة المُنسقة، مما يعني أن المتصفح لا يتعرف على الملف كـ HTML.

## 🔍 **السبب:**
- الخادم يرسل ملفات HTML بـ `Content-Type: text/plain` بدلاً من `text/html`
- إعداد الـ headers العام يؤثر على الملفات الثابتة

## ✅ **الإصلاحات المطبقة:**

### **1. إصلاح Content-Type Headers:**
```javascript
// قبل الإصلاح (يؤثر على جميع الملفات)
res.header('Content-Type', 'application/json; charset=utf-8');

// بعد الإصلاح (فقط للـ API)
if (req.path.startsWith('/api/')) {
    res.header('Content-Type', 'application/json; charset=utf-8');
}
```

### **2. إعداد Static Files بشكل صحيح:**
```javascript
app.use(express.static(path.join(__dirname, 'public'), {
    setHeaders: (res, path) => {
        // تعيين Content-Type الصحيح للملفات HTML
        if (path.endsWith('.html')) {
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
        }
        // تعيين Content-Type للملفات CSS
        if (path.endsWith('.css')) {
            res.setHeader('Content-Type', 'text/css; charset=utf-8');
        }
        // تعيين Content-Type للملفات JavaScript
        if (path.endsWith('.js')) {
            res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        }
    }
}));
```

### **3. إضافة Routes صريحة للصفحات:**
```javascript
// Route للصفحة الرئيسية
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Routes للصفحات الأخرى
app.get('/request', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'request.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});
```

## 🎯 **النتيجة المتوقعة:**

### **بعد الإصلاحات:**
- ✅ **الصفحة الرئيسية تظهر بشكل صحيح**
- ✅ **صفحة "اطلبها" تعمل بشكل طبيعي**
- ✅ **لوحة الإدارة تظهر بالتنسيق الصحيح**
- ✅ **ملفات CSS و JavaScript تُحمل بشكل صحيح**

### **Headers الصحيحة:**
```
Content-Type: text/html; charset=utf-8        (للملفات HTML)
Content-Type: text/css; charset=utf-8         (للملفات CSS)
Content-Type: application/javascript; charset=utf-8  (للملفات JS)
Content-Type: application/json; charset=utf-8 (للـ API فقط)
```

## 🚀 **للاختبار:**

### **1. فحص الصفحة الرئيسية:**
```
https://tabuk-auto-parts-production.up.railway.app/
```

### **2. فحص صفحة الطلبات:**
```
https://tabuk-auto-parts-production.up.railway.app/request
```

### **3. فحص Headers في Developer Tools:**
```
Network Tab → اختر أي ملف HTML → Headers
Content-Type: text/html; charset=utf-8 ✅
```

## 🔧 **إذا استمرت المشكلة:**

### **تحقق من:**
1. **Cache المتصفح** - امسح الـ cache وأعد التحميل
2. **CDN/Proxy** - تأكد من عدم وجود proxy يغير الـ headers
3. **Railway Settings** - تأكد من عدم وجود إعدادات تؤثر على الـ headers

### **اختبار سريع:**
```bash
curl -I https://your-railway-url.railway.app/
# يجب أن ترى: Content-Type: text/html; charset=utf-8
```

**🎉 الموقع سيظهر بشكل صحيح بعد هذه الإصلاحات!**
