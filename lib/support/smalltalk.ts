import type { Lang } from "../i18n/support";

/**
 * Small talk for Pip: greetings, "how are you", thanks, goodbyes, "who are you" and "I'm good".
 * Pure and client-safe. A message only counts as small talk when nothing else is left after the
 * friendly phrases are removed, so "hi, how do I cancel?" still goes to the FAQ.
 */
export type Intent = "bye" | "thanks" | "who" | "howareyou" | "greeting" | "fine";
const PRIORITY: Intent[] = ["bye", "thanks", "who", "howareyou", "greeting", "fine"];

const P: Record<Intent, Partial<Record<Lang, string[]>>> = {
  greeting: {
    en: ["hi", "hello", "hey", "hiya", "heya", "yo", "howdy", "good morning", "good afternoon", "good evening", "greetings", "sup", "whats up", "hi there", "hello there", "hey there"],
    es: ["hola", "buenos dias", "buenas tardes", "buenas noches", "buenas"],
    fr: ["bonjour", "salut", "bonsoir", "coucou"],
    de: ["hallo", "guten morgen", "guten tag", "guten abend", "servus", "moin"],
    pt: ["ola", "oi", "bom dia", "boa tarde", "boa noite", "e ai"],
    ar: ["مرحبا", "مرحبًا", "اهلا", "أهلا", "أهلًا", "السلام عليكم", "سلام", "صباح الخير", "مساء الخير", "هلا"],
    zh: ["你好", "您好", "嗨", "哈喽", "早上好", "晚上好", "大家好"],
    ja: ["こんにちは", "こんばんは", "おはようございます", "おはよう", "やあ", "もしもし"],
    ru: ["привет", "здравствуйте", "здравствуй", "добрый день", "доброе утро", "добрый вечер", "приветствую"],
    id: ["halo", "hai", "selamat pagi", "selamat siang", "selamat sore", "selamat malam"],
    bn: ["নমস্কার", "হ্যালো", "হাই", "আসসালামু আলাইকুম", "শুভ সকাল"],
    hi: ["नमस्ते", "नमस्कार", "हैलो", "हेलो", "हाय", "प्रणाम", "राम राम", "namaste", "namaskar"],
  },
  howareyou: {
    en: ["how are you", "how r u", "how are u", "how ru", "hows it going", "how is it going", "how are things", "how do you do", "how you doing", "how are you doing", "hru", "wassup", "whats new"],
    es: ["como estas", "como esta", "que tal", "como te va", "como andas"],
    fr: ["ca va", "comment ca va", "comment vas tu", "comment allez vous"],
    de: ["wie gehts", "wie geht es dir", "wie geht es ihnen", "wie gehts dir", "alles gut"],
    pt: ["como vai", "tudo bem", "tudo bom", "como voce esta", "como vc esta", "beleza"],
    ar: ["كيف حالك", "كيفك", "شلونك", "كيف الحال"],
    zh: ["你好吗", "你怎么样", "最近好吗", "还好吗", "最近怎么样"],
    ja: ["お元気ですか", "元気ですか", "調子はどう", "調子どう", "元気"],
    ru: ["как дела", "как ты", "как вы", "как поживаешь", "как жизнь"],
    id: ["apa kabar", "gimana kabarnya", "bagaimana kabarmu"],
    bn: ["কেমন আছেন", "কেমন আছো", "কেমন আছ", "কি খবর"],
    hi: ["कैसे हो", "कैसे हैं", "आप कैसे हैं", "क्या हाल है", "कैसी हो", "kaise ho", "kya haal hai", "kaise hain"],
  },
  thanks: {
    en: ["thanks", "thank you", "thx", "ty", "cheers", "thanks a lot", "much appreciated", "appreciate it", "thank u", "tysm", "thanks so much"],
    es: ["gracias", "muchas gracias", "mil gracias"],
    fr: ["merci", "merci beaucoup"],
    de: ["danke", "danke schon", "dankeschon", "vielen dank"],
    pt: ["obrigado", "obrigada", "valeu", "muito obrigado", "muito obrigada"],
    ar: ["شكرا", "شكرًا", "شكرا جزيلا", "مشكور"],
    zh: ["谢谢", "多谢", "感谢", "谢啦"],
    ja: ["ありがとうございます", "ありがとう", "どうも"],
    ru: ["спасибо", "благодарю", "спс"],
    id: ["terima kasih", "makasih", "trims"],
    bn: ["ধন্যবাদ", "থ্যাংকস"],
    hi: ["धन्यवाद", "शुक्रिया", "थैंक्स", "dhanyavaad", "shukriya"],
  },
  bye: {
    en: ["bye", "goodbye", "good bye", "see you", "see ya", "cya", "good night", "take care", "bye bye", "later"],
    es: ["adios", "hasta luego", "chao", "nos vemos", "hasta pronto"],
    fr: ["au revoir", "a bientot", "bonne nuit", "a plus"],
    de: ["tschuss", "auf wiedersehen", "bis spater", "ciao", "gute nacht", "bis bald"],
    pt: ["tchau", "ate logo", "ate mais", "falou"],
    ar: ["مع السلامة", "وداعا", "إلى اللقاء", "تصبح على خير"],
    zh: ["再见", "拜拜", "回头见", "晚安"],
    ja: ["さようなら", "またね", "じゃあね", "バイバイ", "おやすみ"],
    ru: ["пока", "до свидания", "увидимся", "спокойной ночи"],
    id: ["sampai jumpa", "selamat tinggal", "dadah"],
    bn: ["বিদায়", "আবার দেখা হবে", "টাটা"],
    hi: ["अलविदा", "बाय", "फिर मिलेंगे", "शुभ रात्रि"],
  },
  who: {
    en: ["who are you", "what are you", "are you a bot", "are you human", "are you real", "are you a robot", "whats your name", "what is your name", "your name", "what can you do", "what do you do"],
    es: ["quien eres", "como te llamas", "eres un bot", "eres humano", "que puedes hacer"],
    fr: ["qui es tu", "tu es qui", "comment tu tappelles", "es tu un robot", "que peux tu faire"],
    de: ["wer bist du", "wie heisst du", "bist du ein bot", "was kannst du"],
    pt: ["quem e voce", "qual seu nome", "qual e o seu nome", "voce e um robo", "o que voce faz"],
    ar: ["من أنت", "ما اسمك", "هل أنت روبوت"],
    zh: ["你是谁", "你叫什么", "你是机器人吗", "你能做什么"],
    ja: ["あなたは誰", "誰ですか", "ボットですか", "何ができる"],
    ru: ["кто ты", "как тебя зовут", "ты бот", "что ты умеешь"],
    id: ["siapa kamu", "kamu siapa", "nama kamu siapa", "kamu bot"],
    bn: ["তুমি কে", "আপনি কে", "তোমার নাম কি"],
    hi: ["तुम कौन हो", "आप कौन हैं", "तुम्हारा नाम क्या है", "kaun ho"],
  },
  fine: {
    en: ["good", "fine", "great", "im good", "i am good", "im fine", "i am fine", "doing good", "doing well", "not bad", "all good", "ok", "okay", "cool", "nice", "awesome", "pretty good", "im great", "very well"],
    es: ["bien", "muy bien", "todo bien", "genial"],
    fr: ["bien", "tres bien", "super", "nickel"],
    de: ["gut", "sehr gut", "mir gehts gut", "prima"],
    pt: ["bem", "estou bem", "otimo", "tranquilo"],
    ar: ["بخير", "تمام", "الحمد لله", "كويس"],
    zh: ["很好", "不错", "还行", "好的"],
    ja: ["元気です", "大丈夫", "いいよ"],
    ru: ["хорошо", "нормально", "отлично", "все хорошо"],
    id: ["baik", "kabar baik", "baik baik saja", "oke"],
    bn: ["ভালো", "ভালো আছি", "ঠিক আছে"],
    hi: ["ठीक", "ठीक हूँ", "बढ़िया", "मैं ठीक हूँ", "अच्छा", "theek", "badhiya", "mast"],
  },
};

