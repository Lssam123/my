/* ============================
   تشغيل الساعة
============================ */
function updateClock() {
    const now = new Date();
    const time = now.toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    document.getElementById("clock").textContent = time;
}
setInterval(updateClock, 1000);
updateClock();

/* ============================
   تبديل الثيم (فاتح / داكن)
============================ */
document.getElementById("themeToggle").onclick = () => {
    document.body.classList.toggle("dark");
};

/* ============================
   1) ملخص النصوص الذكي
============================ */

// كلمات شائعة عربية يتم تجاهلها
const stopWords = ["في", "على", "من", "إلى", "عن", "أن", "إن", "كان", "كانت", "هو", "هي", "هذا", "هذه", "ذلك", "هناك", "ما", "لم", "لن"];

function summarizeText(text) {
    let sentences = text.split(/[\.\؟\!]/).filter(s => s.trim().length > 0);
    let words = text.split(/\s+/);

    // حساب تكرار الكلمات
    let freq = {};
    words.forEach(word => {
        word = word.trim();
        if (!stopWords.includes(word) && word.length > 2) {
            freq[word] = (freq[word] || 0) + 1;
        }
    });

    // حساب وزن كل جملة
    let scores = sentences.map(sentence => {
        let score = 0;
        sentence.split(" ").forEach(word => {
            if (freq[word]) score += freq[word];
        });
        return score;
    });

    // اختيار أعلى الجمل
    let topSentences = [];
    let maxScore = Math.max(...scores);

    sentences.forEach((sentence, i) => {
        if (scores[i] > maxScore * 0.4) {
            topSentences.push(sentence.trim());
        }
    });

    return topSentences.join(". ") + ".";
}

document.getElementById("summarizeBtn").onclick = () => {
    let text = document.getElementById("summaryInput").value.trim();
    if (text.length < 20) {
        document.getElementById("summaryOutput").textContent = "الرجاء إدخال نص أطول للتلخيص.";
        return;
    }
    document.getElementById("summaryOutput").textContent = summarizeText(text);
};

/* ============================
   2) المحادثة الذكية
============================ */

// قاعدة بيانات ردود بسيطة
const botReplies = [
    { keywords: ["مرحبا", "هلا", "السلام"], reply: "أهلاً بك! كيف أقدر أساعدك اليوم؟" },
    { keywords: ["اسمك", "من انت"], reply: "أنا مساعدك الذكي، جاهز لخدمتك." },
    { keywords: ["تلخيص", "ملخص"], reply: "تقدر تستخدم أداة التلخيص في الأعلى، فقط ألصق النص واضغط تلخيص." },
    { keywords: ["مهمة", "ذكرني"], reply: "اكتب مهمتك في قسم مساعد المهام وسأتولى الباقي." },
    { keywords: ["شكرا", "يسلمو"], reply: "العفو! سعيد بخدمتك دائماً." }
];

function getBotReply(message) {
    message = message.trim();

    for (let item of botReplies) {
        for (let key of item.keywords) {
            if (message.includes(key)) return item.reply;
        }
    }

    return "لم أفهم رسالتك تماماً، لكني هنا لمساعدتك.";
}

document.getElementById("sendChat").onclick = () => {
    let input = document.getElementById("chatInput");
    let msg = input.value.trim();
    if (msg === "") return;

    let chatBox = document.getElementById("chatBox");

    // رسالة المستخدم
    chatBox.innerHTML += `<div class="message user">${msg}</div>`;

    // رد الذكاء الاصطناعي
    let reply = getBotReply(msg);
    chatBox.innerHTML += `<div class="message bot">${reply}</div>`;

    chatBox.scrollTop = chatBox.scrollHeight;
    input.value = "";
};

/* ============================
   3) مساعد المهام
============================ */

document.getElementById("addTask").onclick = () => {
    let input = document.getElementById("taskInput").value.trim();
    if (input.length < 3) return;

    let timeMatch = input.match(/الساعة\s*(\d+)/);
    let taskText = input.replace(/الساعة\s*\d+/, "").trim();

    let finalTask = taskText;
    if (timeMatch) finalTask += ` — الوقت: ${timeMatch[1]}:00`;

    let li = document.createElement("li");
    li.textContent = finalTask;

    document.getElementById("taskList").appendChild(li);
    document.getElementById("taskInput").value = "";
};

/* ============================
   4) نظام التوصيات الذكي
============================ */

const recommendationsDB = {
    "تقنية": ["كتاب: مقدمة في الأمن السيبراني", "دورة: أساسيات الشبكات", "مقال: مستقبل الذكاء الاصطناعي"],
    "برمجة": ["تعلم JavaScript", "مشروع: بناء موقع كامل", "دورة: Python للمبتدئين"],
    "أمن": ["أدوات اختبار الاختراق", "مقال: حماية الحسابات", "دورة: Security+ أساسيات"],
    "ذكاء": ["مشروع: تحليل نصوص", "مقال: تعلم الآلة", "دورة: أساسيات الذكاء الاصطناعي"]
};

document.getElementById("recBtn").onclick = () => {
    let input = document.getElementById("recInput").value.trim();
    let interests = input.split(/[,،]/).map(i => i.trim());

    let results = [];

    interests.forEach(interest => {
        if (recommendationsDB[interest]) {
            results.push(...recommendationsDB[interest]);
        }
    });

    if (results.length === 0) {
        document.getElementById("recOutput").textContent = "لم أجد توصيات مناسبة.";
    } else {
        document.getElementById("recOutput").innerHTML = results.map(r => `• ${r}`).join("<br>");
    }
};
