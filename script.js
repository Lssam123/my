const CONFIG = {
    // سيرفر STC لقياس البينق الصافي (مخفي المسمى)
    ping_url: "https://www.stc.com.sa/favicon.ico",
    dl_url: "https://speed.cloudflare.com/__down?bytes=26214400", // 25MB
    ul_url: "https://httpbin.org/post",
    threads: 32
};

async function startV17Engine() {
    // 1. فحص البينق الدقيق (تصحيح مشكلة الـ 900ms)
    const idlePing = await getPrecisionPing();
    document.getElementById('v-idle').innerText = idlePing.toFixed(1);

    // 2. فحص الداونلود (32 مسار - 25MB)
    const dlResult = await runAdvancedDL();
    document.getElementById('v-dl').innerText = Math.round(dlResult.speed);
    document.getElementById('v-loaded').innerText = dlResult.lPing.toFixed(1);

    // 3. فحص الابلود (حل مشكلة التوقف - ملف 20MB مقسم)
    const ulSpeed = await runStableUL();
    document.getElementById('v-ul').innerText = ulSpeed.toFixed(1);
}

// دالة البينق الاحترافية (تجاوز مشكلة التأخير البرمجي)
function getPrecisionPing() {
    return new Promise((resolve) => {
        const xhr = new XMLHttpRequest();
        const t0 = performance.now();
        xhr.open("GET", CONFIG.ping_url + "?t=" + t0, true);
        // نأخذ الوقت فور استلام "رؤوس البيانات" فقط وليس تحميل الملف كاملاً
        xhr.onreadystatechange = function() {
            if (xhr.readyState === 2) { 
                const t1 = performance.now();
                xhr.abort();
                resolve(t1 - t0);
            }
        };
        xhr.send();
    });
}

// محرك الرفع المستقر (حل مشكلة التوقف)
async function runStableUL() {
    let totalUploaded = 0;
    const startTime = performance.now();
    const duration = 10000; // 10 ثواني
    const chunkSize = 1024 * 1024; // 1MB لكل قطعة لتجنب الحظر والتوقف
    const data = new Uint8Array(chunkSize); 

    const workers = Array(10).fill(0).map(async () => {
        while (performance.now() - startTime < duration) {
            try {
                const uniqueID = Math.random().toString(36).substring(7);
                await fetch(CONFIG.ul_url + "?id=" + uniqueID, {
                    method: 'POST',
                    body: data, // إرسال 1MB تلو الآخر بسرعة عالية
                    mode: 'no-cors',
                    priority: 'high'
                });
                totalUploaded += chunkSize;
                // تحديث العداد فوراً
                const currentElapsed = (performance.now() - startTime) / 1000;
                const currentMbps = (totalUploaded * 8) / (1024 * 1024) / currentElapsed;
                document.getElementById('v-ul').innerText = currentMbps.toFixed(1);
            } catch (e) {
                console.error("Upload chunk failed, retrying...");
            }
        }
    });

    await new Promise(r => setTimeout(r, duration));
    const finalElapsed = (performance.now() - startTime) / 1000;
    return (totalUploaded * 8) / (1024 * 1024) / finalElapsed;
}

// محرك التحميل المتوازي (25MB)
async function runAdvancedDL() {
    let bytesReceived = 0;
    let lPings = [];
    const startTime = performance.now();
    const abort = new AbortController();

    const pinger = setInterval(async () => {
        const p = await getPrecisionPing();
        lPings.push(p);
    }, 250);

    const threads = Array(CONFIG.threads).fill(0).map(async () => {
        while (performance.now() - startTime < 10000) {
            try {
                const res = await fetch(CONFIG.dl_url + "&cache=" + Math.random(), { signal: abort.signal });
                const reader = res.body.getReader();
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    bytesReceived += value.length;
                    const elapsed = (performance.now() - startTime) / 1000;
                    const mbps = (bytesReceived * 8) / (1024 * 1024) / elapsed;
                    document.getElementById('v-dl').innerText = Math.round(mbps);
                    if (elapsed >= 10) break;
                }
            } catch (e) { break; }
        }
    });

    await new Promise(r => setTimeout(r, 10500));
    abort.abort();
    clearInterval(pinger);
    return {
        speed: (bytesReceived * 8) / (1024 * 1024) / 10,
        lPing: lPings.length ? lPings.reduce((a,b)=>a+b)/lPings.length : 0
    };
}
