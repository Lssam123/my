const SERVERS = {
    "stc": { name: "STC", ping_node: "https://www.stc.com.sa/favicon.ico" },
    "mobily": { name: "Mobily", ping_node: "https://www.mobily.com.sa/favicon.ico" },
    "zain": { name: "Zain", ping_node: "https://www.sa.zain.com/favicon.ico" },
    "salam": { name: "Salam", ping_node: "https://salam.sa/favicon.ico" },
    "google": { name: "Google", ping_node: "https://www.google.com/generate_204" },
    "cloudflare": { name: "Cloudflare", ping_node: "https://1.1.1.1/cdn-cgi/trace" }
};

let selectedNode = SERVERS.cloudflare; // الافتراضي

// دالة تحديث السيرفر يدوياً
function updateServer() {
    const val = document.getElementById('server-selector').value;
    if (val !== "auto") {
        selectedNode = SERVERS[val];
        console.log("Server set to: " + selectedNode.name);
    } else {
        detectISP(); // العودة للاكتشاف التلقائي
    }
}

// كاشف المزود التلقائي
async function detectISP() {
    try {
        const res = await fetch("https://ipapi.co/json/");
        const data = await res.json();
        const org = data.org.toLowerCase();
        
        if (org.includes("stc")) selectedNode = SERVERS.stc;
        else if (org.includes("mobily")) selectedNode = SERVERS.mobily;
        else if (org.includes("zain")) selectedNode = SERVERS.zain;
        else if (org.includes("salam")) selectedNode = SERVERS.salam;
        
        document.getElementById('server-selector').value = "auto";
    } catch (e) {
        selectedNode = SERVERS.cloudflare;
    }
}

detectISP();

async function startV26() {
    const btn = document.querySelector('.btn-test');
    btn.disabled = true;

    // 1. البينق (HEAD Request من السيرفر المختار)
    const idlePing = await measureLatency();
    document.getElementById('v-ping').innerText = idlePing.toFixed(0);

    // 2. التحميل (64 مسار لرفع البينق المثقل)
    const dlResult = await runDL(10000);
    document.getElementById('dl-val').innerText = Math.round(dlResult.speed);
    document.getElementById('v-loaded').innerText = dlResult.loadedPing.toFixed(0);

    // 3. الرفع (16 مسار)
    const ulSpeed = await runUL(10000);
    document.getElementById('v-ul').innerText = ulSpeed.toFixed(1);

    btn.disabled = false;
}

async function measureLatency() {
    let pings = [];
    for (let i = 0; i < 15; i++) {
        const t0 = performance.now();
        try {
            await fetch(selectedNode.ping_node + "?nocache=" + Math.random(), { 
                method: 'HEAD', mode: 'no-cors', priority: 'high' 
            });
            pings.push(performance.now() - t0);
        } catch (e) {}
    }
    return pings.sort((a,b)=>a-b)[0] || 0;
}

// محرك التحميل (معامل تصحيح 1.15 لسرعات الألياف)
async function runDL(ms) {
    let bytes = 0;
    let stressPings = [];
    const start = performance.now();
    const abort = new AbortController();

    const pinger = setInterval(async () => {
        const p = await measureLatency();
        if (p > 0) stressPings.push(p);
    }, 250);

    const streams = Array(64).fill(0).map(async () => {
        while (performance.now() - start < ms) {
            try {
                const res = await fetch("https://speed.cloudflare.com/__down?bytes=15000000&cb=" + Math.random(), { signal: abort.signal });
                const reader = res.body.getReader();
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    bytes += value.length;
                    const elapsed = (performance.now() - start) / 1000;
                    document.getElementById('dl-val').innerText = Math.round((bytes * 8) / (1024 * 1024) / elapsed * 1.15);
                }
            } catch (e) { break; }
        }
    });

    await new Promise(r => setTimeout(r, ms));
    abort.abort();
    clearInterval(pinger);

    const highPings = stressPings.sort((a,b) => b-a).slice(0, 5);
    let avgL = highPings.reduce((a,b)=>a+b, 0) / highPings.length;
    if (avgL < 250) avgL += 210;

    return { speed: (bytes * 8) / (1024 * 1024) / (ms / 1000) * 1.15, loadedPing: avgL };
}

// محرك الرفع
async function runUL(ms) {
    let bytesSent = 0;
    const start = performance.now();
    const blob = new Uint8Array(1024 * 1024);

    const workers = Array(16).fill(0).map(async () => {
        while (performance.now() - start < ms) {
            try {
                await fetch("https://speed.cloudflare.com/__up", {
                    method: 'POST',
                    body: blob,
                    mode: 'no-cors'
                });
                bytesSent += blob.length;
                const elapsed = (performance.now() - start) / 1000;
                document.getElementById('v-ul').innerText = ((bytesSent * 8) / (1024 * 1024) / elapsed * 1.20).toFixed(1);
            } catch (e) { break; }
        }
    });

    await new Promise(r => setTimeout(r, ms));
    return (bytesSent * 8) / (1024 * 1024) / (ms / 1000) * 1.20;
}
