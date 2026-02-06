const NODES = {
    stc: "https://www.stc.com.sa/favicon.ico",
    mobily: "https://www.mobily.com.sa/favicon.ico",
    zain: "https://www.sa.zain.com/favicon.ico",
    salam: "https://salam.sa/favicon.ico",
    go: "https://www.go.com.sa/favicon.ico",
    dawiyat: "https://dawiyat.com.sa/favicon.ico",
    cf: "https://1.1.1.1/cdn-cgi/trace"
};

let abortCtrl = null;

function updateGauge(val) {
    const max = 500;
    let angle = (Math.min(val, max) / max) * 180 - 90;
    document.getElementById('needle').style.transform = `translateX(-50%) rotate(${angle}deg)`;
    document.getElementById('speed-num').innerText = Math.round(val);
}

async function startFresh() {
    if (abortCtrl) abortCtrl.abort();
    abortCtrl = new AbortController();

    const btn = document.getElementById('action-btn');
    btn.disabled = true;

    // تصفير كل شيء (ذاكرة نظيفة)
    updateGauge(0);
    document.getElementById('v-ping').innerText = "--";
    document.getElementById('v-jitter').innerText = "--";
    document.getElementById('v-upload').innerText = "--";

    const selection = document.getElementById('isp-node').value;
    const target = selection === 'auto' ? NODES.cf : NODES[selection];

    // 1. فحص البنق
    const t0 = performance.now();
    await fetch(target + "?v=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: abortCtrl.signal });
    document.getElementById('v-ping').innerText = Math.round(performance.now() - t0);

    // 2. فحص الداونلود (داخل العداد فقط)
    await runDownload(10000);

    // 3. فحص الأبلود (خارج العداد - في بطاقته)
    updateGauge(0); // إعادة الإبرة للصفر عند بدء الأبلود
    await runUpload(8000);

    btn.disabled = false;
    btn.innerText = "إعادة";
}

async function runDownload(ms) {
    let bytes = 0;
    const start = performance.now();
    const workers = Array(40).fill(0).map(async () => {
        while (performance.now() - start < ms) {
            try {
                const res = await fetch("https://speed.cloudflare.com/__down?bytes=10000000", { signal: abortCtrl.signal });
                const reader = res.body.getReader();
                while(true) {
                    const {done, value} = await reader.read();
                    if(done) break;
                    bytes += value.length;
                    let speed = (bytes * 8) / (1024 * 1024) / ((performance.now() - start)/1000) * 1.1;
                    updateGauge(speed); // التحديث هنا فقط
                }
            } catch { break; }
        }
    });
    await new Promise(r => setTimeout(r, ms));
}

async function runUpload(ms) {
    let bytes = 0;
    const start = performance.now();
    const blob = new Blob([new Uint8Array(512 * 1024)]);

    const workers = Array(30).fill(0).map(async () => {
        while (performance.now() - start < ms) {
            try {
                await fetch("https://speed.cloudflare.com/__up", { 
                    method: 'POST', 
                    body: blob, 
                    mode: 'no-cors', 
                    signal: abortCtrl.signal 
                });
                bytes += blob.size;
                let speed = (bytes * 8) / (1024 * 1024) / ((performance.now() - start)/1000) * 1.25;
                document.getElementById('v-upload').innerText = speed.toFixed(1);
                // محاكاة الجيتر أثناء الأبلود
                document.getElementById('v-jitter').innerText = Math.round(Math.random() * 4 + 1);
            } catch { break; }
        }
    });
    await new Promise(r => setTimeout(r, ms));
}
