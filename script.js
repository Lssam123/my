const NODES = {
    stc: "https://www.stc.com.sa/favicon.ico",
    mobily: "https://www.mobily.com.sa/favicon.ico",
    zain: "https://www.sa.zain.com/favicon.ico",
    salam: "https://salam.sa/favicon.ico",
    go: "https://www.go.com.sa/favicon.ico",
    dawiyat: "https://dawiyat.com.sa/favicon.ico"
};

let controller = null;
let activeUrl = "";

// إنشاء التدريج
const ticks = document.getElementById('ticks');
[0, 100, 200, 300, 400, 500].forEach(val => {
    let angle = (val / 500 * 240) - 120;
    ticks.innerHTML += `<span class="tick" style="--a: ${angle}deg">${val}</span>`;
});

function moveNeedle(val) {
    const n = document.getElementById('needle');
    let angle = (Math.min(val, 500) / 500 * 240) - 120;
    n.style.transform = `translate(-50%, -100%) rotate(${angle}deg)`;
    document.getElementById('main-speed').innerText = Math.round(val);
}

async function startTest() {
    if(controller) controller.abort();
    controller = new AbortController();
    
    document.getElementById('start-btn').disabled = true;
    moveNeedle(0);
    ["res-ping", "res-load", "res-ul"].forEach(id => document.getElementById(id).innerText = "--");

    // 1. اختيار السيرفر بدقة (رادار ثلاثي)
    const choice = document.getElementById('server-selector').value;
    activeUrl = (choice === 'auto') ? NODES[await getBestNode()] : NODES[choice];

    // 2. فحص البنق الخامل (5 ثوانٍ)
    document.getElementById('status-text').innerText = "فحص الاستجابة...";
    const idle = await runPingTimer(5000);
    document.getElementById('res-ping').innerText = idle;

    // 3. فحص التحميل + البنق المثقل (15 ثانية) - العداد يعمل
    document.getElementById('status-text').innerText = "جارِ التحميل...";
    await runDownload(15000);

    // 4. فحص الرفع (15 ثانية) - العداد يتوقف والرفع في بطاقته
    document.getElementById('status-text').innerText = "جارِ الرفع...";
    const needle = document.getElementById('needle');
    needle.style.transform = `translate(-50%, -100%) rotate(-120deg)`; // إعادة الإبرة للصفر
    await runUpload(15000);

    document.getElementById('status-text').innerText = "اكتمل الفحص";
    document.getElementById('start-btn').disabled = false;
}

async function getBestNode() {
    const keys = Object.keys(NODES);
    const checks = await Promise.all(keys.map(async k => {
        let t0 = performance.now();
        try {
            await fetch(NODES[k] + "?t=" + Date.now(), { method: 'HEAD', mode: 'no-cors' });
            return { k, p: performance.now() - t0 };
        } catch { return { k, p: 999 }; }
    }));
    return checks.sort((a,b) => a.p - b.p)[0].k;
}

async function runPingTimer(ms) {
    let latencies = [];
    const start = performance.now();
    while (performance.now() - start < ms) {
        let t0 = performance.now();
        try {
            await fetch(activeUrl + "?p=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: controller.signal });
            latencies.push(performance.now() - t0);
        } catch {}
        await new Promise(r => setTimeout(r, 200));
    }
    return latencies.length ? Math.round(Math.min(...latencies)) : "--";
}

async function runDownload(ms) {
    let bytes = 0; let smoothLoad = 0;
    const start = performance.now();
    const downloadAbort = new AbortController();

    const pinger = setInterval(async () => {
        let t0 = performance.now();
        try {
            await fetch(activeUrl + "?lp=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: controller.signal });
            let raw = performance.now() - t0 + 10;
            smoothLoad = smoothLoad === 0 ? raw : (smoothLoad * 0.7 + raw * 0.3);
            document.getElementById('res-load').innerText = Math.round(smoothLoad);
        } catch {}
    }, 400);

    const workers = Array(30).fill(0).map(async () => {
        while (performance.now() - start < ms && !downloadAbort.signal.aborted) {
            try {
                const res = await fetch("https://speed.cloudflare.com/__down?bytes=10000000", { signal: downloadAbort.signal });
                const reader = res.body.getReader();
                while(true) {
                    const {done, value} = await reader.read();
                    if(done || downloadAbort.signal.aborted) break;
                    bytes += value.length;
                    let speed = (bytes * 8) / (1024 * 1024) / ((performance.now() - start)/1000) * 1.05;
                    moveNeedle(speed);
                }
            } catch { break; }
        }
    });

    await new Promise(r => setTimeout(r, ms));
    downloadAbort.abort();
    clearInterval(pinger);
}

async function runUpload(ms) {
    let bytesUp = 0;
    const start = performance.now();
    const data = new Uint8Array(256 * 1024);

    const worker = async () => {
        while (performance.now() - start < ms) {
            try {
                await new Promise((res, rej) => {
                    const xhr = new XMLHttpRequest();
                    xhr.open("POST", "https://speed.cloudflare.com/__up", true);
                    xhr.onload = () => {
                        bytesUp += data.length;
                        let speed = (bytesUp * 8) / (1024 * 1024) / ((performance.now() - start)/1000) * 1.2;
                        document.getElementById('res-ul').innerText = speed.toFixed(1);
                        res();
                    };
                    xhr.onerror = rej;
                    xhr.send(data);
                });
            } catch { await new Promise(r => setTimeout(r, 100)); }
        }
    };
    await Promise.all(Array(6).fill(0).map(() => worker()));
}
