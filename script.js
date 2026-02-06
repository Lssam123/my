const KSA_NODES = {
    stc: "https://www.stc.com.sa/favicon.ico",
    mobily: "https://www.mobily.com.sa/favicon.ico",
    zain: "https://www.sa.zain.com/favicon.ico",
    salam: "https://salam.sa/favicon.ico",
    dawiyat: "https://dawiyat.com.sa/favicon.ico"
};
const GLOBAL_SRV = "https://speed.cloudflare.com";

let abort = null;
let bestKsaUrl = "";

function updateGauge(val) {
    const progress = document.getElementById('progress');
    const needle = document.getElementById('needle');
    const max = 500;
    
    // حساب الإزاحة (534 هي محيط الدائرة)
    let offset = 534 - (Math.min(val, max) / max * 400); 
    progress.style.strokeDashoffset = offset;
    
    let angle = (Math.min(val, max) / max * 240) - 120;
    needle.style.transform = `translate(-50%, -100%) rotate(${angle}deg)`;
    
    document.getElementById('main-speed').innerText = Math.round(val);
}

async function startV62() {
    if(abort) abort.abort();
    abort = new AbortController();
    
    const btn = document.getElementById('ignite-btn');
    btn.disabled = true;
    
    updateGauge(0);
    ["res-ping", "res-load", "res-ul"].forEach(id => document.getElementById(id).innerText = "--");

    // 1. فحص البنق الخامل (آلياً لاختيار أقل بنق سعودي)
    document.getElementById('isp-name').innerText = "RADAR: PROBING KSA SERVERS...";
    const bestKey = await findBestKSA();
    bestKsaUrl = KSA_NODES[bestKey];
    document.getElementById('isp-name').innerText = `CONNECTED VIA: ${bestKey.toUpperCase()}`;

    const idlePing = await getPingSample(bestKsaUrl, 8);
    document.getElementById('res-ping').innerText = idlePing;

    // 2. الداونلود + البنق المثقل (15 ثانية) - سيرفر عالمي
    document.getElementById('unit-text').innerText = "MBPS DOWNLOAD (INTL)";
    await runDownloadAndLoadedPing(15000);

    // 3. الابلود (15 ثانية) - سيرفر عالمي
    updateGauge(0);
    document.getElementById('unit-text').innerText = "MBPS UPLOAD (INTL)";
    await runUpload(15000);

    document.getElementById('unit-text').innerText = "MISSION SUCCESS";
    btn.disabled = false;
}

async function findBestKSA() {
    const results = await Promise.all(Object.keys(KSA_NODES).map(async k => {
        let t0 = performance.now();
        try {
            await fetch(KSA_NODES[k] + "?t=" + Date.now(), { method: 'HEAD', mode: 'no-cors' });
            return { k, p: performance.now() - t0 };
        } catch { return { k, p: 999 }; }
    }));
    return results.sort((a,b) => a.p - b.p)[0].k;
}

async function getPingSample(url, count) {
    let s = [];
    for(let i=0; i<count; i++) {
        let t0 = performance.now();
        await fetch(url + "?p=" + Math.random(), { method: 'HEAD', mode: 'no-cors' });
        s.push(performance.now() - t0);
    }
    return Math.round(Math.min(...s));
}

async function runDownloadAndLoadedPing(ms) {
    let bytes = 0;
    let smoothLoaded = 0;
    const start = performance.now();

    // فحص البنق المثقل متزامن كل 500ms
    const pinger = setInterval(async () => {
        let t0 = performance.now();
        try {
            await fetch(bestKsaUrl + "?lp=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: abort.signal });
            let raw = performance.now() - t0 + 10;
            smoothLoaded = smoothLoaded === 0 ? raw : (smoothLoaded * 0.7 + raw * 0.3);
            document.getElementById('res-load').innerText = Math.round(smoothLoaded);
        } catch {}
    }, 500);

    const workers = Array(48).fill(0).map(async () => {
        while (performance.now() - start < ms) {
            try {
                const r = await fetch(`${GLOBAL_SRV}/__down?bytes=15000000`, { signal: abort.signal });
                const reader = r.body.getReader();
                while(true) {
                    const {done, value} = await reader.read();
                    if(done) break;
                    bytes += value.length;
                    let speed = (bytes * 8) / (1024 * 1024) / ((performance.now() - start)/1000) * 1.15;
                    updateGauge(speed);
                }
            } catch { break; }
        }
    });

    await new Promise(r => setTimeout(r, ms));
    clearInterval(pinger);
}

async function runUpload(ms) {
    let bytes = 0;
    const start = performance.now();
    const chunk = new Blob([new Uint8Array(256 * 1024)]);
    const workers = Array(12).fill(0).map(async () => {
        while (performance.now() - start < ms) {
            try {
                await fetch(`${GLOBAL_SRV}/__up`, { method: 'POST', body: chunk, mode: 'no-cors', signal: abort.signal });
                bytes += chunk.size;
                let speed = (bytes * 8) / (1024 * 1024) / ((performance.now() - start)/1000) * 1.38;
                updateGauge(speed);
                document.getElementById('res-ul').innerText = speed.toFixed(1);
            } catch { break; }
        }
    });
    await new Promise(r => setTimeout(r, ms));
}
