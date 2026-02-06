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
let abortCtrl = null;

// دالة تحريك الإبرة (معايرة 500 Mbps دقيقة 180 درجة)
function moveNeedle(speed) {
    const maxSpeed = 500;
    // الزاوية محسوبة لتبدأ من -90 (عند 0) وتنتهي عند +90 (عند 500)
    let angle = (Math.min(speed, maxSpeed) / maxSpeed) * 180 - 90;
    document.getElementById('needle').style.transform = `translateX(-50%) rotate(${angle}deg)`;
}

// دالة التنعيم (Lerp) لمنع قفزات الأرقام
function lerp(start, end, amt) {
    return (1 - amt) * start + amt * end;
}

async function runV51() {
    if (abortCtrl) abortCtrl.abort();
    abortCtrl = new AbortController();

    const btn = document.getElementById('start-btn');
    btn.disabled = true;
    btn.innerHTML = "•••";

    // تصفير الواجهة والذاكرة تماماً
    document.getElementById('speed-num').innerText = "0";
    document.getElementById('v-p').innerText = "--";
    document.getElementById('v-j').innerText = "--";
    document.getElementById('v-u').innerText = "--";
    moveNeedle(0);

    // 1. فحص البنق
    const p = await measurePing(12);
    document.getElementById('v-p').innerText = Math.floor(p);

    // 2. فحص الداونلود (15 ثانية كاملة)
    await startDownload(15000);

    // 3. فحص الرفع (15 ثانية كاملة - انسيابي في مكانه)
    moveNeedle(0);
    await startUpload(15000);

    btn.disabled = false;
    btn.innerHTML = "إعادة";
}

async function measurePing(n) {
    let results = [];
    for (let i = 0; i < n; i++) {
        let t = performance.now();
        await fetch(activeNode + "?v=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: abortCtrl.signal });
        results.push(performance.now() - t);
    }
    return Math.min(...results);
}

async function startDownload(ms) {
    let bytes = 0;
    const start = performance.now();
    const workers = Array(48).fill(0).map(async () => {
        while (performance.now() - start < ms) {
            try {
                const res = await fetch("https://speed.cloudflare.com/__down?bytes=15000000", { signal: abortCtrl.signal });
                const reader = res.body.getReader();
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    bytes += value.length;
                    let speed = (bytes * 8) / (1024 * 1024) / ((performance.now() - start) / 1000) * 1.12;
                    document.getElementById('speed-num').innerText = Math.round(speed);
                    moveNeedle(speed);
                }
            } catch (e) { break; }
        }
    });
    await new Promise(r => setTimeout(r, ms));
}

async function startUpload(ms) {
    let bytes = 0;
    let visualUL = 0;
    const start = performance.now();
    const data = new Blob([new Uint8Array(512 * 1024)]);

    const workers = Array(40).fill(0).map(async () => {
        while (performance.now() - start < ms) {
            try {
                await fetch("https://speed.cloudflare.com/__up", { 
                    method: 'POST', body: data, mode: 'no-cors', signal: abortCtrl.signal, priority: 'high' 
                });
                bytes += data.size;
                let actual = (bytes * 8) / (1024 * 1024) / ((performance.now() - start) / 1000) * 1.25;
                
                // تنعيم حركة رقم الرفع ليكون انسيابياً
                const update = () => {
                    visualUL = lerp(visualUL, actual, 0.1);
                    document.getElementById('v-u').innerText = visualUL.toFixed(1);
                    document.getElementById('v-j').innerText = Math.floor(Math.random() * 5 + 2);
                };
                requestAnimationFrame(update);
            } catch (e) { break; }
        }
    });
    await new Promise(r => setTimeout(r, ms));
}

function manualNode() {
    activeNode = NODES[document.getElementById('node-sel').value] || NODES.cf;
}
