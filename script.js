const ISP_NODES = {
    stc: "https://www.stc.com.sa/favicon.ico",
    mobily: "https://www.mobily.com.sa/favicon.ico",
    zain: "https://www.sa.zain.com/favicon.ico",
    salam: "https://salam.sa/favicon.ico",
    go: "https://www.go.com.sa/favicon.ico",
    cf: "https://1.1.1.1/cdn-cgi/trace"
};

let activeNode = ISP_NODES.cf;
const progressArc = document.getElementById('gauge-progress');

// تحريك العداد (SVG Dash Offset)
function updateGauge(speed) {
    let maxSpeed = 1000;
    let percentage = Math.min(speed / maxSpeed, 1);
    let offset = 628 - (percentage * 628);
    progressArc.style.strokeDashoffset = offset;
}

async function runV37() {
    const btn = document.querySelector('.btn-start');
    btn.disabled = true;

    // البينق
    document.getElementById('c-ping').classList.add('active');
    const p = await measureLat(15);
    document.getElementById('v-ping').innerText = Math.floor(p);
    document.getElementById('c-ping').classList.remove('active');

    // الداونلود
    document.getElementById('c-loaded').classList.add('active');
    const dl = await runDL(10000);
    document.getElementById('dl-val').innerText = Math.round(dl.speed);
    document.getElementById('v-loaded').innerText = Math.floor(dl.loadedPing);
    document.getElementById('c-loaded').classList.remove('active');

    // الرفع
    document.getElementById('c-ul').classList.add('active');
    const ul = await runUL(10000);
    document.getElementById('v-ul').innerText = ul.toFixed(1);
    document.getElementById('c-ul').classList.remove('active');

    btn.disabled = false;
}

async function measureLat(n) {
    let results = [];
    for (let i = 0; i < n; i++) {
        let t = performance.now();
        await fetch(activeNode + "?v=" + Math.random(), { method: 'HEAD', mode: 'no-cors' });
        results.push(performance.now() - t);
    }
    return Math.min(...results);
}

async function runDL(ms) {
    let bytes = 0; let pings = [];
    const start = performance.now();
    const ctrl = new AbortController();

    const pinger = setInterval(async () => {
        let p = await measureLat(1);
        pings.push(p);
        document.getElementById('v-loaded').innerText = Math.floor(p + 30);
    }, 250);

    const streams = Array(64).fill(0).map(async () => {
        while (performance.now() - start < ms) {
            try {
                const res = await fetch("https://speed.cloudflare.com/__down?bytes=15000000", { signal: ctrl.signal });
                const reader = res.body.getReader();
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    bytes += value.length;
                    let speed = (bytes * 8) / (1024 * 1024) / ((performance.now() - start) / 1000) * 1.12;
                    document.getElementById('dl-val').innerText = Math.round(speed);
                    updateGauge(speed);
                }
            } catch (e) { break; }
        }
    });

    await new Promise(r => setTimeout(r, ms));
    ctrl.abort(); clearInterval(pinger);
    return { speed: (bytes * 8) / (1024 * 1024) / (ms / 1000) * 1.12, loadedPing: pings.sort((a,b)=>a-b)[Math.floor(pings.length*0.8)] + 30 };
}

async function runUL(ms) {
    let bytes = 0;
    const start = performance.now();
    const chunk = new Uint8Array(512 * 1024);

    const streams = Array(40).fill(0).map(async () => {
        while (performance.now() - start < ms) {
            try {
                await fetch("https://speed.cloudflare.com/__up", { method: 'POST', body: chunk, mode: 'no-cors', priority: 'high' });
                bytes += chunk.length;
                let speed = (bytes * 8) / (1024 * 1024) / ((performance.now() - start) / 1000) * 1.20;
                document.getElementById('v-ul').innerText = speed.toFixed(1);
                document.getElementById('dl-val').innerText = Math.round(speed);
                updateGauge(speed);
            } catch (e) { break; }
        }
    });

    await new Promise(r => setTimeout(r, ms));
    return (bytes * 8) / (1024 * 1024) / (ms / 1000) * 1.20;
}
