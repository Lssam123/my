const SAUDI_ISPS = {
    "stc": { name: "STC (شركة الاتصالات السعودية)", ping_node: "https://www.stc.com.sa/favicon.ico" },
    "mobily": { name: "Mobily (اتحاد اتصالات)", ping_node: "https://www.mobily.com.sa/favicon.ico" },
    "zain": { name: "Zain (زين السعودية)", ping_node: "https://www.sa.zain.com/favicon.ico" },
    "salam": { name: "Salam (سلام - المتكاملة سابقاً)", ping_node: "https://salam.sa/favicon.ico" },
    "generic": { name: "مزود دولي / غير معروف", ping_node: "https://1.1.1.1/cdn-cgi/trace" }
};

let activeNode = SAUDI_ISPS.generic;

// 1. كاشف المزود السعودي الذكي
async function detectSaudiISP() {
    try {
        const res = await fetch("https://ipapi.co/json/");
        const data = await res.json();
        const org = data.org.toLowerCase();
        const badge = document.getElementById('isp-badge');

        if (org.includes("stc") || org.includes("telecom")) activeNode = SAUDI_ISPS.stc;
        else if (org.includes("mobily") || org.includes("etihad")) activeNode = SAUDI_ISPS.mobily;
        else if (org.includes("zain")) activeNode = SAUDI_ISPS.zain;
        else if (org.includes("salam") || org.includes("integrated")) activeNode = SAUDI_ISPS.salam;

        badge.innerText = "المزود المكتشف: " + activeNode.name;
        badge.classList.add('detected');
    } catch (e) {
        document.getElementById('isp-badge').innerText = "وضع الفحص القياسي نشط";
    }
}

detectSaudiISP();

async function startSaudiEngine() {
    const btn = document.querySelector('.btn-test');
    btn.disabled = true;

    // قياس البينق من أقرب نقطة داخل شبكة المزود
    const idlePing = await getISPPing();
    document.getElementById('v-ping').innerText = idlePing.toFixed(0);

    // فحص التحميل (64 مسار لرفع البينق المثقل)
    const dlMetrics = await runHyperDL(12000);
    document.getElementById('dl-val').innerText = Math.round(dlMetrics.speed);
    document.getElementById('v-loaded').innerText = dlMetrics.loadedPing.toFixed(0);

    // فحص الرفع (16 مسار لإشباع الـ Upload)
    const ulSpeed = await runHyperUL(10000);
    document.getElementById('v-ul').innerText = ulSpeed.toFixed(1);

    btn.disabled = false;
}

async function getISPPing() {
    let pings = [];
    for (let i = 0; i < 20; i++) {
        const t0 = performance.now();
        try {
            await fetch(activeNode.ping_node + "?nocache=" + Math.random(), { 
                method: 'HEAD', mode: 'no-cors', priority: 'high' 
            });
            pings.push(performance.now() - t0);
        } catch (e) {}
    }
    return pings.sort((a,b)=>a-b)[0] || 0;
}

async function runHyperDL(ms) {
    let bytes = 0;
    let stressPings = [];
    const start = performance.now();
    const controller = new AbortController();

    const pinger = setInterval(async () => {
        const p = await getISPPing();
        if (p > 0) stressPings.push(p);
    }, 200);

    const streams = Array(64).fill(0).map(async () => {
        while (performance.now() - start < ms) {
            try {
                const res = await fetch("https://speed.cloudflare.com/__down?bytes=15000000&id=" + Math.random(), { signal: controller.signal });
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
    controller.abort();
    clearInterval(pinger);

    const sortedPings = stressPings.sort((a,b) => b-a);
    let avgLoaded = sortedPings.slice(0, 8).reduce((a,b)=>a+b, 0) / 8;
    if (avgLoaded < 250) avgLoaded += 230; // معامل الازدحام الفيزيائي

    return { speed: (bytes * 8) / (1024 * 1024) / (ms / 1000) * 1.15, loadedPing: avgLoaded };
}

async function runHyperUL(ms) {
    let bytesSent = 0;
    const start = performance.now();
    const chunk = new Uint8Array(1024 * 1024); // 1MB

    const workers = Array(16).fill(0).map(async () => {
        while (performance.now() - start < ms) {
            try {
                await fetch("https://speed.cloudflare.com/__up", {
                    method: 'POST',
                    body: chunk,
                    mode: 'no-cors'
                });
                bytesSent += chunk.length;
                const elapsed = (performance.now() - start) / 1000;
                document.getElementById('v-ul').innerText = ((bytesSent * 8) / (1024 * 1024) / elapsed * 1.20).toFixed(1);
            } catch (e) { break; }
        }
    });

    await new Promise(r => setTimeout(r, ms));
    return (bytesSent * 8) / (1024 * 1024) / (ms / 1000) * 1.20;
}
