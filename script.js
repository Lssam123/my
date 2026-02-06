const ISP_NODES = {
    stc: "https://www.stc.com.sa/favicon.ico",
    mobily: "https://www.mobily.com.sa/favicon.ico",
    zain: "https://www.sa.zain.com/favicon.ico",
    salam: "https://salam.sa/favicon.ico",
    go: "https://www.go.com.sa/favicon.ico",
    cf: "https://1.1.1.1/cdn-cgi/trace"
};

let activeNode = ISP_NODES.cf;
const needle = document.getElementById('needle');

// تحريك الإبرة بفيزيائية دائرية
function moveNeedle(speed) {
    let max = 1000;
    // الزاوية محسوبة لتغطية القوس من 0 إلى 1000+
    let angle = (Math.min(speed, max) / max) * 240 - 120;
    needle.style.transform = `rotate(${angle}deg)`;
}

async function runV40() {
    const btn = document.getElementById('start-btn');
    btn.disabled = true;
    btn.innerHTML = "•••";

    // 1. فحص البنق (الأقرب)
    const p = await getFastPing(12);
    document.getElementById('v-ping').innerText = Math.floor(p);

    // 2. التحميل (نظام الـ Multi-Thread)
    const dl = await startDL(10000);
    document.getElementById('main-speed').innerText = Math.round(dl.speed);
    document.getElementById('v-loaded').innerText = Math.floor(dl.loadedPing);

    // 3. الرفع (Instant-Response)
    const ul = await startUL(8000);
    document.getElementById('v-ul').innerText = ul.toFixed(1);
    document.getElementById('main-speed').innerText = Math.round(ul);
    moveNeedle(ul);

    btn.disabled = false;
    btn.innerHTML = "بدء";
}

async function getFastPing(n) {
    let res = [];
    for(let i=0; i<n; i++) {
        let t = performance.now();
        await fetch(activeNode + "?v=" + Math.random(), { method: 'HEAD', mode: 'no-cors' });
        res.push(performance.now() - t);
    }
    return Math.min(...res);
}

async function startDL(ms) {
    let bytes = 0; let pings = [];
    const start = performance.now();
    const ctrl = new AbortController();

    const pinger = setInterval(async () => {
        pings.push(await getFastPing(1));
    }, 300);

    const workers = Array(64).fill(0).map(async () => {
        while (performance.now() - start < ms) {
            try {
                const r = await fetch("https://speed.cloudflare.com/__down?bytes=15000000", { signal: ctrl.signal });
                const reader = r.body.getReader();
                while(true) {
                    const {done, value} = await reader.read();
                    if(done) break;
                    bytes += value.length;
                    let speed = (bytes * 8) / (1024 * 1024) / ((performance.now() - start)/1000) * 1.12;
                    document.getElementById('main-speed').innerText = Math.round(speed);
                    moveNeedle(speed);
                }
            } catch(e) { break; }
        }
    });

    await new Promise(r => setTimeout(r, ms));
    ctrl.abort(); clearInterval(pinger);
    return { speed: (bytes*8)/(1024*1024)/(ms/1000)*1.12, loadedPing: Math.min(...pings) + 20 };
}

async function startUL(ms) {
    let bytes = 0;
    const start = performance.now();
    const chunk = new Uint8Array(256 * 1024);

    const streams = Array(50).fill(0).map(async () => {
        while (performance.now() - start < ms) {
            try {
                await fetch("https://speed.cloudflare.com/__up", { method: 'POST', body: chunk, mode: 'no-cors', priority: 'high' });
                bytes += chunk.length;
                let speed = (bytes * 8) / (1024 * 1024) / ((performance.now() - start)/1000) * 1.25;
                document.getElementById('v-ul').innerText = speed.toFixed(1);
                document.getElementById('main-speed').innerText = Math.round(speed);
                moveNeedle(speed);
            } catch(e) { break; }
        }
    });

    await new Promise(r => setTimeout(r, ms));
    return (bytes*8)/(1024*1024)/(ms/1000)*1.25;
}

function manualNode() {
    const val = document.getElementById('server-select').value;
    activeNode = (val === 'auto') ? ISP_NODES.cf : ISP_NODES[val];
}
