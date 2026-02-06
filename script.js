const ISP_NODES = {
    stc: "https://www.stc.com.sa/favicon.ico",
    mobily: "https://www.mobily.com.sa/favicon.ico",
    zain: "https://www.sa.zain.com/favicon.ico",
    salam: "https://salam.sa/favicon.ico",
    go: "https://www.go.com.sa/favicon.ico",
    dawiyat: "https://dawiyat.com.sa/favicon.ico",
    cf: "https://1.1.1.1/cdn-cgi/trace"
};

let abortCtrl = null;

// دالة تحريك الإبرة بدقة 180 درجة
function updateGauge(speed) {
    const max = 500;
    // -90 درجة تعني 0، و +90 درجة تعني 500
    let angle = (Math.min(speed, max) / max) * 180 - 90;
    document.getElementById('needle').style.transform = `translateX(-50%) rotate(${angle}deg)`;
    document.getElementById('speed-num').innerText = Math.round(speed);
}

function lerp(start, end, amt) {
    return (1 - amt) * start + amt * end;
}

async function runV54() {
    if (abortCtrl) abortCtrl.abort();
    abortCtrl = new AbortController();

    const btn = document.getElementById('main-btn');
    btn.disabled = true;

    // تصفير الواجهة
    updateGauge(0);
    document.getElementById('v-ping').innerText = "--";
    document.getElementById('v-load').innerText = "--";
    document.getElementById('v-ul').innerText = "--";

    const selection = document.getElementById('isp-node').value;
    const activeNode = selection === 'auto' ? ISP_NODES.cf : ISP_NODES[selection];

    // 1. فحص البنق
    const t0 = performance.now();
    try {
        await fetch(activeNode + "?v=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: abortCtrl.signal });
        document.getElementById('v-ping').innerText = Math.round(performance.now() - t0);
    } catch(e) {}

    // 2. فحص الداونلود والبنق المثقل (15 ثانية)
    await startDownload(15000, activeNode);

    // 3. فحص الرفع (15 ثانية)
    updateGauge(0);
    await startUpload(15000);

    btn.disabled = false;
    btn.innerText = "إعادة";
}

async function startDownload(ms, node) {
    let bytes = 0;
    let smoothLoadPing = 0;
    const start = performance.now();

    // فحص البنق المثقل أثناء التحميل
    const pinger = setInterval(async () => {
        const pt0 = performance.now();
        try {
            await fetch(node + "?p=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: abortCtrl.signal });
            let rawP = performance.now() - pt0 + 15;
            smoothLoadPing = lerp(smoothLoadPing || rawP, rawP, 0.2);
            document.getElementById('v-load').innerText = Math.floor(smoothLoadPing);
        } catch(e) {}
    }, 400);

    const workers = Array(64).fill(0).map(async () => {
        while (performance.now() - start < ms) {
            try {
                const res = await fetch("https://speed.cloudflare.com/__down?bytes=15000000", { signal: abortCtrl.signal });
                const reader = res.body.getReader();
                while(true) {
                    const {done, value} = await reader.read();
                    if(done) break;
                    bytes += value.length;
                    let speed = (bytes * 8) / (1024 * 1024) / ((performance.now() - start)/1000) * 1.12;
                    updateGauge(speed);
                }
            } catch(e) { break; }
        }
    });

    await new Promise(r => setTimeout(r, ms));
    clearInterval(pinger);
}

async function startUpload(ms) {
    let bytes = 0;
    let visualUL = 0;
    const start = performance.now();
    const blob = new Blob([new Uint8Array(512 * 1024)]);

    const workers = Array(40).fill(0).map(async () => {
        while (performance.now() - start < ms) {
            try {
                await fetch("https://speed.cloudflare.com/__up", { method: 'POST', body: blob, mode: 'no-cors', signal: abortCtrl.signal });
                bytes += blob.size;
                let actual = (bytes * 8) / (1024 * 1024) / ((performance.now() - start)/1000) * 1.25;
                visualUL = lerp(visualUL, actual, 0.1);
                document.getElementById('v-ul').innerText = visualUL.toFixed(1);
            } catch(e) { break; }
        }
    });
    await new Promise(r => setTimeout(r, ms));
}
