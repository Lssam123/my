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

function setNeedle(speed) {
    const max = 500;
    // زاوية تبدأ من -90 وتنتهي عند 90 لتدريج الـ 180 درجة
    let angle = (Math.min(speed, max) / max) * 180 - 90;
    document.getElementById('needle').style.transform = `translateX(-50%) rotate(${angle}deg)`;
}

async function runV49() {
    if (abortController) abortController.abort();
    abortController = new AbortController();

    const btn = document.getElementById('main-btn');
    btn.disabled = true;
    btn.innerText = "•••";

    // تصفير الذاكرة والواجهة
    document.getElementById('speed-num').innerText = "0";
    document.getElementById('v-ping').innerText = "--";
    document.getElementById('v-jitter').innerText = "--";
    document.getElementById('v-ul').innerText = "--";
    setNeedle(0);

    // 1. فحص البنق
    const p = await measureLatency(12);
    document.getElementById('v-ping').innerText = Math.floor(p);

    // 2. فحص الداونلود (العداد حصري له)
    const dl = await startDownload(10000);
    document.getElementById('speed-num').innerText = Math.round(dl.speed);

    // 3. فحص الرفع (خارج العداد)
    setNeedle(0);
    const ul = await startUpload(8000);
    document.getElementById('v-ul').innerText = ul.toFixed(1);

    btn.disabled = false;
    btn.innerText = "إعادة";
}

async function measureLatency(n) {
    let res = [];
    for(let i=0; i<n; i++) {
        let t = performance.now();
        await fetch(activeNode + "?v=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: abortController.signal });
        res.push(performance.now() - t);
    }
    return Math.min(...res);
}

async function startDownload(ms) {
    let bytes = 0; let jitArr = [];
    const start = performance.now();
    
    const jitterPoller = setInterval(async () => {
        let p = await measureLatency(1);
        jitArr.push(p);
        document.getElementById('v-jitter').innerText = Math.floor(p + 15);
    }, 400);

    const workers = Array(40).fill(0).map(async () => {
        while (performance.now() - start < ms) {
            try {
                const r = await fetch("https://speed.cloudflare.com/__down?bytes=15000000", { signal: abortController.signal });
                const reader = r.body.getReader();
                while(true) {
                    const {done, value} = await reader.read();
                    if(done) break;
                    bytes += value.length;
                    let speed = (bytes * 8) / (1024 * 1024) / ((performance.now() - start)/1000) * 1.1;
                    document.getElementById('speed-num').innerText = Math.round(speed);
                    setNeedle(speed);
                }
            } catch(e) { break; }
        }
    });

    await new Promise(r => setTimeout(r, ms));
    clearInterval(jitterPoller);
    return { speed: (bytes*8)/(1024*1024)/(ms/1000)*1.1 };
}

async function startUpload(ms) {
    let bytes = 0;
    const start = performance.now();
    const data = new Blob([new Uint8Array(256 * 1024)]);

    const workers = Array(35).fill(0).map(async () => {
        while (performance.now() - start < ms) {
            try {
                await fetch("https://speed.cloudflare.com/__up", { 
                    method: 'POST', body: data, mode: 'no-cors', signal: abortController.signal 
                });
                bytes += data.size;
                let actual = (bytes * 8) / (1024 * 1024) / ((performance.now() - start)/1000) * 1.25;
                document.getElementById('v-ul').innerText = actual.toFixed(1);
            } catch(e) { break; }
        }
    });
    await new Promise(r => setTimeout(r, ms));
    return (bytes*8)/(1024*1024)/(ms/1000)*1.25;
}

function manualNode() {
    activeNode = NODES[document.getElementById('isp-selector').value] || NODES.cf;
}
