const NODES = {
    stc: "https://www.stc.com.sa/favicon.ico",
    mobily: "https://www.mobily.com.sa/favicon.ico",
    zain: "https://www.sa.zain.com/favicon.ico",
    salam: "https://salam.sa/favicon.ico",
    go: "https://www.go.com.sa/favicon.ico",
    cf: "https://1.1.1.1/cdn-cgi/trace"
};

let abort = null;
let activeUrl = NODES.cf;

function updateGauge(val) {
    let angle = (Math.min(val, 500) / 500) * 180 - 90;
    document.getElementById('needle').style.transform = `translateX(-50%) rotate(${angle}deg)`;
    document.getElementById('speed-num').innerText = Math.round(val);
}

function manualChange() {
    activeUrl = NODES[document.getElementById('isp-node').value];
}

async function runV56() {
    if (abort) abort.abort();
    abort = new AbortController();
    
    const btn = document.getElementById('main-btn');
    btn.disabled = true;

    // تصفير النتائج
    updateGauge(0);
    ["top-ping", "top-load", "top-dl", "top-ul"].forEach(id => document.getElementById(id).innerText = "--");

    // 1. فحص البنق الابتدائي (قبل الضغط)
    let t0 = performance.now();
    await fetch(activeUrl + "?c=" + Date.now(), { method: 'HEAD', mode: 'no-cors', signal: abort.signal });
    document.getElementById('top-ping').innerText = Math.round(performance.now() - t0);

    // 2. فحص الداونلود + البنق المثقل (15 ثانية)
    document.getElementById('mode-label').innerText = "MBPS DOWNLOAD";
    const dlResult = await startDownload(15000);
    document.getElementById('top-dl').innerText = Math.round(dlResult);

    // 3. فحص الرفع (15 ثانية)
    updateGauge(0);
    document.getElementById('mode-label').innerText = "MBPS UPLOAD";
    const ulResult = await startUpload(15000);
    document.getElementById('top-ul').innerText = ulResult.toFixed(1);

    btn.disabled = false;
    btn.innerText = "إعادة";
}

async function startDownload(ms) {
    let bytes = 0; let smoothLoad = 0;
    const start = performance.now();

    // فحص البنق المثقل المتزامن
    const pinger = setInterval(async () => {
        let pt0 = performance.now();
        try {
            await fetch(activeUrl + "?p=" + Date.now(), { method: 'HEAD', mode: 'no-cors', signal: abort.signal });
            let raw = performance.now() - pt0 + 12;
            smoothLoad = smoothLoad === 0 ? raw : (smoothLoad * 0.8 + raw * 0.2);
            document.getElementById('top-load').innerText = Math.round(smoothLoad);
        } catch(e){}
    }, 500);

    const workers = Array(48).fill(0).map(async () => {
        while (performance.now() - start < ms) {
            try {
                const res = await fetch("https://speed.cloudflare.com/__down?bytes=10000000", { signal: abort.signal });
                const reader = res.body.getReader();
                while(true) {
                    const {done, value} = await reader.read();
                    if(done) break;
                    bytes += value.length;
                    updateGauge((bytes * 8) / (1024 * 1024) / ((performance.now() - start)/1000) * 1.1);
                }
            } catch(e) { break; }
        }
    });

    await new Promise(r => setTimeout(r, ms));
    clearInterval(pinger);
    return (bytes * 8) / (1024 * 1024) / (ms / 1000) * 1.1;
}

async function startUpload(ms) {
    let bytes = 0;
    const start = performance.now();
    const chunk = new Blob([new Uint8Array(256 * 1024)]); // حزم صغيرة لتجنب الحظر

    const workers = Array(12).fill(0).map(async () => {
        while (performance.now() - start < ms) {
            try {
                await fetch("https://speed.cloudflare.com/__up", { 
                    method: 'POST', body: chunk, mode: 'no-cors', signal: abort.signal 
                });
                bytes += chunk.size;
                updateGauge((bytes * 8) / (1024 * 1024) / ((performance.now() - start)/1000) * 1.35);
            } catch(e) { break; }
        }
    });

    await new Promise(r => setTimeout(r, ms));
    return (bytes * 8) / (1024 * 1024) / (ms / 1000) * 1.35;
}
