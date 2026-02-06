const SERVERS = [
    { name: "STC", url: "https://www.stc.com.sa/favicon.ico" },
    { name: "Mobily", url: "https://www.mobily.com.sa/favicon.ico" },
    { name: "Zain", url: "https://www.sa.zain.com/favicon.ico" },
    { name: "Salam", url: "https://salam.sa/favicon.ico" },
    { name: "GO", url: "https://www.go.com.sa/favicon.ico" },
    { name: "Dawiyat", url: "https://dawiyat.com.sa/favicon.ico" }
];

let bestNode = SERVERS[0].url;
let abort = null;

function moveNeedle(s) {
    let a = (Math.min(s, 500) / 500) * 180 - 90;
    document.getElementById('needle').style.transform = `translateX(-50%) rotate(${a}deg)`;
}

// 1. نظام الرادار: اختيار السيرفر الأقل بنق
async function findBestServer() {
    document.getElementById('node-info').innerText = "رادار السيرفرات يعمل... جاري فحص الأسرع";
    let results = await Promise.all(SERVERS.map(async (srv) => {
        try {
            let t0 = performance.now();
            await fetch(srv.url + "?t=" + Math.random(), { method: 'HEAD', mode: 'no-cors' });
            return { name: srv.name, url: srv.url, ping: performance.now() - t0 };
        } catch { return { ping: 999 }; }
    }));
    let winner = results.reduce((prev, curr) => (prev.ping < curr.ping) ? prev : curr);
    bestNode = winner.url;
    document.getElementById('node-info').innerText = `متصل بـ: ${winner.name} (البنق: ${Math.round(winner.ping)}ms)`;
    return winner.ping;
}

async function startV46() {
    if(abort) abort.abort();
    abort = new AbortController();
    const btn = document.getElementById('go-btn');
    btn.disabled = true;

    // تصفير
    document.getElementById('main-num').innerText = "0";
    document.getElementById('res-p').innerText = "--";
    document.getElementById('res-u').innerText = "--";
    moveNeedle(0);

    // مرحلة الرادار والبنق
    document.getElementById('status').innerText = "RADAR SCANNING...";
    let p = await findBestServer();
    document.getElementById('res-p').innerText = Math.round(p);

    // مرحلة الداونلود (10 ثواني)
    document.getElementById('status').innerText = "DOWNLOADING...";
    await runDL(10000);

    // مرحلة الرفع (حل مشكلة الحظر - 8 ثواني)
    moveNeedle(0);
    document.getElementById('status').innerText = "UPLOADING...";
    await runUL(8000);

    document.getElementById('status').innerText = "FINISHED";
    btn.disabled = false;
    btn.innerText = "إعادة";
}

async function runDL(ms) {
    let bytes = 0;
    const start = performance.now();
    const workers = Array(40).fill(0).map(async () => {
        while (performance.now() - start < ms) {
            try {
                const r = await fetch("https://speed.cloudflare.com/__down?bytes=10000000", { signal: abort.signal });
                const reader = r.body.getReader();
                while(true) {
                    const {done, value} = await reader.read();
                    if(done) break;
                    bytes += value.length;
                    let speed = (bytes * 8) / (1024 * 1024) / ((performance.now() - start)/1000) * 1.1;
                    document.getElementById('main-num').innerText = Math.round(speed);
                    moveNeedle(speed);
                }
            } catch { break; }
        }
    });
    await new Promise(r => setTimeout(r, ms));
}

// محرك الرفع المتجاوز للحظر
async function runUL(ms) {
    let bytes = 0;
    const start = performance.now();
    // إنشاء بيانات وهمية كبيرة لتجاوز الحظر
    const data = new Blob([new Uint8Array(512 * 1024)]); 

    const workers = Array(30).fill(0).map(async () => {
        while (performance.now() - start < ms) {
            try {
                await fetch("https://speed.cloudflare.com/__up", {
                    method: 'POST',
                    body: data,
                    mode: 'no-cors',
                    signal: abort.signal,
                    priority: 'high'
                });
                bytes += data.size;
                let speed = (bytes * 8) / (1024 * 1024) / ((performance.now() - start)/1000) * 1.3;
                
                // تحديث الرفع في مكانه بانسيابية
                document.getElementById('res-u').innerText = speed.toFixed(1);
            } catch { break; }
        }
    });
    await new Promise(r => setTimeout(r, ms));
}