const R: Record<Intent, Record<Lang, string[]>> = {
  greeting: {
    en: ["Hi, how are you?", "Hey there! How's your day going?", "Hello! What can I help you with today?", "Hi! Good to see you. How are you doing?"],
    hi: ["नमस्ते, आप कैसे हैं?", "हैलो! आज आपका दिन कैसा चल रहा है?", "नमस्ते! बताइए, आज मैं क्या मदद करूँ?"],
    es: ["¡Hola! ¿Cómo estás?", "¡Hola! ¿Qué tal va tu día?", "¡Hola! ¿En qué te puedo ayudar hoy?"],
    fr: ["Salut, comment ça va ?", "Bonjour ! Ta journée se passe bien ?", "Bonjour ! Je peux t'aider avec quoi aujourd'hui ?"],
    de: ["Hallo, wie geht's dir?", "Hey! Wie läuft dein Tag?", "Hallo! Wobei kann ich dir heute helfen?"],
    pt: ["Oi, tudo bem?", "Olá! Como está o seu dia?", "Oi! Em que posso ajudar hoje?"],
    ar: ["مرحبًا، كيف حالك؟", "أهلًا! كيف يومك؟", "مرحبًا! كيف يمكنني مساعدتك اليوم؟"],
    zh: ["你好，最近怎么样？", "嗨！今天过得好吗？", "你好！今天有什么可以帮你的？"],
    ja: ["こんにちは、お元気ですか？", "やあ！今日はどんな一日ですか？", "こんにちは！今日は何をお手伝いしましょう？"],
    ru: ["Привет, как дела?", "Привет! Как проходит день?", "Здравствуйте! Чем могу помочь сегодня?"],
    id: ["Hai, apa kabar?", "Halo! Gimana harimu?", "Halo! Ada yang bisa aku bantu hari ini?"],
    bn: ["নমস্কার, কেমন আছেন?", "হ্যালো! আজ দিনটা কেমন যাচ্ছে?", "হাই! আজ কীভাবে সাহায্য করতে পারি?"],
  },
  howareyou: {
    en: ["I'm doing great, thanks for asking! How about you?", "All good here, busy scheduling posts. How are you?", "Pretty good! Thanks for asking. What can I do for you today?"],
    hi: ["मैं बढ़िया हूँ, पूछने के लिए धन्यवाद! आप कैसे हैं?", "सब बढ़िया! आप बताइए, आपका दिन कैसा है?", "अच्छा हूँ! बताइए, मैं क्या मदद करूँ?"],
    es: ["¡Muy bien, gracias por preguntar! ¿Y tú?", "Todo bien por aquí. ¿Cómo estás tú?", "¡Genial! ¿En qué te ayudo hoy?"],
    fr: ["Très bien, merci de demander ! Et toi ?", "Tout va bien ici. Et toi, ça va ?", "Super bien ! Je peux t'aider avec quoi ?"],
    de: ["Mir geht's super, danke der Nachfrage! Und dir?", "Alles bestens hier. Wie geht's dir?", "Sehr gut! Wobei kann ich helfen?"],
    pt: ["Tudo ótimo, obrigado por perguntar! E você?", "Tudo bem por aqui. E com você?", "Muito bem! Em que posso ajudar?"],
    ar: ["أنا بخير، شكرًا لسؤالك! وأنت؟", "كل شيء تمام هنا. كيف حالك أنت؟", "بخير! كيف أساعدك اليوم؟"],
    zh: ["我很好，谢谢关心！你呢？", "一切都好。你最近怎么样？", "挺好的！今天需要什么帮助？"],
    ja: ["元気です、聞いてくれてありがとう！あなたは？", "こちらは順調です。あなたはどうですか？", "元気ですよ！何をお手伝いしましょう？"],
    ru: ["Отлично, спасибо, что спросили! А у вас?", "Всё хорошо. А как ваши дела?", "Прекрасно! Чем могу помочь?"],
    id: ["Aku baik, makasih sudah tanya! Kamu gimana?", "Semua lancar di sini. Kamu apa kabar?", "Baik banget! Ada yang bisa aku bantu?"],
    bn: ["আমি ভালো আছি, জিজ্ঞেস করার জন্য ধন্যবাদ! আপনি?", "সব ঠিকঠাক। আপনি কেমন আছেন?", "ভালোই! কীভাবে সাহায্য করতে পারি?"],
  },
  thanks: {
    en: ["You're welcome! Anything else I can help with?", "Happy to help!", "Anytime! Shout if you need anything else."],
    hi: ["आपका स्वागत है! और कुछ मदद चाहिए?", "मदद करके खुशी हुई!", "कभी भी! कुछ और चाहिए तो बताइए।"],
    es: ["¡De nada! ¿Algo más en lo que te ayude?", "¡Un placer ayudarte!", "¡Cuando quieras!"],
    fr: ["Avec plaisir ! Autre chose ?", "Content d'avoir pu aider !", "De rien, à ton service !"],
    de: ["Gern geschehen! Noch etwas?", "Freut mich, dass ich helfen konnte!", "Jederzeit!"],
    pt: ["De nada! Posso ajudar com mais alguma coisa?", "Fico feliz em ajudar!", "Sempre que precisar!"],
    ar: ["على الرحب والسعة! هل تحتاج شيئًا آخر؟", "سعيد بمساعدتك!", "في أي وقت!"],
    zh: ["不客气！还有什么需要帮忙的吗？", "很高兴能帮上忙！", "随时找我！"],
    ja: ["どういたしまして！他に何かありますか？", "お役に立ててうれしいです！", "いつでもどうぞ！"],
    ru: ["Пожалуйста! Чем-то ещё помочь?", "Рад помочь!", "Обращайтесь в любое время!"],
    id: ["Sama-sama! Ada lagi yang bisa aku bantu?", "Senang bisa bantu!", "Kapan saja!"],
    bn: ["স্বাগতম! আর কিছু সাহায্য লাগবে?", "সাহায্য করতে পেরে ভালো লাগলো!", "যেকোনো সময়!"],
  },
  bye: {
    en: ["Bye! Happy posting.", "See you soon! Good luck with your next post.", "Take care! I'm here whenever you need me."],
    hi: ["बाय! पोस्टिंग का मज़ा लीजिए।", "फिर मिलेंगे! अगली पोस्ट के लिए शुभकामनाएँ।", "ध्यान रखिए! ज़रूरत हो तो मैं यहीं हूँ।"],
    es: ["¡Adiós! Que publiques mucho.", "¡Hasta pronto! Suerte con tu próximo post.", "¡Cuídate! Aquí estoy cuando me necesites."],
    fr: ["Au revoir ! Bonnes publications.", "À bientôt ! Bonne chance pour ton prochain post.", "Prends soin de toi ! Je suis là si besoin."],
    de: ["Tschüss! Viel Spaß beim Posten.", "Bis bald! Viel Erfolg mit dem nächsten Post.", "Mach's gut! Ich bin da, wenn du mich brauchst."],
    pt: ["Tchau! Boas postagens.", "Até logo! Boa sorte no próximo post.", "Se cuida! Estou aqui quando precisar."],
    ar: ["مع السلامة! نشرًا موفقًا.", "إلى اللقاء! بالتوفيق في منشورك القادم.", "اعتنِ بنفسك! أنا هنا متى احتجتني."],
    zh: ["再见！发帖愉快。", "回头见！祝下一条内容大火。", "保重！需要我随时在。"],
    ja: ["またね！楽しい投稿を。", "ではまた！次の投稿もがんばって。", "お元気で！いつでも呼んでください。"],
    ru: ["Пока! Удачных публикаций.", "До встречи! Удачи со следующим постом.", "Берегите себя! Я всегда здесь."],
    id: ["Dadah! Selamat posting.", "Sampai jumpa! Semoga sukses dengan postingan berikutnya.", "Jaga diri! Aku ada kapan pun kamu butuh."],
    bn: ["বিদায়! পোস্টিং ভালো কাটুক।", "আবার দেখা হবে! পরের পোস্টের জন্য শুভকামনা।", "ভালো থাকবেন! দরকার হলে আমি আছি।"],
  },
  who: {
    en: ["I'm Pip, Outlly's support assistant (a bot). I can help with uploads, scheduling, accounts and billing. If you'd rather talk to a person, just say so.", "I'm Pip! I answer questions about Outlly, and I can pass you to our team any time you ask for a human."],
    hi: ["मैं Pip हूँ, Outlly का सपोर्ट असिस्टेंट (एक बॉट)। अपलोड, शेड्यूलिंग, अकाउंट और बिलिंग में मदद कर सकता हूँ। किसी व्यक्ति से बात करनी हो तो बस बताइए।"],
    es: ["Soy Pip, el asistente de soporte de Outlly (un bot). Te ayudo con subidas, programación, cuentas y pagos. Si prefieres hablar con una persona, dímelo."],
    fr: ["Je suis Pip, l'assistant support d'Outlly (un bot). J'aide pour les envois, la planification, les comptes et la facturation. Si tu préfères un humain, dis-le."],
    de: ["Ich bin Pip, der Support-Assistent von Outlly (ein Bot). Ich helfe bei Uploads, Planung, Konten und Abrechnung. Wenn du lieber mit einem Menschen sprichst, sag einfach Bescheid."],
    pt: ["Sou o Pip, o assistente de suporte da Outlly (um bot). Ajudo com uploads, agendamento, contas e cobrança. Se preferir falar com uma pessoa, é só dizer."],
    ar: ["أنا Pip، مساعد دعم Outlly (روبوت). أساعدك في الرفع والجدولة والحسابات والفوترة. إن أردت التحدث مع شخص، فقط أخبرني."],
    zh: ["我是 Pip，Outlly 的客服助手（机器人）。可以帮你处理上传、排期、账号和账单问题。想找真人客服，直接告诉我就行。"],
    ja: ["Outlly のサポートアシスタント、Pip（ボット）です。アップロード、予約投稿、アカウント、請求のことならお手伝いします。担当者と話したいときは言ってください。"],
    ru: ["Я Pip, помощник поддержки Outlly (бот). Помогу с загрузками, расписанием, аккаунтами и оплатой. Если хотите поговорить с человеком, просто скажите."],
    id: ["Aku Pip, asisten dukungan Outlly (bot). Aku bisa bantu soal unggahan, penjadwalan, akun, dan tagihan. Kalau mau bicara dengan orang, bilang saja."],
    bn: ["আমি Pip, Outlly-র সাপোর্ট অ্যাসিস্ট্যান্ট (একটি বট)। আপলোড, শিডিউলিং, অ্যাকাউন্ট আর বিলিং নিয়ে সাহায্য করতে পারি। কোনো মানুষের সাথে কথা বলতে চাইলে বলুন।"],
  },
  fine: {
    en: ["Glad to hear it! What can I help you with today?", "Great! Ask me anything about Outlly.", "Nice! How can I help?"],
    hi: ["यह सुनकर अच्छा लगा! बताइए, मैं क्या मदद करूँ?", "बढ़िया! Outlly के बारे में कुछ भी पूछिए।"],
    es: ["¡Me alegro! ¿En qué te ayudo?", "¡Genial! Pregúntame lo que quieras sobre Outlly."],
    fr: ["Content de l'entendre ! Je peux t'aider avec quoi ?", "Super ! Pose-moi tes questions sur Outlly."],
    de: ["Schön zu hören! Wobei kann ich helfen?", "Super! Frag mich alles zu Outlly."],
    pt: ["Que bom! Em que posso ajudar?", "Ótimo! Pergunte o que quiser sobre a Outlly."],
    ar: ["يسعدني سماع ذلك! كيف أساعدك؟", "رائع! اسألني أي شيء عن Outlly."],
    zh: ["太好了！有什么可以帮你的？", "不错！关于 Outlly 尽管问我。"],
    ja: ["よかったです！何をお手伝いしましょう？", "いいですね！Outlly のことなら何でも聞いてください。"],
    ru: ["Рад слышать! Чем помочь?", "Отлично! Спрашивайте что угодно про Outlly."],
    id: ["Senang dengarnya! Ada yang bisa aku bantu?", "Mantap! Tanya apa saja soal Outlly."],
    bn: ["শুনে ভালো লাগলো! কীভাবে সাহায্য করতে পারি?", "দারুণ! Outlly নিয়ে যা খুশি জিজ্ঞেস করুন।"],
  },
};

