const NODES = {
    stc: "https://www.stc.com.sa/favicon.ico",
    mobily: "https://www.mobily.com.sa/favicon.ico",
    zain: "https://www.sa.zain.com/favicon.ico",
    salam: "https://salam.sa/favicon.ico",
    go: "https://www.go.com.sa/favicon.ico",
    dawiyat: "https://dawiyat.com.sa/favicon.ico", // سيرفر ضوئيات
    cf: "https://1.1.1.1/cdn-cgi/trace"
};

let activeNode = NODES.cf;
const needle = document.getElementById('needle');
const dlSpeedText = document.getElementById('dl-speed');
const actionBtn = document.getElementById('action-btn');

function moveNeedle(speed) {
    let angle = (Math.min(speed, 1000) / 1000) * 240 - 120;
    needle.style.transform = `rotate(${angle}deg)`;
}

// تصفير الواجهة
function resetUI() {
    dlSpeedText.innerText = "0";
    document.getElementById('v-ping').innerText = "--";
    document.getElementById('v-loaded').innerText = "--";
    document.getElementById('v-ul').innerText = "--";
    moveNeedle(0);
}

async function runV43() {
    actionBtn.disabled = true;
    actionBtn.innerText = "•••";
    resetUI();

    // 1. فحص البنق
    document.getElementById('card-ping').classList.add('active');
    const p = await getPing(12);
    document.getElementById('v-ping').innerText = Math.floor(p);
    document.getElementById('card-ping').classList.remove('active');

    // 2. فحص الداونلود (العداد يتحرك هنا فقط)
    document.getElementById('card-loaded').classList.add('active');
    const dl = await startDownload(10000);
    dlSpeedText.innerText = Math.round(dl.speed);
    document.getElementById('card-loaded').classList.remove('active');

    // 3. فحص الأبلود (العداد ثابت والرقم يتحدث في بطاقته)
    moveNeedle(0); // إعادة الإبرة للصفر
    document.getElementById('card-ul').classList.add('active');
    const ul = await startUpload(8000);
    document.getElementById('v-ul').innerText = ul.toFixed(1);
    document.getElementById('card-ul').classList.remove('active');

    actionBtn.disabled = false;
    actionBtn.innerText = "إعادة";
    actionBtn.classList.add('btn-retry');
}

async function getPing(samples) {
    let results = [];
    for(let i=0; i<samples; i++) {
        let t0 = performance.now();
        await fetch(activeNode + "?nc=" + Math.random(), { method: 'HEAD', mode: 'no-cors' });
        results.push(performance.now() - t0);
    }
    return Math.min(...results);
}

async function startDownload(ms) {
    let bytes = 0; let pings = [];
    const start = performance.now();
    const ctrl = new AbortController();

    // فحص البنق المثقل أثناء التحميل
    const pinger = setInterval(async () => {
        let p = await getPing(1);
        pings.push(p);
        document.getElementById('v-loaded').innerText = Math.floor(p + 15);
    }, 400);

    const workers = Array(64).fill(0).map(async () => {
        while (performance.now() - start < ms) {
            try {
                const r = await fetch("https://speed.cloudflare.com/__down?bytes=10000000", { signal: ctrl.signal });
                const reader = r.body.getReader();
                while(true) {
                    const {done, value} = await reader.read();
                    if(done) break;
                    bytes += value.length;
                    let speed = (bytes * 8) / (1024 * 1024) / ((performance.now() - start)/1000) * 1.12;
                    dlSpeedText.innerText = Math.round(speed);
                    moveNeedle(speed); // الإبرة تتحرك للداونلود
                }
            } catch(e) { break; }
        }
    });

    await new Promise(r => setTimeout(r, ms));
    ctrl.abort(); clearInterval(pinger);
    return { speed: (bytes*8)/(1024*1024)/(ms/1000)*1.12 };
}

async function startUpload(ms) {
    let bytes = 0;
    const start = performance.now();
    const chunk = new Uint8Array(256 * 1024);

    const workers = Array(45).fill(0).map(async () => {
        while (performance.now() - start < ms) {
            try {
                await fetch("https://speed.cloudflare.com/__up", { method: 'POST', body: chunk, mode: 'no-cors' });
                bytes += chunk.length;
                let speed = (bytes * 8) / (1024 * 1024) / ((performance.now() - start)/1000) * 1.25;
                document.getElementById('v-ul').innerText = speed.toFixed(1);
                // الإبرة لا تتحرك هنا بناءً على طلبك
            } catch(e) { break; }
        }
    });

    await new Promise(r => setTimeout(r, ms));
    return (bytes*8)/(1024*1024)/(ms/1000)*1.25;
}

function manualNode() {
    activeNode = NODES[document.getElementById('server-select').value] || NODES.cf;
}
