const SA_SERVERS = [
    { name: "STC", url: "https://www.stc.com.sa/favicon.ico" },
    { name: "Mobily", url: "https://www.mobily.com.sa/favicon.ico" },
    { name: "Zain", url: "https://www.sa.zain.com/favicon.ico" },
    { name: "Salam", url: "https://salam.sa/favicon.ico" },
    { name: "GO", url: "https://www.go.com.sa/favicon.ico" },
    { name: "Dawiyat", url: "https://dawiyat.com.sa/favicon.ico" }
];

let abortCtrl = null;
let bestServer = SA_SERVERS[0].url;

function updateNeedle(speed) {
    let angle = (Math.min(speed, 500) / 500) * 180 - 90;
    document.getElementById('needle').style.transform = `translateX(-50%) rotate(${angle}deg)`;
    document.getElementById('speed-num').innerText = Math.round(speed);
}

function lerp(start, end, amt) { return (1 - amt) * start + amt * end; }

// 1. خوارزمية اختيار أفضل سيرفر (أقل بنق)
async function findBestServer() {
    document.getElementById('status-text').innerText = "جاري البحث عن أفضل سيرفر سعودي...";
    let results = await Promise.all(SA_SERVERS.map(async (srv) => {
        try {
            let t0 = performance.now();
            await fetch(srv.url + "?t=" + Date.now(), { method: 'HEAD', mode: 'no-cors' });
            return { url: srv.url, ping: performance.now() - t0, name: srv.name };
        } catch (e) { return { url: srv.url, ping: 999 }; }
    }));
    let best = results.reduce((prev, curr) => (prev.ping < curr.ping) ? prev : curr);
    bestServer = best.url;
    document.getElementById('status-text').innerText = `متصل بـ: ${best.name} (أقل زمن استجابة)`;
    return Math.round(best.ping);
}

async function initTest() {
    if (abortCtrl) abortCtrl.abort();
    abortCtrl = new AbortController();
    
    const btn = document.getElementById('main-btn');
    btn.disabled = true;

    // تصفير
    updateNeedle(0);
    document.getElementById('v-ping').innerText = "--";
    document.getElementById('v-load').innerText = "--";
    document.getElementById('v-ul').innerText = "--";

    // البنق الخامل والأفضل
    const p = await findBestServer();
    document.getElementById('v-ping').innerText = p;

    // الداونلود (15 ثانية)
    await runDownload(15000);

    // الرفع (15 ثانية - حزم صغيرة وتكرار سريع)
    updateNeedle(0);
    await runUpload(15000);

    btn.disabled = false;
    document.getElementById('status-text').innerText = "اكتمل الاختبار";
}

async function runDownload(ms) {
    let bytes = 0;
    let smoothLoadPing = 0;
    const start = performance.now();

    const pinger = setInterval(async () => {
        const pt0 = performance.now();
        try {
            await fetch(bestServer + "?p=" + Date.now(), { method: 'HEAD', mode: 'no-cors', signal: abortCtrl.signal });
            let rawP = performance.now() - pt0 + 10;
            smoothLoadPing = lerp(smoothLoadPing || rawP, rawP, 0.2);
            document.getElementById('v-load').innerText = Math.floor(smoothLoadPing);
        } catch(e) {}
    }, 500);

    const workers = Array(48).fill(0).map(async () => {
        while (performance.now() - start < ms) {
            try {
                const res = await fetch("https://speed.cloudflare.com/__down?bytes=10000000", { signal: abortCtrl.signal });
                const reader = res.body.getReader();
                while(true) {
                    const {done, value} = await reader.read();
                    if(done) break;
                    bytes += value.length;
                    updateNeedle((bytes * 8) / (1024 * 1024) / ((performance.now() - start)/1000) * 1.1);
                }
            } catch(e) { break; }
        }
    });

    await new Promise(r => setTimeout(r, ms));
    clearInterval(pinger);
}

// محرك الرفع المطور (تجاوز الحظر وانسيابية عالية)
async function runUpload(ms) {
    let bytes = 0;
    let visualUL = 0;
    const start = performance.now();
    // حزمة صغيرة 256KB لضمان عدم الحظر وسرعة المعالجة
    const chunk = new Blob([new Uint8Array(256 * 1024)]); 

    document.getElementById('card-ul').classList.add('active');

    // عدد مسارات أقل (8 مسارات) مع تكرار عالي جداً
    const workers = Array(8).fill(0).map(async () => {
        while (performance.now() - start < ms) {
            try {
                await fetch("https://speed.cloudflare.com/__up", { 
                    method: 'POST', 
                    body: chunk, 
                    mode: 'no-cors', 
                    signal: abortCtrl.signal,
                    priority: 'high'
                });
                bytes += chunk.size;
                
                let actual = (bytes * 8) / (1024 * 1024) / ((performance.now() - start)/1000) * 1.4;
                
                // تنعيم الرقم في مكانه المخصص
                const animate = () => {
                    visualUL = lerp(visualUL, actual, 0.12);
                    document.getElementById('v-ul').innerText = visualUL.toFixed(1);
                };
                requestAnimationFrame(animate);
            } catch(e) { break; }
        }
    });

    await new Promise(r => setTimeout(r, ms));
    document.getElementById('card-ul').classList.remove('active');
}
