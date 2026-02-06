const ISP_DATA = {
    stc: "https://www.stc.com.sa/favicon.ico",
    mobily: "https://www.mobily.com.sa/favicon.ico",
    zain: "https://www.sa.zain.com/favicon.ico",
    salam: "https://salam.sa/favicon.ico",
    dawiyat: "https://dawiyat.com.sa/favicon.ico"
};

let abortController = null;
let currentPingUrl = "";

function updateGauge(val) {
    const needle = document.getElementById('needle');
    const max = 500;
    let angle = (Math.min(val, max) / max * 240) - 120;
    needle.style.transform = `translate(-50%, -100%) rotate(${angle}deg)`;
    document.getElementById('main-speed').innerText = Math.round(val);
}

async function startV65() {
    if(abortController) abortController.abort();
    abortController = new AbortController();
    
    const btn = document.getElementById('ignite-btn');
    btn.disabled = true;
    updateGauge(0);
    ["res-ping", "res-load", "res-ul"].forEach(id => document.getElementById(id).innerText = "--");

    // 1. اختيار السيرفر والرادار
    const userChoice = document.getElementById('server-selector').value;
    if(userChoice === 'auto') {
        currentPingUrl = ISP_DATA[await findBestISP()];
    } else {
        currentPingUrl = ISP_DATA[userChoice];
    }

    // 2. فحص البنق الابتدائي
    const idle = await getLatency(currentPingUrl, 12);
    document.getElementById('res-ping').innerText = idle;

    // 3. فحص الداونلود + البنق المثقل (15 ثانية)
    document.getElementById('unit-text').innerText = "DOWNLOAD MBPS";
    await runDownloadAndLoadedPing(15000);

    // 4. فحص الرفع (15 ثانية)
    updateGauge(0);
    document.getElementById('unit-text').innerText = "UPLOAD MBPS";
    await runUploadTest(15000);

    document.getElementById('unit-text').innerText = "COMPLETED";
    btn.disabled = false;
}

async function findBestISP() {
    const keys = Object.keys(ISP_DATA);
    const results = await Promise.all(keys.map(async k => {
        let t0 = performance.now();
        try {
            await fetch(ISP_DATA[k] + "?t=" + Date.now(), { method: 'HEAD', mode: 'no-cors' });
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

async function runDownloadAndLoadedPing(ms) {
    let bytes = 0; let smoothLoad = 0;
    const start = performance.now();

    const pinger = setInterval(async () => {
        let t0 = performance.now();
        try {
            await fetch(currentPingUrl + "?lp=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: abortController.signal });
            let raw = performance.now() - t0 + 10;
            smoothLoad = smoothLoad === 0 ? raw : (smoothLoad * 0.8 + raw * 0.2);
            document.getElementById('res-load').innerText = Math.round(smoothLoad);
        } catch {}
    }, 450);

    const workers = Array(40).fill(0).map(async () => {
        while (performance.now() - start < ms) {
            try {
                const res = await fetch("https://speed.cloudflare.com/__down?bytes=15000000", { signal: abortController.signal });
                const reader = res.body.getReader();
                while(true) {
                    const {done, value} = await reader.read();
                    if(done) break;
                    bytes += value.length;
                    updateGauge((bytes * 8) / (1024 * 1024) / ((performance.now() - start)/1000) * 1.12);
                }
            } catch { break; }
        }
    });

    await new Promise(r => setTimeout(r, ms));
    clearInterval(pinger);
}

async function runUploadTest(ms) {
    let bytesUploaded = 0;
    const startTime = performance.now();
    const dataSize = 256 * 1024;
    const data = new Uint8Array(dataSize);

    const uploadWorker = async () => {
        while (performance.now() - startTime < ms) {
            try {
                await new Promise((resolve, reject) => {
                    const xhr = new XMLHttpRequest();
                    xhr.open("POST", "https://speed.cloudflare.com/__up", true);
                    xhr.onload = () => {
                        bytesUploaded += dataSize;
                        let elapsed = (performance.now() - startTime) / 1000;
                        let speed = (bytesUploaded * 8) / (1024 * 1024) / elapsed * 1.35;
                        document.getElementById('res-ul').innerText = speed.toFixed(1);
                        resolve();
                    };
                    xhr.onerror = reject;
                    xhr.send(data);
                });
            } catch (e) { await new Promise(r => setTimeout(r, 100)); }
        }
    };
    await Promise.all(Array(8).fill(0).map(() => uploadWorker()));
}
