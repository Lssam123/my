// روابط اختبار عالمية لضمان الدقة
const TEST_FILE = "https://speed.cloudflare.com/__down?bytes=50000000"; // 50MB
const PING_ENDPOINT = "https://1.1.1.1/cdn-cgi/trace";

async function masterTest() {
    const btn = document.getElementById('main-action');
    const status = document.getElementById('status-text');
    btn.disabled = true;

    try {
        // المرحلة 1: Ping خامل (Unloaded)
        status.innerText = "جاري قياس زمن الاستجابة الخامل...";
        const idlePingData = await measurePing(5);
        document.getElementById('ping-idle').innerText = idlePingData.avg.toFixed(1);
        document.getElementById('jitter').innerText = idlePingData.jitter.toFixed(1);

        // المرحلة 2: التحميل و Ping المثقل (Loaded Download)
        status.innerText = "جاري قياس التحميل والـ Ping المثقل...";
        const downloadData = await measureDownloadWithPing();
        document.getElementById('download-res').innerText = downloadData.speed;
        document.getElementById('ping-loaded').innerText = downloadData.loadedPing.toFixed(1);

        // المرحلة 3: الرفع (محاكاة دقيقة للرفع)
        status.innerText = "جاري قياس سرعة الرفع...";
        const uploadSpeed = await measureUpload();
        document.getElementById('upload-res').innerText = uploadSpeed;

        status.innerText = "اكتمل الاختبار بنجاح";
    } catch (e) {
        status.innerText = "خطأ في الاتصال، حاول مرة أخرى";
        console.error(e);
    } finally {
        btn.disabled = false;
        btn.innerText = "إعادة الاختبار";
    }
}

// دالة قياس Ping متقدمة
async function measurePing(samples) {
    let times = [];
    for (let i = 0; i < samples; i++) {
        const start = performance.now();
        await fetch(PING_ENDPOINT + "?n=" + i, { mode: 'no-cors', cache: 'no-cache' });
        times.push(performance.now() - start);
    }
    const avg = times.reduce((a, b) => a + b) / times.length;
    const jitter = Math.max(...times) - Math.min(...times);
    return { avg, jitter };
}

// دالة التحميل مع قياس الـ Ping أثناء الضغط (Loaded Ping)
async function measureDownloadWithPing() {
    const startTime = performance.now();
    let loadedPings = [];
    
    // بدء قياس الـ Ping في الخلفية أثناء التحميل
    const pingInterval = setInterval(async () => {
        const pStart = performance.now();
        await fetch(PING_ENDPOINT + "?load=1", { mode: 'no-cors', cache: 'no-cache' });
        loadedPings.push(performance.now() - pStart);
    }, 150);

    const response = await fetch(TEST_FILE + "&cache=" + Math.random());
    const reader = response.body.getReader();
    let receivedBytes = 0;

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        receivedBytes += value.length;
        const duration = (performance.now() - startTime) / 1000;
        const mbps = ((receivedBytes * 8) / (1024 * 1024) / duration).toFixed(2);
        document.getElementById('speed-display').innerText = Math.round(mbps);
    }

    clearInterval(pingInterval);
    const avgLoadedPing = loadedPings.length > 0 ? (loadedPings.reduce((a, b) => a + b) / loadedPings.length) : 0;
    
    return { 
        speed: ( (receivedBytes * 8) / (1024 * 1024) / ((performance.now() - startTime) / 1000) ).toFixed(2),
        loadedPing: avgLoadedPing
    };
}

// دالة الرفع (Upload) باستخدام POST لبيانات وهمية
async function measureUpload() {
    const data = new Uint8Array(5 * 1024 * 1024); // 5MB من البيانات العشوائية
    const start = performance.now();
    
    // نستخدم أحد سيرفرات الاختبار التي تقبل POST
    await fetch('https://httpbin.org/post', {
        method: 'POST',
        body: data
    });
    
    const duration = (performance.now() - start) / 1000;
    return ((data.length * 8) / (1024 * 1024) / duration).toFixed(2);
}
