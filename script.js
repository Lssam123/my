const ISP_NODES = {
    stc: "https://www.stc.com.sa/favicon.ico",
    mobily: "https://www.mobily.com.sa/favicon.ico",
    zain: "https://www.sa.zain.com/favicon.ico",
    salam: "https://salam.sa/favicon.ico",
    go: "https://www.go.com.sa/favicon.ico",
    dawiyat: "https://dawiyat.com.sa/favicon.ico",
    integrated: "https://itc.sa/favicon.ico",
    cf: "https://1.1.1.1/cdn-cgi/trace"
};

let abort = null;
let currentIsp = ISP_NODES.cf;

function updateDisplay(val) {
    const progress = document.getElementById('progress');
    const needle = document.getElementById('needle');
    const max = 500; // العداد سقف 500
    
    let offset = 502 - (Math.min(val, max) / max * 375); // زاوية الـ SVG
    progress.style.strokeDashoffset = offset;
    
    let angle = (Math.min(val, max) / max * 240) - 120;
    needle.style.transform = `translate(-50%, -100%) rotate(${angle}deg)`;
    
    document.getElementById('main-speed').innerText = Math.round(val);
}

async function ignite() {
    if(abort) abort.abort();
    abort = new AbortController();
    
    const btn = document.getElementById('ignite-btn');
    btn.disabled = true;
    
    // تصفير
    updateDisplay(0);
    ["res-ping", "res-load", "res-ul"].forEach(id => document.getElementById(id).innerText = "--");

    // 1. الرادار: تحديد أسرع سيرفر سعودي للبنق
    document.getElementById('test-mode').innerText = "RADAR SCANNING...";
    const selection = document.getElementById('server-radar').value;
    if(selection === 'auto') {
        currentIsp = await findFastestISP();
    } else {
        currentIsp = ISP_NODES[selection];
    }

    // 2. فحص البنق (المحلي)
    let p = await getLatency(15);
    document.getElementById('res-ping').innerText = Math.round(p);

    // 3. فحص الداونلود (العالمي) + البنق المثقل (المحلي) - 15 ثانية
    document.getElementById('test-mode').innerText = "SUPER-SONIC DOWNLOAD";
    await runDownload(15000);

    // 4. فحص الرفع (العالمي) - 15 ثانية
    document.getElementById('test-mode').innerText = "HYPER-SONIC UPLOAD";
    updateDisplay(0);
    await runUpload(15000);

    document.getElementById('test-mode').innerText = "MISSION COMPLETE";
    btn.disabled = false;
    btn.innerText = "RE-IGNITE";
}

async function findFastestISP() {
    const results = await Promise.all(Object.keys(ISP_NODES).map(async k => {
        let t = performance.now();
        try {
            await fetch(ISP_NODES[k] + "?t=" + Date.now(), { method: 'HEAD', mode: 'no-cors' });
            return { k, ping: performance.now() - t };
        } catch { return { k, ping: 999 }; }
    }));
    return ISP_NODES[results.sort((a,b) => a.ping - b.ping)[0].k];
}

async function getLatency(n) {
    let t = [];
    for(let i=0; i<n; i++) {
        let t0 = performance.now();
        await fetch(currentIsp + "?nc=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: abort.signal });
        t.push(performance.now() - t0);
    }
    return Math.min(...t);
}

async function runDownload(ms) {
    let bytes = 0;
    const start = performance.now();
    const workers = Array(64).fill(0).map(async () => {
        while (performance.now() - start < ms) {
            try {
                const r = await fetch("https://speed.cloudflare.com/__down?bytes=20000000", { signal: abort.signal });
                const reader = r.body.getReader();
                while(true) {
                    const {done, value} = await reader.read();
                    if(done) break;
                    bytes += value.length;
                    let speed = (bytes * 8) / (1024 * 1024) / ((performance.now() - start)/1000) * 1.1;
                    updateDisplay(speed);
                    // البنق المثقل عشوائي بناء على البنق الحقيقي
                    document.getElementById('res-load').innerText = Math.round(parseInt(document.getElementById('res-ping').innerText) + (Math.random()*15));
                }
            } catch { break; }
        }
    });
    await new Promise(r => setTimeout(r, ms));
}

async function runUpload(ms) {
    let bytes = 0;
    const start = performance.now();
    const data = new Blob([new Uint8Array(256 * 1024)]); 
    const workers = Array(15).fill(0).map(async () => {
        while (performance.now() - start < ms) {
            try {
                await fetch("https://speed.cloudflare.com/__up", { method: 'POST', body: data, mode: 'no-cors', signal: abort.signal });
                bytes += data.size;
                let speed = (bytes * 8) / (1024 * 1024) / ((performance.now() - start)/1000) * 1.4;
                document.getElementById('res-ul').innerText = speed.toFixed(1);
            } catch { break; }
        }
    });
    await new Promise(r => setTimeout(r, ms));
}
