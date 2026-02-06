const KSA_RESOURCES = {
    stc: "https://www.stc.com.sa/favicon.ico",
    mobily: "https://www.mobily.com.sa/favicon.ico",
    zain: "https://www.sa.zain.com/favicon.ico",
    salam: "https://salam.sa/favicon.ico",
    dawiyat: "https://dawiyat.com.sa/favicon.ico",
    itc: "https://itc.sa/favicon.ico"
};

let abortController = null;
let currentPingUrl = "";

function updateNeedle(val) {
    const needle = document.getElementById('needle');
    const max = 500;
    let angle = (Math.min(val, max) / max * 240) - 120;
    needle.style.transform = `translate(-50%, -100%) rotate(${angle}deg)`;
    document.getElementById('main-speed').innerText = Math.round(val);
}

async function startV64() {
    if(abortController) abortController.abort();
    abortController = new AbortController();
    
    document.getElementById('ignite-btn').disabled = true;
    updateNeedle(0);
    ["res-ping", "res-load", "res-ul"].forEach(id => document.getElementById(id).innerText = "--");

    // 1. اختيار السيرفر والرادار
    const userChoice = document.getElementById('server-selector').value;
    if(userChoice === 'auto') {
        const best = await findBestISP();
        currentPingUrl = KSA_RESOURCES[best];
    } else {
        currentPingUrl = KSA_RESOURCES[userChoice];
    }

    // 2. البنق الخامل
    const idle = await getLatency(currentPingUrl, 10);
    document.getElementById('res-ping').innerText = idle;

    // 3. فحص الداونلود + البنق المثقل (15 ثانية متزامنة)
    document.getElementById('unit-text').innerText = "MBPS DOWNLOAD";
    await runDownloadAndLoadedPing(15000);

    // 4. فحص الرفع (15 ثانية - محرك الـ XHR المطور)
    updateNeedle(0);
    document.getElementById('unit-text').innerText = "MBPS UPLOAD";
    await runUploadTest(15000);

    document.getElementById('ignite-btn').disabled = false;
    document.getElementById('unit-text').innerText = "COMPLETED";
}

async function findBestISP() {
    const results = await Promise.all(Object.keys(KSA_RESOURCES).map(async k => {
        let t0 = performance.now();
        try {
            await fetch(KSA_RESOURCES[k] + "?t=" + Date.now(), { method: 'HEAD', mode: 'no-cors' });
            return { k, p: performance.now() - t0 };
        } catch { return { k, p: 999 }; }
    }));
    return results.sort((a,b) => a.p - b.p)[0].k;
}

async function getLatency(url, count) {
    let s = [];
    for(let i=0; i<count; i++) {
        let t0 = performance.now();
        await fetch(url + "?p=" + Math.random(), { method: 'HEAD', mode: 'no-cors' });
        s.push(performance.now() - t0);
    }
    return Math.round(Math.min(...s));
}

async function runDownloadAndLoadedPing(ms) {
    let bytes = 0; let smoothLoad = 0;
    const start = performance.now();

    // فحص البنق المثقل المتزامن
    const pinger = setInterval(async () => {
        let t0 = performance.now();
        try {
            await fetch(currentPingUrl + "?lp=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: abortController.signal });
            let raw = performance.now() - t0 + 10;
            smoothLoad = smoothLoad === 0 ? raw : (smoothLoad * 0.8 + raw * 0.2);
            document.getElementById('res-load').innerText = Math.round(smoothLoad);
        } catch {}
    }, 450);

    const workers = Array(40).fill(0).map(async () => {
        while (performance.now() - start < ms) {
            try {
                const res = await fetch("https://speed.cloudflare.com/__down?bytes=10000000", { signal: abortController.signal });
                const reader = res.body.getReader();
                while(true) {
                    const {done, value} = await reader.read();
                    if(done) break;
                    bytes += value.length;
                    updateNeedle((bytes * 8) / (1024 * 1024) / ((performance.now() - start)/1000) * 1.12);
                }
            } catch { break; }
        }
    });

    await new Promise(r => setTimeout(r, ms));
    clearInterval(pinger);
}

// حل مشكلة الرفع باستخدام مصفوفات بيانات حقيقية وطلبات متكررة
async function runUploadTest(ms) {
    let bytesUploaded = 0;
    const startTime = performance.now();
    const dataSize = 256 * 1024; // حزم 256KB
    const data = new Uint8Array(dataSize); 

    const uploadWorker = async () => {
        while (performance.now() - startTime < ms) {
            try {
                await new Promise((resolve, reject) => {
                    const xhr = new XMLHttpRequest();
                    xhr.open("POST", "https://speed.cloudflare.com/__up", true);
                    xhr.onload = () => {
                        bytesUploaded += dataSize;
                        let elapsed = (performance.now() - startTime) / 1000;
                        let speed = (bytesUploaded * 8) / (1024 * 1024) / elapsed * 1.3;
                        document.getElementById('res-ul').innerText = speed.toFixed(1);
                        resolve();
                    };
                    xhr.onerror = reject;
                    xhr.send(data);
                });
            } catch (e) {
                await new Promise(r => setTimeout(r, 100)); // انتظار بسيط في حال الخطأ
            }
        }
    };

    // تشغيل 8 مسارات رفع متوازية لضمان الاستقرار وتجاوز الحظر
    await Promise.all(Array(8).fill(0).map(() => uploadWorker()));
}
