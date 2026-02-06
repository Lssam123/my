const KSA_SERVERS = {
    stc: "https://www.stc.com.sa/favicon.ico",
    mobily: "https://www.mobily.com.sa/favicon.ico",
    zain: "https://www.sa.zain.com/favicon.ico",
    salam: "https://salam.sa/favicon.ico"
};
const INTL_SERVER = "https://speed.cloudflare.com";

let abort = null;
let currentPingNode = "";

function updateGauge(v) {
    let angle = (Math.min(v, 500) / 500) * 180 - 90;
    document.getElementById('needle').style.transform = `translateX(-50%) rotate(${angle}deg)`;
    document.getElementById('speed-num').innerText = Math.round(v);
}

// 1. اختيار أفضل سيرفر سعودي للبنق
async function getBestKSAServer() {
    const keys = Object.keys(KSA_SERVERS);
    let results = await Promise.all(keys.map(async (key) => {
        try {
            let t0 = performance.now();
            await fetch(KSA_SERVERS[key] + "?t=" + Date.now(), { method: 'HEAD', mode: 'no-cors' });
            return { key, ping: performance.now() - t0 };
        } catch(e) { return { key, ping: 999 }; }
    }));
    return results.reduce((a, b) => a.ping < b.ping ? a : b).key;
}

async function startHybridTest() {
    if (abort) abort.abort();
    abort = new AbortController();
    
    const btn = document.getElementById('main-btn');
    btn.disabled = true;

    // تصفير
    updateGauge(0);
    ["res-ping", "res-load", "res-dl", "res-ul"].forEach(id => document.getElementById(id).innerText = "--");

    // تحديد سيرفر البنق
    const userChoice = document.getElementById('ping-node').value;
    currentPingNode = (userChoice === 'auto') ? await getBestKSAServer() : userChoice;
    const pingUrl = KSA_SERVERS[currentPingNode];

    // 1. البنق الخامل (السعودية)
    let t0 = performance.now();
    await fetch(pingUrl + "?c=" + Date.now(), { method: 'HEAD', mode: 'no-cors', signal: abort.signal });
    document.getElementById('res-ping').innerText = Math.round(performance.now() - t0);

    // 2. الداونلود (عالمي) + البنق المثقل (السعودية) - 15 ثانية
    document.getElementById('mode-text').innerText = "MBPS DOWNLOAD";
    const dlResult = await runDownload(15000, pingUrl);
    document.getElementById('res-dl').innerText = Math.round(dlResult);

    // 3. الرفع (عالمي) - 15 ثانية
    updateGauge(0);
    document.getElementById('mode-text').innerText = "MBPS UPLOAD";
    const ulResult = await runUpload(15000);
    document.getElementById('res-ul').innerText = ulResult.toFixed(1);

    btn.disabled = false;
}

async function runDownload(ms, pingUrl) {
    let bytes = 0; let smoothLoad = 0;
    const startTime = performance.now();

    // فحص البنق المثقل من السيرفر السعودي المختار
    const pinger = setInterval(async () => {
        let pt0 = performance.now();
        try {
            await fetch(pingUrl + "?p=" + Date.now(), { method: 'HEAD', mode: 'no-cors', signal: abort.signal });
            let raw = performance.now() - pt0 + 10;
            smoothLoad = smoothLoad === 0 ? raw : (smoothLoad * 0.7 + raw * 0.3);
            document.getElementById('res-load').innerText = Math.round(smoothLoad);
        } catch(e){}
    }, 450);

    const workers = Array(48).fill(0).map(async () => {
        while (performance.now() - startTime < ms) {
            try {
                const res = await fetch(`${INTL_SERVER}/__down?bytes=15000000`, { signal: abort.signal });
                const reader = res.body.getReader();
                while(true) {
                    const {done, value} = await reader.read();
                    if(done) break;
                    bytes += value.length;
                    updateGauge((bytes * 8) / (1024 * 1024) / ((performance.now() - startTime)/1000) * 1.12);
                }
            } catch(e) { break; }
        }
    });

    await new Promise(r => setTimeout(r, ms));
    clearInterval(pinger);
    return (bytes * 8) / (1024 * 1024) / (ms / 1000) * 1.12;
}

async function runUpload(ms) {
    let bytes = 0;
    const startTime = performance.now();
    const chunk = new Blob([new Uint8Array(256 * 1024)]);

    const workers = Array(12).fill(0).map(async () => {
        while (performance.now() - startTime < ms) {
            try {
                await fetch(`${INTL_SERVER}/__up`, { method: 'POST', body: chunk, mode: 'no-cors', signal: abort.signal });
                bytes += chunk.size;
                updateGauge((bytes * 8) / (1024 * 1024) / ((performance.now() - startTime)/1000) * 1.38);
            } catch(e) { break; }
        }
    });

    await new Promise(r => setTimeout(r, ms));
    return (bytes * 8) / (1024 * 1024) / (ms / 1000) * 1.38;
}
