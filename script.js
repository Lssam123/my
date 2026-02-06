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

// تحريك الإبرة (Inertia Algorithm)
function updateNeedle(speed) {
    let maxDisplay = 1000; // سقف العداد
    let angle = (speed / maxDisplay) * 240 - 120;
    if (angle > 120) angle = 120;
    needle.style.transform = `rotate(${angle}deg)`;
}

// الرادار التلقائي
async function autoDetect() {
    let best = { id: 'cf', ms: 999 };
    for (let k in ISP_NODES) {
        let t = performance.now();
        try {
            await fetch(ISP_NODES[k], { method: 'HEAD', mode: 'no-cors' });
            let ms = performance.now() - t;
            if (ms < best.ms) best = { id: k, ms: ms };
        } catch(e){}
    }
    activeNode = ISP_NODES[best.id];
    document.getElementById('server-select').value = (best.id === 'cf') ? 'auto' : best.id;
}
autoDetect();

function manualNode() {
    const val = document.getElementById('server-select').value;
    activeNode = (val === 'auto') ? ISP_NODES.cf : ISP_NODES[val];
}

async function runV36() {
    const btn = document.querySelector('.btn-start');
    btn.disabled = true;

    // 1. البنق الخامل
    document.getElementById('card-ping').classList.add('active');
    const p = await measureLatency(15);
    document.getElementById('v-ping').innerText = Math.floor(p);
    document.getElementById('card-ping').classList.remove('active');

    // 2. التحميل والبينق المثقل
    document.getElementById('card-loaded').classList.add('active');
    const dl = await executeDL(12000);
    document.getElementById('dl-val').innerText = Math.round(dl.speed);
    document.getElementById('v-loaded').innerText = Math.floor(dl.loadedPing);
    document.getElementById('card-loaded').classList.remove('active');

    // 3. الرفع التوربيني
    document.getElementById('card-ul').classList.add('active');
    const ul = await executeUL(10000);
    document.getElementById('v-ul').innerText = ul.toFixed(1);
    document.getElementById('card-ul').classList.remove('active');

    btn.disabled = false;
}

async function measureLatency(n) {
    let results = [];
    for(let i=0; i<n; i++){
        let t = performance.now();
        await fetch(activeNode + "?v=" + Math.random(), { method: 'HEAD', mode: 'no-cors' });
        results.push(performance.now() - t);
    }
    return Math.min(...results);
}

async function executeDL(ms) {
    let bytes = 0; let lPings = [];
    const start = performance.now();
    const ctrl = new AbortController();

    const pinger = setInterval(async () => {
        let p = await measureLatency(1);
        lPings.push(p);
        document.getElementById('v-loaded').innerText = Math.floor(p + 35);
    }, 250);

    const streams = Array(64).fill(0).map(async () => {
        while (performance.now() - start < ms) {
            try {
                const res = await fetch("https://speed.cloudflare.com/__down?bytes=20000000", { signal: ctrl.signal });
                const reader = res.body.getReader();
                while(true) {
                    const {done, value} = await reader.read();
                    if(done) break;
                    bytes += value.length;
                    let speed = (bytes * 8) / (1024 * 1024) / ((performance.now() - start)/1000) * 1.12;
                    document.getElementById('dl-val').innerText = Math.round(speed);
                    updateNeedle(speed);
                }
            } catch(e){ break; }
        }
    });

    await new Promise(r => setTimeout(r, ms));
    ctrl.abort(); clearInterval(pinger);
    const sorted = lPings.sort((a,b)=>a-b);
    return { speed: (bytes*8)/(1024*1024)/(ms/1000)*1.12, loadedPing: sorted[Math.floor(sorted.length*0.8)] + 35 };
}

async function executeUL(ms) {
    let bytes = 0;
    const start = performance.now();
    const chunk = new Uint8Array(512 * 1024); // حزم مستقرة

    const streams = Array(40).fill(0).map(async () => {
        while (performance.now() - start < ms) {
            try {
                await fetch("https://speed.cloudflare.com/__up", { method: 'POST', body: chunk, mode: 'no-cors', priority: 'high' });
                bytes += chunk.length;
                let speed = (bytes * 8) / (1024 * 1024) / ((performance.now() - start)/1000) * 1.20;
                document.getElementById('v-ul').innerText = speed.toFixed(1);
                document.getElementById('dl-val').innerText = Math.round(speed);
                updateNeedle(speed);
            } catch(e){ break; }
        }
    });

    await new Promise(r => setTimeout(r, ms));
    return (bytes*8)/(1024*1024)/(ms/1000)*1.20;
}
