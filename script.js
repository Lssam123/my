const NODES = {
    stc: "https://www.stc.com.sa/favicon.ico",
    mobily: "https://www.mobily.com.sa/favicon.ico",
    zain: "https://www.sa.zain.com/favicon.ico",
    salam: "https://salam.sa/favicon.ico",
    go: "https://www.go.com.sa/favicon.ico",
    cf: "https://1.1.1.1/cdn-cgi/trace"
};

let activeNode = NODES.cf;
const ring = document.getElementById('ring');

// 1. الرادار التلقائي للسيرفرات
async function autoRadar() {
    let fast = { id: 'cf', lat: 999 };
    for (let k in NODES) {
        let t = performance.now();
        try {
            await fetch(NODES[k], { method: 'HEAD', mode: 'no-cors' });
            let lat = performance.now() - t;
            if(lat < fast.lat) fast = {id: k, lat: lat};
        } catch(e){}
    }
    activeNode = NODES[fast.id];
    document.getElementById('server-select').value = fast.id === 'cf' ? 'auto' : fast.id;
}
autoRadar();

function manualNode() {
    const val = document.getElementById('server-select').value;
    activeNode = val === "auto" ? NODES.cf : NODES[val];
}

// 2. المحرك الرئيسي
async function startEliteTest() {
    const btn = document.querySelector('.btn-launch');
    btn.disabled = true;

    // تصفير الواجهة
    updateGauge(0);
    
    // البينق
    document.getElementById('c-ping').classList.add('active');
    const p = await getLatency(15);
    document.getElementById('v-ping').innerText = Math.floor(p);
    document.getElementById('c-ping').classList.remove('active');

    // الداونلود
    document.getElementById('c-loaded').classList.add('active');
    const dl = await runDownload(12000);
    document.getElementById('dl-val').innerText = Math.round(dl.speed);
    document.getElementById('v-loaded').innerText = Math.floor(dl.loadedPing);
    document.getElementById('c-loaded').classList.remove('active');

    // الرفع
    document.getElementById('c-ul').classList.add('active');
    const ul = await runUpload(10000);
    document.getElementById('v-ul').innerText = ul.toFixed(1);
    document.getElementById('c-ul').classList.remove('active');

    btn.disabled = false;
}

// تحديث الحلقة بصرياً
function updateGauge(speed) {
    let rotation = (speed / 1000) * 360; // بافتراض سقف 1000Mbps
    ring.style.transform = `rotate(${rotation - 45}deg)`;
    ring.style.filter = `drop-shadow(0 0 ${10 + (speed/50)}px #00f2fe)`;
}

async function getLatency(samples) {
    let res = [];
    for(let i=0; i<samples; i++){
        let t = performance.now();
        await fetch(activeNode + "?v=" + Math.random(), { method: 'HEAD', mode: 'no-cors' });
        res.push(performance.now() - t);
    }
    return Math.min(...res);
}

async function runDownload(ms) {
    let bytes = 0; let lPings = [];
    const start = performance.now();
    const ctrl = new AbortController();

    const pinger = setInterval(async () => {
        let p = await getLatency(1);
        lPings.push(p);
        document.getElementById('v-loaded').innerText = Math.floor(p + 30);
    }, 300);

    const streams = Array(64).fill(0).map(async () => {
        while (performance.now() - start < ms) {
            try {
                const r = await fetch("https://speed.cloudflare.com/__down?bytes=20000000", { signal: ctrl.signal });
                const reader = r.body.getReader();
                while(true) {
                    const {done, value} = await reader.read();
                    if(done) break;
                    bytes += value.length;
                    let speed = (bytes * 8) / (1024 * 1024) / ((performance.now() - start)/1000) * 1.12;
                    document.getElementById('dl-val').innerText = Math.round(speed);
                    updateGauge(speed);
                }
            } catch(e){ break; }
        }
    });

    await new Promise(r => setTimeout(r, ms));
    ctrl.abort(); clearInterval(pinger);
    const sorted = lPings.sort((a,b)=>a-b);
    return { speed: (bytes*8)/(1024*1024)/(ms/1000)*1.12, loadedPing: sorted[Math.floor(sorted.length*0.8)] + 30 };
}

async function runUpload(ms) {
    let bytes = 0;
    const start = performance.now();
    const microChunk = new Uint8Array(256 * 1024); // حزم صغيرة جداً لمنع الحظر

    const streams = Array(50).fill(0).map(async () => {
        while (performance.now() - start < ms) {
            try {
                await fetch("https://speed.cloudflare.com/__up", {
                    method: 'POST',
                    body: microChunk,
                    mode: 'no-cors',
                    priority: 'high'
                });
                bytes += microChunk.length;
                let speed = (bytes * 8) / (1024 * 1024) / ((performance.now() - start)/1000) * 1.20;
                document.getElementById('v-ul').innerText = speed.toFixed(1);
                document.getElementById('dl-val').innerText = Math.round(speed); // عرض سرعة الرفع في العداد الرئيسي
                updateGauge(speed);
            } catch(e){ break; }
        }
    });

    await new Promise(r => setTimeout(r, ms));
    return (bytes*8)/(1024*1024)/(ms/1000)*1.20;
}
