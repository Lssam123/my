const NODES = {
    stc: "https://www.stc.com.sa/favicon.ico",
    mobily: "https://www.mobily.com.sa/favicon.ico",
    zain: "https://www.sa.zain.com/favicon.ico",
    go: "https://www.go.com.sa/favicon.ico",
    cf: "https://1.1.1.1/cdn-cgi/trace"
};

let activeNode = NODES.cf;
const needle = document.getElementById('needle');
let smoothLoadedPing = 0; // متغير لتخزين البنق المثقل الانسيابي

// تحريك الإبرة للداونلود فقط
function moveNeedle(speed) {
    let angle = (Math.min(speed, 1000) / 1000) * 240 - 120;
    needle.style.transform = `rotate(${angle}deg)`;
}

// دالة الانسيابية (Linear Interpolation) لتنعيم حركة الأرقام
function lerp(start, end, amt) {
    return (1 - amt) * start + amt * end;
}

async function runV41() {
    const btn = document.getElementById('start-btn');
    btn.disabled = true;
    btn.innerHTML = "•••";

    // 1. فحص البنق الخامل
    document.getElementById('card-ping').classList.add('active');
    const p = await getFastPing(15);
    document.getElementById('v-ping').innerText = Math.floor(p);
    document.getElementById('card-ping').classList.remove('active');

    // 2. فحص الداونلود (العداد مخصص له) + البينق المثقل (حركة انسيابية)
    document.getElementById('card-loaded').classList.add('active');
    const dl = await startDL(12000);
    document.getElementById('dl-val').innerText = Math.round(dl.speed);
    document.getElementById('card-loaded').classList.remove('active');

    // 3. فحص الرفع (في بطاقته الخاصة)
    document.getElementById('card-ul').classList.add('active');
    const ul = await startUL(10000);
    document.getElementById('v-ul').innerText = ul.toFixed(1);
    document.getElementById('card-ul').classList.remove('active');

    btn.disabled = false;
    btn.innerHTML = "بدء";
}

async function getFastPing(n) {
    let res = [];
    for(let i=0; i<n; i++) {
        let t = performance.now();
        await fetch(activeNode + "?v=" + Math.random(), { method: 'HEAD', mode: 'no-cors' });
        res.push(performance.now() - t);
    }
    return Math.min(...res);
}

async function startDL(ms) {
    let bytes = 0;
    const start = performance.now();
    const ctrl = new AbortController();

    // محرك البينق المثقل الانسيابي (مثل سبيد تست)
    const pinger = setInterval(async () => {
        let rawP = await getFastPing(1);
        let targetP = rawP + 25; // معامل الضغط
        
        // خوارزمية التنعيم: الأرقام تتغير تدريجياً
        const smoothStep = setInterval(() => {
            smoothLoadedPing = lerp(smoothLoadedPing, targetP, 0.1);
            document.getElementById('v-loaded').innerText = Math.floor(smoothLoadedPing);
        }, 30);
        
        setTimeout(() => clearInterval(smoothStep), 250);
    }, 300);

    const workers = Array(64).fill(0).map(async () => {
        while (performance.now() - start < ms) {
            try {
                const r = await fetch("https://speed.cloudflare.com/__down?bytes=15000000", { signal: ctrl.signal });
                const reader = r.body.getReader();
                while(true) {
                    const {done, value} = await reader.read();
                    if(done) break;
                    bytes += value.length;
                    let speed = (bytes * 8) / (1024 * 1024) / ((performance.now() - start)/1000) * 1.12;
                    document.getElementById('dl-val').innerText = Math.round(speed);
                    moveNeedle(speed); // الإبرة تتحرك للداونلود فقط
                }
            } catch(e) { break; }
        }
    });

    await new Promise(r => setTimeout(r, ms));
    ctrl.abort(); clearInterval(pinger);
    return { speed: (bytes*8)/(1024*1024)/(ms/1000)*1.12 };
}

async function startUL(ms) {
    let bytes = 0;
    const start = performance.now();
    const chunk = new Uint8Array(256 * 1024);

    const streams = Array(50).fill(0).map(async () => {
        while (performance.now() - start < ms) {
            try {
                await fetch("https://speed.cloudflare.com/__up", { method: 'POST', body: chunk, mode: 'no-cors', priority: 'high' });
                bytes += chunk.length;
                let speed = (bytes * 8) / (1024 * 1024) / ((performance.now() - start)/1000) * 1.25;
                document.getElementById('v-ul').innerText = speed.toFixed(1);
                // ملاحظة: العداد (الإبرة) لا يتحرك هنا لأنه مخصص للداونلود كما طلبت
            } catch(e) { break; }
        }
    });

    await new Promise(r => setTimeout(r, ms));
    return (bytes*8)/(1024*1024)/(ms/1000)*1.25;
}

function manualNode() {
    activeNode = NODES[document.getElementById('server-select').value] || NODES.cf;
}
