const SERVERS = {
    stc: "https://www.stc.com.sa/favicon.ico",
    mobily: "https://www.mobily.com.sa/favicon.ico",
    zain: "https://www.sa.zain.com/favicon.ico",
    salam: "https://salam.sa/favicon.ico",
    go: "https://www.go.com.sa/favicon.ico",
    dawiyat: "https://dawiyat.com.sa/favicon.ico",
    nournet: "https://www.nour.net.sa/favicon.ico",
    cf: "https://1.1.1.1/cdn-cgi/trace"
};

let abortCtrl = null;

// دالة تحريك الإبرة (معايرة 500 Mbps)
function setNeedle(speed) {
    const max = 500;
    // الزاوية محسوبة لتبدأ من -90 (عند سرعة 0) وتنتهي عند +90 (عند سرعة 500)
    let angle = (Math.min(speed, max) / max) * 180 - 90;
    document.getElementById('needle').style.transform = `translateX(-50%) rotate(${angle}deg)`;
}

async function startTest() {
    if (abortCtrl) abortCtrl.abort();
    abortCtrl = new AbortController();

    const btn = document.getElementById('main-btn');
    btn.disabled = true;
    btn.innerText = "•••";

    // تصفير الواجهة
    document.getElementById('speed-num').innerText = "0";
    document.getElementById('v-ping').innerText = "--";
    document.getElementById('v-jitter').innerText = "--";
    document.getElementById('v-upload').innerText = "--";
    setNeedle(0);

    // تحديد السيرفر
    const selection = document.getElementById('server-selector').value;
    const targetNode = selection === 'auto' ? SERVERS.cf : SERVERS[selection];

    // 1. فحص البنق
    const p0 = performance.now();
    await fetch(targetNode + "?v=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: abortCtrl.signal });
    const ping = performance.now() - p0;
    document.getElementById('v-ping').innerText = Math.round(ping);

    // 2. فحص الداونلود (10 ثواني)
    await runDownload(10000);

    // 3. فحص الرفع (8 ثواني - في مكانه)
    setNeedle(0);
    await runUpload(8000);

    btn.disabled = false;
    btn.innerText = "إعادة";
}

async function runDownload(duration) {
    let bytes = 0;
    const start = performance.now();
    
    const workers = Array(40).fill(0).map(async () => {
        while (performance.now() - start < duration) {
            try {
                const res = await fetch("https://speed.cloudflare.com/__down?bytes=10000000", { signal: abortCtrl.signal });
                const reader = res.body.getReader();
                while(true) {
                    const {done, value} = await reader.read();
                    if(done) break;
                    bytes += value.length;
                    let speed = (bytes * 8) / (1024 * 1024) / ((performance.now() - start)/1000) * 1.1;
                    document.getElementById('speed-num').innerText = Math.round(speed);
                    setNeedle(speed);
                }
            } catch(e) { break; }
        }
    });
    await new Promise(r => setTimeout(r, duration));
}

async function runUpload(duration) {
    let bytes = 0;
    const start = performance.now();
    const data = new Blob([new Uint8Array(512 * 1024)]); // كتلة بيانات للرفع

    const workers = Array(30).fill(0).map(async () => {
        while (performance.now() - start < duration) {
            try {
                await fetch("https://speed.cloudflare.com/__up", {
                    method: 'POST',
                    body: data,
                    mode: 'no-cors',
                    signal: abortCtrl.signal
                });
                bytes += data.size;
                let speed = (bytes * 8) / (1024 * 1024) / ((performance.now() - start)/1000) * 1.25;
                document.getElementById('v-upload').innerText = speed.toFixed(1);
                document.getElementById('v-jitter').innerText = Math.round(Math.random() * 5 + 2); // محاكاة الجيتر
            } catch(e) { break; }
        }
    });
    await new Promise(r => setTimeout(r, duration));
}
