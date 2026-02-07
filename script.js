const NODES = {
    stc: "https://www.stc.com.sa/favicon.ico",
    mobily: "https://www.mobily.com.sa/favicon.ico",
    zain: "https://www.sa.zain.com/favicon.ico",
    salam: "https://salam.sa/favicon.ico",
    go: "https://www.go.com.sa/favicon.ico",
    dawiyat: "https://dawiyat.com.sa/favicon.ico"
};

let ctrl = null;
let activeUrl = "";

// إنشاء التدريج (المعايرة من 0 إلى 500)
const ticksContainer = document.getElementById('ticks');
[0, 100, 200, 300, 400, 500].forEach(val => {
    let angle = (val / 500 * 240) - 120;
    ticksContainer.innerHTML += `<span class="tick" style="--a: ${angle}deg">${val}</span>`;
});

function moveNeedle(val) {
    const needle = document.getElementById('needle');
    // الزاوية محسوبة بدقة: 0Mbps = -120deg | 500Mbps = +120deg
    let angle = (Math.min(val, 500) / 500 * 240) - 120;
    needle.style.transform = `translate(-50%, -100%) rotate(${angle}deg)`;
    document.getElementById('main-speed').innerText = Math.round(val);
}

async function startTest() {
    if(ctrl) ctrl.abort();
    ctrl = new AbortController();
    
    document.getElementById('start-btn').disabled = true;
    moveNeedle(0); // تعود للصفر المطابق تماماً للرقم 0
    document.getElementById('res-ul').innerText = "--";

    const choice = document.getElementById('server-selector').value;
    activeUrl = (choice === 'auto') ? NODES[await getBest()] : NODES[choice];

    // 1. فحص البنق (5 ثوانٍ)
    document.getElementById('status-text').innerText = "فحص الاستجابة...";
    const idlePing = await runPing(5000);
    document.getElementById('res-ping').innerText = idlePing;

    // 2. تحميل + بنق مثقل (15 ثانية)
    document.getElementById('status-text').innerText = "فحص التحميل...";
    await runDownload(15000);

    // 3. رفع (15 ثانية) - الإبرة تعود للصفر والنتائج ثابتة
    document.getElementById('status-text').innerText = "فحص الرفع...";
    const needle = document.getElementById('needle');
    needle.style.transform = `translate(-50%, -100%) rotate(-120deg)`;
    
    await runUpload(15000);

    document.getElementById('status-text').innerText = "اكتمل الفحص";
    document.getElementById('start-btn').disabled = false;
}

async function getBest() {
    const keys = Object.keys(NODES);
    const results = await Promise.all(keys.map(async k => {
        let t0 = performance.now();
        try { await fetch(NODES[k] + "?t=" + Date.now(), { method: 'HEAD', mode: 'no-cors' }); return { k, p: performance.now() - t0 }; }
        catch { return { k, p: 999 }; }
    }));
    return results.sort((a,b) => a.p - b.p)[0].k;
}

async function runPing(ms) {
    let list = [];
    const start = performance.now();
    while (performance.now() - start < ms) {
        let t0 = performance.now();
        try {
            await fetch(activeUrl + "?p=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: ctrl.signal });
            list.push(performance.now() - t0);
        } catch {}
        await new Promise(r => setTimeout(r, 150));
    }
    return list.length ? Math.round(Math.min(...list)) : "--";
}

async function runDownload(ms) {
    let bytes = 0; let smoothLoad = 0;
    const start = performance.now();
    const dlAbort = new AbortController();

    const pinger = setInterval(async () => {
        let t0 = performance.now();
        try {
            await fetch(activeUrl + "?lp=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: ctrl.signal });
            let raw = performance.now() - t0 + 10;
            smoothLoad = smoothLoad === 0 ? raw : (smoothLoad * 0.7 + raw * 0.3);
            document.getElementById('res-load').innerText = Math.round(smoothLoad);
        } catch {}
    }, 450);

    const workers = Array(40).fill(0).map(async () => {
        while (performance.now() - start < ms && !dlAbort.signal.aborted) {
            try {
                const res = await fetch("https://speed.cloudflare.com/__down?bytes=15000000", { signal: dlAbort.signal });
                const reader = res.body.getReader();
                while(true) {
                    const {done, value} = await reader.read();
                    if(done || dlAbort.signal.aborted) break;
                    bytes += value.length;
                    moveNeedle((bytes * 8) / (1024 * 1024) / ((performance.now() - start)/1000) * 1.1);
                }
            } catch { break; }
        }
    });

    await new Promise(r => setTimeout(r, ms));
    dlAbort.abort();
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
                        let speed = (bytesUp * 8) / (1024 * 1024) / ((performance.now() - start)/1000) * 1.3;
                        document.getElementById('res-ul').innerText = speed.toFixed(1);
                        res();
                    };
                    xhr.onerror = rej;
                    xhr.send(data);
                });
            } catch { await new Promise(r => setTimeout(r, 100)); }
        }
    };
    await Promise.all(Array(10).fill(0).map(() => worker()));
}
