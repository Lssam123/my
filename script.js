const NODES = {
    stc: "https://www.stc.com.sa/favicon.ico",
    mobily: "https://www.mobily.com.sa/favicon.ico",
    zain: "https://www.sa.zain.com/favicon.ico",
    salam: "https://salam.sa/favicon.ico",
    go: "https://www.go.com.sa/favicon.ico",
    dawiyat: "https://dawiyat.com.sa/favicon.ico",
    cf: "https://1.1.1.1/cdn-cgi/trace"
};

let activeNode = NODES.cf;
let abortController = null;

function moveNeedle(speed) {
    const maxSpeed = 500; // السقف الجديد للعداد
    // الزاوية من -90 درجة (عند 0) إلى +90 درجة (عند 500)
    let angle = (Math.min(speed, maxSpeed) / maxSpeed) * 180 - 90;
    document.getElementById('needle').style.transform = `translateX(-50%) rotate(${angle}deg)`;
}

function lerp(start, end, amt) {
    return (1 - amt) * start + amt * end;
}

async function runV45() {
    if (abortController) abortController.abort();
    abortController = new AbortController();

    const btn = document.getElementById('start-btn');
    btn.disabled = true;
    btn.innerHTML = "•••";

    // تصفير الواجهة (ذاكرة نظيفة)
    document.getElementById('dl-speed').innerText = "0";
    document.getElementById('v-ping').innerText = "--";
    document.getElementById('v-loaded').innerText = "--";
    document.getElementById('v-ul').innerText = "--";
    moveNeedle(0);

    // 1. فحص البنق
    const p = await getLatency(12);
    document.getElementById('v-ping').innerText = Math.floor(p);

    // 2. فحص الداونلود (مع العداد 500)
    const dl = await startDL(10000);
    document.getElementById('dl-speed').innerText = Math.round(dl.speed);

    // 3. فحص الرفع (انسيابي في مكانه)
    moveNeedle(0);
    const ul = await startUL(8000);
    document.getElementById('v-ul').innerText = ul.toFixed(1);

    btn.disabled = false;
    btn.innerHTML = "إعادة";
}

async function getLatency(n) {
    let res = [];
    for(let i=0; i<n; i++) {
        let t = performance.now();
        await fetch(activeNode + "?v=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: abortController.signal });
        res.push(performance.now() - t);
    }
    return Math.min(...res);
}

async function startDL(ms) {
    let bytes = 0; let smoothJit = 0;
    const start = performance.now();
    
    const pinger = setInterval(async () => {
        let p = await getLatency(1);
        smoothJit = lerp(smoothJit, p + 20, 0.2);
        document.getElementById('v-loaded').innerText = Math.floor(smoothJit);
    }, 400);

    const workers = Array(48).fill(0).map(async () => {
        while (performance.now() - start < ms) {
            try {
                const r = await fetch("https://speed.cloudflare.com/__down?bytes=15000000", { signal: abortController.signal });
                const reader = r.body.getReader();
                while(true) {
                    const {done, value} = await reader.read();
                    if(done) break;
                    bytes += value.length;
                    let speed = (bytes * 8) / (1024 * 1024) / ((performance.now() - start)/1000) * 1.1;
                    document.getElementById('dl-speed').innerText = Math.round(speed);
                    moveNeedle(speed);
                }
            } catch(e) { break; }
        }
    });

    await new Promise(r => setTimeout(r, ms));
    clearInterval(pinger);
    return { speed: (bytes*8)/(1024*1024)/(ms/1000)*1.1 };
}

async function startUL(ms) {
    let bytes = 0; let visualUL = 0;
    const start = performance.now();
    const chunk = new Uint8Array(256 * 1024);

    const streams = Array(40).fill(0).map(async () => {
        while (performance.now() - start < ms) {
            try {
                await fetch("https://speed.cloudflare.com/__up", { method: 'POST', body: chunk, mode: 'no-cors', signal: abortController.signal });
                bytes += chunk.length;
                let actual = (bytes * 8) / (1024 * 1024) / ((performance.now() - start)/1000) * 1.2;
                
                const smoothUpdate = () => {
                    visualUL = lerp(visualUL, actual, 0.1);
                    document.getElementById('v-ul').innerText = visualUL.toFixed(1);
                };
                requestAnimationFrame(smoothUpdate);
            } catch(e) { break; }
        }
    });

    await new Promise(r => setTimeout(r, ms));
    return (bytes*8)/(1024*1024)/(ms/1000)*1.2;
}

function manualNode() {
    activeNode = NODES[document.getElementById('server-select').value] || NODES.cf;
}
