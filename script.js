const SERVERS = {
    stc: "https://www.stc.com.sa/favicon.ico",
    mobily: "https://www.mobily.com.sa/favicon.ico",
    zain: "https://www.sa.zain.com/favicon.ico",
    salam: "https://salam.sa/favicon.ico",
    go: "https://www.go.com.sa/favicon.ico",
    dawiyat: "https://dawiyat.com.sa/favicon.ico"
};

let abort = null;
let currentUrl = "";

function updateGauge(val) {
    const needle = document.getElementById('needle');
    const max = 500;
    let angle = (Math.min(val, max) / max * 240) - 120;
    needle.style.transform = `translate(-50%, -100%) rotate(${angle}deg)`;
    document.getElementById('main-speed').innerText = Math.round(val);
}

async function startV67() {
    if(abort) abort.abort();
    abort = new AbortController();
    
    document.getElementById('ignite-btn').disabled = true;
    updateGauge(0);
    ["res-ping", "res-load", "res-ul"].forEach(id => document.getElementById(id).innerText = "--");

    const selection = document.getElementById('server-selector').value;
    currentUrl = (selection === 'auto') ? SERVERS[await findFastest()] : SERVERS[selection];

    // 1. فحص البنق
    document.getElementById('mode-text').innerText = "فحص الاستجابة...";
    const idle = await getPing(currentUrl, 10);
    document.getElementById('res-ping').innerText = idle;

    // 2. تحميل + بنق مثقل (15 ثانية)
    document.getElementById('mode-text').innerText = "جارِ التحميل...";
    await runDownload(15000);

    // 3. رفع (15 ثانية)
    updateGauge(0);
    document.getElementById('mode-text').innerText = "جارِ الرفع...";
    await runUpload(15000);

    document.getElementById('mode-text').innerText = "اكتمل الفحص";
    document.getElementById('ignite-btn').disabled = false;
}

async function findFastest() {
    const results = await Promise.all(Object.keys(SERVERS).map(async k => {
        let t0 = performance.now();
        try { await fetch(SERVERS[k] + "?t=" + Date.now(), { method: 'HEAD', mode: 'no-cors' }); return { k, p: performance.now() - t0 }; }
        catch { return { k, p: 999 }; }
    }));
    return results.sort((a,b) => a.p - b.p)[0].k;
}

async function getPing(url, count) {
    let s = [];
    for(let i=0; i<count; i++) {
        let t0 = performance.now();
        await fetch(url + "?p=" + Math.random(), { method: 'HEAD', mode: 'no-cors' });
        s.push(performance.now() - t0);
    }
    return Math.round(Math.min(...s));
}

async function runDownload(ms) {
    let bytes = 0; let smoothLoad = 0;
    const start = performance.now();

    const pinger = setInterval(async () => {
        let t0 = performance.now();
        try {
            await fetch(currentUrl + "?lp=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: abort.signal });
            let raw = performance.now() - t0 + 10;
            smoothLoad = smoothLoad === 0 ? raw : (smoothLoad * 0.8 + raw * 0.2);
            document.getElementById('res-load').innerText = Math.round(smoothLoad);
        } catch {}
    }, 450);

    const workers = Array(40).fill(0).map(async () => {
        while (performance.now() - start < ms) {
            try {
                const res = await fetch("https://speed.cloudflare.com/__down?bytes=15000000", { signal: abort.signal });
                const reader = res.body.getReader();
                while(true) {
                    const {done, value} = await reader.read();
                    if(done) break;
                    bytes += value.length;
                    updateGauge((bytes * 8) / (1024 * 1024) / ((performance.now() - start)/1000) * 1.1);
                }
            } catch { break; }
        }
    });

    await new Promise(r => setTimeout(r, ms));
    clearInterval(pinger);
}

async function runUpload(ms) {
    let bytesUploaded = 0;
    const startTime = performance.now();
    const data = new Uint8Array(256 * 1024);

    const uploadWorker = async () => {
        while (performance.now() - startTime < ms) {
            try {
                await new Promise((resolve, reject) => {
                    const xhr = new XMLHttpRequest();
                    xhr.open("POST", "https://speed.cloudflare.com/__up", true);
                    xhr.onload = () => {
                        bytesUploaded += data.length;
                        let elapsed = (performance.now() - startTime) / 1000;
                        let speed = (bytesUploaded * 8) / (1024 * 1024) / elapsed * 1.35;
                        updateGauge(speed);
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
