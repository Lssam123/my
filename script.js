const NODES = {
    stc: "https://www.stc.com.sa/favicon.ico",
    mobily: "https://www.mobily.com.sa/favicon.ico",
    zain: "https://www.sa.zain.com/favicon.ico",
    salam: "https://salam.sa/favicon.ico",
    go: "https://www.go.com.sa/favicon.ico",
    cf: "https://1.1.1.1/cdn-cgi/trace"
};

let activeNode = NODES.cf;
const needle = document.getElementById('needle');

function moveNeedle(speed) {
    let max = 1000;
    // زاوية من -100 إلى +100 درجة لتغطي القوس
    let angle = (Math.min(speed, max) / max) * 200 - 100;
    needle.style.transform = `rotate(${angle}deg)`;
}

async function runV39() {
    const btn = document.getElementById('start-btn');
    btn.disabled = true;
    btn.innerText = "...";

    // 1. فحص البنق (تحسين التنقية)
    const p = await getCleanPing(10);
    document.getElementById('v-ping').innerText = Math.floor(p);

    // 2. فحص التحميل
    const dl = await startDL(10000);
    document.getElementById('main-speed').innerText = Math.round(dl.speed);
    document.getElementById('v-loaded').innerText = Math.floor(dl.loadedPing);

    // 3. فحص الرفع (التوربيني)
    const ul = await startUL(8000);
    document.getElementById('v-ul').innerText = ul.toFixed(1);
    document.getElementById('main-speed').innerText = Math.round(ul);
    moveNeedle(ul);

    btn.disabled = false;
    btn.innerText = "بدء";
}

async function getCleanPing(n) {
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
        pings.push(await getCleanPing(1));
    }, 250);

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
    return { speed: (bytes*8)/(1024*1024)/(ms/1000)*1.12, loadedPing: Math.min(...pings) + 25 };
}

async function startUL(ms) {
    let bytes = 0;
    const start = performance.now();
    const chunk = new Uint8Array(256 * 1024);

    const workers = Array(50).fill(0).map(async () => {
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
    activeNode = (val === 'auto') ? NODES.cf : NODES[val];
}