/** Words that may surround small talk without turning it into a real question. */
const FILLER = new Set(
  "i me my am you u your ur and too also very so really just pretty all there pip outlly outly bot friend buddy dear sir madam maam ji bhai team guys everyone again oh ah um hmm well yeah yes yep the a to is it its doing today man bro y tu et toi und du e voce و أنت 你 呢 も ты вы а и dan kamu আপনি আর আর ও और आप भी जी".split(" "),
);

/** Lowercase, drop Latin accents and apostrophes, turn punctuation into spaces. Indic vowel signs stay. */
export function norm(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .normalize("NFC")
    .replace(/['’`]/g, "")
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const CJK = /[\u3040-\u30ff\u3400-\u9fff]/;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
type Entry = { re: RegExp; intent: Intent; langs: Lang[]; len: number };
const ENTRIES: Entry[] = (() => {
  const byPhrase = new Map<string, { intent: Intent; langs: Lang[] }>();
  for (const intent of Object.keys(P) as Intent[])
    for (const [lang, list] of Object.entries(P[intent]) as [Lang, string[]][])
      for (const raw of list) {
        const p = norm(raw);
        const e = byPhrase.get(p);
        if (e) e.langs.push(lang);
        else byPhrase.set(p, { intent, langs: [lang] });
      }
  return [...byPhrase].map(([p, v]) => ({
    ...v,
    len: p.length,
    // CJK has no spaces between words, so match it anywhere; everything else needs word edges.
    re: CJK.test(p) ? new RegExp(esc(p), "gu") : new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])${esc(p)}(?![\\p{L}\\p{M}\\p{N}])`, "gu"),
  })).sort((a, b) => b.len - a.len);
})();

/** Script-based language guess. Latin text returns null (too ambiguous to guess safely). */
export function detectScript(s: string): Lang | null {
  if (/[\u3040-\u30ff]/.test(s)) return "ja";
  if (/[\u4e00-\u9fff]/.test(s)) return "zh";
  if (/[\u0900-\u097f]/.test(s)) return "hi";
  if (/[\u0980-\u09ff]/.test(s)) return "bn";
  if (/[\u0600-\u06ff]/.test(s)) return "ar";
  if (/[\u0400-\u04ff]/.test(s)) return "ru";
  return null;
}

export interface SmallTalk { intent: Intent; lang: Lang; reply: string }

/**
 * Returns a friendly reply when the whole message is small talk, else null.
 * The reply language follows what the person wrote ("hola" gets Spanish) unless they used an
 * English word everyone uses ("hi", "ok", "thanks"); then it stays in the chosen language.
 */
export function smallTalk(message: string, lang: Lang = "en", rand: () => number = Math.random): SmallTalk | null {
  let text = norm(message);
  if (!text || text.length > 80) return null;
  const hits: Entry[] = [];
  for (const e of ENTRIES) {
    e.re.lastIndex = 0;
    if (e.re.test(text)) {
      hits.push(e);
      e.re.lastIndex = 0;
      text = text.replace(e.re, " ");
    }
  }
  if (!hits.length) return null;
  const left = text.split(/\s+/).filter((w) => w && !FILLER.has(w));
  if (left.length) return null;
  const intent = PRIORITY.find((i) => hits.some((h) => h.intent === i))!;
  const own = hits.filter((h) => h.intent === intent).flatMap((h) => h.langs);
  const out: Lang = own.includes(lang) ? lang : (own.find((l) => l !== "en") ?? detectScript(message) ?? lang);
  const list = R[intent][out] ?? R[intent].en;
  return { intent, lang: out, reply: list[Math.floor(rand() * list.length) % list.length] };
}

/** Asking for a person, in every supported language. Latin words need word edges; other scripts don't. */
export const HUMAN_RE =
  /\b(human|humano|humain|mensch|manusia|agent|agente|person|real person|someone|talk to (a|an|your)|support team|call me|escalate|representative|operator|operador|operateur|atendente|conseiller|mitarbeiter|echte person|persona real|pessoa real|petugas|orang sungguhan|hablar con alguien|falar com alguem|parler a quelquun)\b|इंसान|व्यक्ति|एजेंट|किसी से बात|إنسان|موظف|شخص حقيقي|التحدث مع شخص|人工客服|转人工|真人|人間と話|オペレーター|担当者|живой человек|оператор|с человеком|сотрудник поддержки|মানুষের সাথে|এজেন্ট|কারো সাথে কথা/i;
