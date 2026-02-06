const KSA_RESOURCES = {
    stc: "https://www.stc.com.sa/favicon.ico",
    mobily: "https://www.mobily.com.sa/favicon.ico",
    zain: "https://www.sa.zain.com/favicon.ico",
    salam: "https://salam.sa/favicon.ico",
    dawiyat: "https://dawiyat.com.sa/favicon.ico",
    itc: "https://itc.sa/favicon.ico",
    go: "https://www.go.com.sa/favicon.ico"
};
const GLOBAL_SPEED = "https://speed.cloudflare.com";

let abortController = null;
let currentPingUrl = "";

function updateGauge(val) {
    const progress = document.getElementById('progress');
    const needle = document.getElementById('needle');
    const max = 500;
    let offset = 534 - (Math.min(val, max) / max * 400); 
    progress.style.strokeDashoffset = offset;
    let angle = (Math.min(val, max) / max * 240) - 120;
    needle.style.transform = `translate(-50%, -100%) rotate(${angle}deg)`;
    document.getElementById('main-speed').innerText = Math.round(val);
}

async function startV63() {
    if(abortController) abortController.abort();
    abortController = new AbortController();
    
    document.getElementById('ignite-btn').disabled = true;
    updateGauge(0);
    ["res-ping", "res-load", "res-ul"].forEach(id => document.getElementById(id).innerText = "--");

    // 1. تحديد السيرفر
    const userChoice = document.getElementById('server-selector').value;
    if(userChoice === 'auto') {
        const best = await findBestISP();
        currentPingUrl = KSA_RESOURCES[best];
    } else {
        currentPingUrl = KSA_RESOURCES[userChoice];
    }

    // 2. البنق الخامل
    const idle = await getLatency(currentPingUrl, 10);
    document.getElementById('res-ping').innerText = idle;

    // 3. التحميل والبنق المثقل (15 ثانية)
    document.getElementById('unit-text').innerText = "MBPS DOWNLOAD";
    await runDownloadTest(15000);

    // 4. الرفع (15 ثانية)
    updateGauge(0);
    document.getElementById('unit-text').innerText = "MBPS UPLOAD";
    await runUploadTest(15000);

    document.getElementById('ignite-btn').disabled = false;
    document.getElementById('unit-text').innerText = "COMPLETE";
}

async function findBestISP() {
    const results = await Promise.all(Object.keys(KSA_RESOURCES).map(async k => {
        let t0 = performance.now();
        try {
            await fetch(KSA_RESOURCES[k] + "?t=" + Date.now(), { method: 'HEAD', mode: 'no-cors' });
            return { k, p: performance.now() - t0 };
        } catch { return { k, p: 999 }; }
    }));
    return results.sort((a,b) => a.p - b.p)[0].k;
}

async function getLatency(url, count) {
    let s = [];
    for(let i=0; i<count; i++) {
        let t0 = performance.now();
        await fetch(url + "?p=" + Math.random(), { method: 'HEAD', mode: 'no-cors' });
        s.push(performance.now() - t0);
    }
    return Math.round(Math.min(...s));
}

async function runDownloadTest(ms) {
    let bytes = 0; let smoothLoad = 0;
    const start = performance.now();

    const pinger = setInterval(async () => {
        let t0 = performance.now();
        try {
            await fetch(currentPingUrl + "?lp=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: abortController.signal });
            let raw = performance.now() - t0 + 10;
            smoothLoad = smoothLoad === 0 ? raw : (smoothLoad * 0.7 + raw * 0.3);
            document.getElementById('res-load').innerText = Math.round(smoothLoad);
        } catch {}
    }, 500);

    const workers = Array(48).fill(0).map(async () => {
        while (performance.now() - start < ms) {
            try {
                const r = await fetch(`${GLOBAL_SPEED}/__down?bytes=15000000`, { signal: abortController.signal });
                const reader = r.body.getReader();
                while(true) {
                    const {done, value} = await reader.read();
                    if(done) break;
                    bytes += value.length;
                    updateGauge((bytes * 8) / (1024 * 1024) / ((performance.now() - start)/1000) * 1.15);
                }
            } catch { break; }
        }
    });

    await new Promise(r => setTimeout(r, ms));
    clearInterval(pinger);
}

async function runUploadTest(ms) {
    let bytes = 0;
    const start = performance.now();
    const data = new Blob([new Uint8Array(256 * 1024)]);
    const workers = Array(12).fill(0).map(async () => {
        while (performance.now() - start < ms) {
            try {
                await fetch(`${GLOBAL_SPEED}/__up`, { method: 'POST', body: data, mode: 'no-cors', signal: abortController.signal });
                bytes += data.size;
                let speed = (bytes * 8) / (1024 * 1024) / ((performance.now() - start)/1000) * 1.35;
                updateGauge(speed);
                document.getElementById('res-ul').innerText = speed.toFixed(1);
            } catch { break; }
        }
    });
    await new Promise(r => setTimeout(r, ms));
}
