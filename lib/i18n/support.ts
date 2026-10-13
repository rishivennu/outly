/** Client-safe UI strings for the chat widget and help centre. Add a language by adding a key to LANGS, T and HELP_T. */
export type Lang = "en" | "hi" | "es" | "fr" | "de" | "pt" | "ar" | "zh" | "ja" | "ru" | "id" | "bn";
export const LANGS: { id: Lang; label: string; short: string; dir?: "rtl" }[] = [
  { id: "en", label: "English", short: "EN" },
  { id: "hi", label: "हिन्दी", short: "हि" },
  { id: "es", label: "Español", short: "ES" },
  { id: "fr", label: "Français", short: "FR" },
  { id: "de", label: "Deutsch", short: "DE" },
  { id: "pt", label: "Português", short: "PT" },
  { id: "ar", label: "العربية", short: "ع", dir: "rtl" },
  { id: "zh", label: "中文", short: "中" },
  { id: "ja", label: "日本語", short: "日" },
  { id: "ru", label: "Русский", short: "RU" },
  { id: "id", label: "Bahasa Indonesia", short: "ID" },
  { id: "bn", label: "বাংলা", short: "বা" },
];
export const LANG_IDS = LANGS.map((l) => l.id) as [Lang, ...Lang[]];
export const LANG_KEY = "outly-lang";
export const isLang = (v: unknown): v is Lang => typeof v === "string" && (LANG_IDS as string[]).includes(v);
export const langDir = (l: Lang) => (LANGS.find((x) => x.id === l)?.dir ?? "ltr") as "ltr" | "rtl";

type ChatT = {
  open: string; close: string; title: string; status: string; hello: string; placeholder: string; send: string; thinking: string;
  helpful: string; yes: string; no: string; human: string; escalate: string; email: string; raise: string; raising: string;
  raised: (ref: string, emailed: boolean) => string; duplicate: (ref: string) => string; glad: string; offline: string; error: string;
  suggestions: string[]; related: string; faqLink: string; lang: string; more: string; nudge: string;
};

export const T: Record<Lang, ChatT> = {
  en: {
    open: "Chat with Pip", close: "Close chat", title: "Pip from Outlly", status: "Usually answers instantly",
    hello: "Hi! I'm Pip. Ask me anything about Outlly: billing, publishing, your account. If I can't solve it, I'll get a person.",
    placeholder: "Type your question", send: "Send", thinking: "Pip is thinking",
    helpful: "Did that help?", yes: "Yes, thanks", no: "Not really", human: "Talk to a person",
    escalate: "I couldn't solve this, so I'm handing it to our team and putting it at the front of the queue. Where should we reply?",
    email: "Your email", raise: "Open ticket", raising: "Opening ticket",
    raised: (ref, emailed) => `Done. Ticket ${ref} is open${emailed ? " and we've emailed you a copy" : ""}. A person will reply soon, usually within a few hours.`,
    duplicate: (ref) => `You already have ticket ${ref} open about this, so I added this chat to it.`,
    glad: "Glad I could help! Anything else?",
    offline: "You're offline. I'll be here when you reconnect.",
    error: "Something got in the way. Try again in a moment.",
    suggestions: ["How do I cancel my plan?", "Where are my invoices?", "My payment failed", "Why did my post fail?"],
    related: "Related", faqLink: "Browse the help centre", lang: "Language",
    more: "Sorry about that. Can you tell me a bit more?", nudge: "Questions? I can help.",
  },
  hi: {
    open: "Pip से बात करें", close: "चैट बंद करें", title: "Outlly का Pip", status: "आमतौर पर तुरंत जवाब देता है",
    hello: "नमस्ते! मैं Pip हूँ। Outlly के बारे में कुछ भी पूछिए: बिलिंग, पब्लिशिंग, आपका अकाउंट। अगर मैं हल न कर पाऊँ, तो किसी व्यक्ति को बुला दूँगा।",
    placeholder: "अपना सवाल लिखें", send: "भेजें", thinking: "Pip सोच रहा है",
    helpful: "क्या इससे मदद मिली?", yes: "हाँ, धन्यवाद", no: "नहीं", human: "किसी व्यक्ति से बात करें",
    escalate: "मैं इसे हल नहीं कर पाया, इसलिए इसे हमारी टीम को सबसे पहले देखने के लिए भेज रहा हूँ। हम जवाब कहाँ भेजें?",
    email: "आपका ईमेल", raise: "टिकट खोलें", raising: "टिकट खुल रहा है",
    raised: (ref, emailed) => `हो गया। टिकट ${ref} खुल गया है${emailed ? " और इसकी कॉपी आपको ईमेल कर दी गई है" : ""}। जल्द ही कोई व्यक्ति जवाब देगा।`,
    duplicate: (ref) => `इस बारे में आपका टिकट ${ref} पहले से खुला है, मैंने यह चैट उसी में जोड़ दी है।`,
    glad: "खुशी हुई कि मदद कर सका! और कुछ?",
    offline: "आप ऑफ़लाइन हैं। दोबारा कनेक्ट होने पर मैं यहीं मिलूँगा।",
    error: "कुछ गड़बड़ हो गई। थोड़ी देर में फिर कोशिश करें।",
    suggestions: ["मैं अपना प्लान कैसे रद्द करूँ?", "मेरे इनवॉइस कहाँ हैं?", "मेरा पेमेंट फेल हो गया", "मेरी पोस्ट फेल क्यों हुई?"],
    related: "संबंधित", faqLink: "हेल्प सेंटर देखें", lang: "भाषा",
    more: "माफ़ कीजिए। क्या आप थोड़ा और बता सकते हैं?", nudge: "कोई सवाल? मैं मदद कर सकता हूँ।",
  },
  es: {
    open: "Chatea con Pip", close: "Cerrar chat", title: "Pip de Outlly", status: "Suele responder al instante",
    hello: "¡Hola! Soy Pip. Pregúntame lo que quieras sobre Outlly: facturación, publicaciones o tu cuenta. Si no puedo resolverlo, te paso con una persona.",
    placeholder: "Escribe tu pregunta", send: "Enviar", thinking: "Pip está pensando",
    helpful: "¿Te ayudó?", yes: "Sí, gracias", no: "No mucho", human: "Hablar con una persona",
    escalate: "No pude resolverlo, así que se lo paso a nuestro equipo con prioridad. ¿A dónde te respondemos?",
    email: "Tu correo", raise: "Abrir ticket", raising: "Abriendo ticket",
    raised: (ref, emailed) => `Listo. El ticket ${ref} está abierto${emailed ? " y te enviamos una copia por correo" : ""}. Una persona te responderá pronto, normalmente en pocas horas.`,
    duplicate: (ref) => `Ya tienes el ticket ${ref} abierto sobre esto, así que añadí este chat.`,
    glad: "¡Me alegra haber ayudado! ¿Algo más?",
    offline: "Estás sin conexión. Aquí estaré cuando vuelvas.",
    error: "Algo salió mal. Inténtalo de nuevo en un momento.",
    suggestions: ["¿Cómo cancelo mi plan?", "¿Dónde están mis facturas?", "Mi pago falló", "¿Por qué falló mi publicación?"],
    related: "Relacionado", faqLink: "Ver el centro de ayuda", lang: "Idioma",
    more: "Lo siento. ¿Me cuentas un poco más?", nudge: "¿Dudas? Te ayudo.",
  },
  fr: {
    open: "Discuter avec Pip", close: "Fermer le chat", title: "Pip d'Outlly", status: "Répond généralement tout de suite",
    hello: "Salut ! Je suis Pip. Pose-moi tes questions sur Outlly : facturation, publication, ton compte. Si je ne peux pas t'aider, je fais appel à une personne.",
    placeholder: "Écris ta question", send: "Envoyer", thinking: "Pip réfléchit",
    helpful: "Ça t'a aidé ?", yes: "Oui, merci", no: "Pas vraiment", human: "Parler à une personne",
    escalate: "Je n'ai pas pu résoudre ça, je le transmets en priorité à notre équipe. Où devons-nous te répondre ?",
    email: "Ton e-mail", raise: "Ouvrir un ticket", raising: "Ouverture du ticket",
    raised: (ref, emailed) => `C'est fait. Le ticket ${ref} est ouvert${emailed ? " et une copie t'a été envoyée par e-mail" : ""}. Une personne te répondra bientôt, en général sous quelques heures.`,
    duplicate: (ref) => `Tu as déjà le ticket ${ref} ouvert à ce sujet, j'y ai ajouté cette conversation.`,
    glad: "Ravi d'avoir aidé ! Autre chose ?",
    offline: "Tu es hors ligne. Je serai là à ton retour.",
    error: "Un souci est survenu. Réessaie dans un instant.",
    suggestions: ["Comment annuler mon abonnement ?", "Où sont mes factures ?", "Mon paiement a échoué", "Pourquoi ma publication a échoué ?"],
    related: "Voir aussi", faqLink: "Parcourir le centre d'aide", lang: "Langue",
    more: "Désolé. Tu peux m'en dire un peu plus ?", nudge: "Une question ? Je peux aider.",
  },
  de: {
    open: "Mit Pip chatten", close: "Chat schließen", title: "Pip von Outlly", status: "Antwortet meist sofort",
    hello: "Hallo! Ich bin Pip. Frag mich alles zu Outlly: Abrechnung, Veröffentlichen, dein Konto. Wenn ich nicht helfen kann, hole ich einen Menschen dazu.",
    placeholder: "Deine Frage", send: "Senden", thinking: "Pip denkt nach",
    helpful: "Hat das geholfen?", yes: "Ja, danke", no: "Nicht wirklich", human: "Mit einem Menschen sprechen",
    escalate: "Das konnte ich nicht lösen, deshalb gebe ich es mit Vorrang an unser Team. Wohin sollen wir antworten?",
    email: "Deine E-Mail", raise: "Ticket öffnen", raising: "Ticket wird geöffnet",
    raised: (ref, emailed) => `Erledigt. Ticket ${ref} ist offen${emailed ? " und wir haben dir eine Kopie gemailt" : ""}. Ein Mensch antwortet bald, meist innerhalb weniger Stunden.`,
    duplicate: (ref) => `Du hast dazu schon Ticket ${ref} offen, ich habe diesen Chat hinzugefügt.`,
    glad: "Freut mich, dass ich helfen konnte! Noch etwas?",
    offline: "Du bist offline. Ich bin da, sobald du wieder verbunden bist.",
    error: "Da ist etwas schiefgelaufen. Versuch es gleich noch einmal.",
    suggestions: ["Wie kündige ich mein Abo?", "Wo finde ich meine Rechnungen?", "Meine Zahlung ist fehlgeschlagen", "Warum ist mein Post fehlgeschlagen?"],
    related: "Passend dazu", faqLink: "Zum Hilfe-Center", lang: "Sprache",
    more: "Das tut mir leid. Kannst du mir etwas mehr erzählen?", nudge: "Fragen? Ich helfe gern.",
  },
  pt: {
    open: "Conversar com o Pip", close: "Fechar chat", title: "Pip da Outlly", status: "Costuma responder na hora",
    hello: "Oi! Eu sou o Pip. Pergunte o que quiser sobre a Outlly: cobrança, publicação, sua conta. Se eu não resolver, chamo uma pessoa.",
    placeholder: "Digite sua pergunta", send: "Enviar", thinking: "Pip está pensando",
    helpful: "Ajudou?", yes: "Sim, obrigado", no: "Não muito", human: "Falar com uma pessoa",
    escalate: "Não consegui resolver, então vou passar para a nossa equipe com prioridade. Para onde respondemos?",
    email: "Seu e-mail", raise: "Abrir chamado", raising: "Abrindo chamado",
    raised: (ref, emailed) => `Pronto. O chamado ${ref} está aberto${emailed ? " e enviamos uma cópia por e-mail" : ""}. Uma pessoa vai responder em breve, normalmente em poucas horas.`,
    duplicate: (ref) => `Você já tem o chamado ${ref} aberto sobre isso, então adicionei esta conversa a ele.`,
    glad: "Que bom que ajudei! Mais alguma coisa?",
    offline: "Você está offline. Estarei aqui quando voltar.",
    error: "Algo deu errado. Tente de novo em instantes.",
    suggestions: ["Como cancelo meu plano?", "Onde estão minhas faturas?", "Meu pagamento falhou", "Por que minha publicação falhou?"],
    related: "Relacionado", faqLink: "Ver a central de ajuda", lang: "Idioma",
    more: "Desculpe. Pode me contar um pouco mais?", nudge: "Dúvidas? Eu ajudo.",
  },
  ar: {
    open: "تحدث مع Pip", close: "إغلاق المحادثة", title: "Pip من Outlly", status: "يرد عادةً فورًا",
    hello: "مرحبًا! أنا Pip. اسألني أي شيء عن Outlly: الفواتير، النشر، حسابك. إذا لم أستطع الحل، سأحوّلك إلى شخص من فريقنا.",
    placeholder: "اكتب سؤالك", send: "إرسال", thinking: "Pip يفكر",
    helpful: "هل ساعدك ذلك؟", yes: "نعم، شكرًا", no: "ليس تمامًا", human: "التحدث مع شخص",
    escalate: "لم أتمكن من حل هذا، لذا سأحوّله إلى فريقنا بأولوية. أين نرسل الرد؟",
    email: "بريدك الإلكتروني", raise: "فتح تذكرة", raising: "جارٍ فتح التذكرة",
    raised: (ref, emailed) => `تم. التذكرة ${ref} مفتوحة${emailed ? " وأرسلنا لك نسخة بالبريد" : ""}. سيرد عليك شخص قريبًا، عادةً خلال ساعات قليلة.`,
    duplicate: (ref) => `لديك بالفعل التذكرة ${ref} مفتوحة بخصوص هذا، فأضفت هذه المحادثة إليها.`,
    glad: "سعيد أنني ساعدت! هل من شيء آخر؟",
    offline: "أنت غير متصل. سأكون هنا عند عودتك.",
    error: "حدث خطأ ما. حاول مرة أخرى بعد قليل.",
    suggestions: ["كيف ألغي اشتراكي؟", "أين فواتيري؟", "فشل الدفع", "لماذا فشل منشوري؟"],
    related: "ذو صلة", faqLink: "تصفح مركز المساعدة", lang: "اللغة",
    more: "آسف لذلك. هل يمكنك إخباري بالمزيد؟", nudge: "لديك سؤال؟ يمكنني المساعدة.",
  },
  zh: {
    open: "和 Pip 聊天", close: "关闭聊天", title: "Outlly 的 Pip", status: "通常即时回复",
    hello: "你好！我是 Pip。关于 Outlly 的任何问题都可以问我：账单、发布、你的账户。如果我解决不了，我会请同事来帮你。",
    placeholder: "输入你的问题", send: "发送", thinking: "Pip 正在思考",
    helpful: "有帮助吗？", yes: "有，谢谢", no: "不太有", human: "联系人工客服",
    escalate: "这个问题我没能解决，我会把它优先转给我们的团队。我们该回复到哪里？",
    email: "你的邮箱", raise: "提交工单", raising: "正在提交工单",
    raised: (ref, emailed) => `好了。工单 ${ref} 已创建${emailed ? "，副本已发送到你的邮箱" : ""}。工作人员很快会回复，通常在几小时内。`,
    duplicate: (ref) => `你已经有关于此问题的工单 ${ref}，我把这段对话加进去了。`,
    glad: "很高兴能帮上忙！还有别的吗？",
    offline: "你已离线。重新连接后我还在这里。",
    error: "出了点问题，请稍后再试。",
    suggestions: ["如何取消我的套餐？", "我的发票在哪里？", "我的付款失败了", "为什么我的帖子发布失败？"],
    related: "相关", faqLink: "浏览帮助中心", lang: "语言",
    more: "抱歉。能再多说一点吗？", nudge: "有问题？我可以帮忙。",
  },
  ja: {
    open: "Pip とチャット", close: "チャットを閉じる", title: "Outlly の Pip", status: "たいていすぐに返信します",
    hello: "こんにちは！Pip です。Outlly のことなら何でも聞いてください。請求、投稿、アカウントなど。解決できないときは担当者につなぎます。",
    placeholder: "質問を入力", send: "送信", thinking: "Pip が考え中",
    helpful: "お役に立てましたか？", yes: "はい、ありがとう", no: "いまひとつ", human: "担当者と話す",
    escalate: "解決できなかったので、優先してチームに引き継ぎます。返信先を教えてください。",
    email: "メールアドレス", raise: "チケットを作成", raising: "チケットを作成中",
    raised: (ref, emailed) => `完了しました。チケット ${ref} を作成しました${emailed ? "。控えをメールでお送りしました" : ""}。通常は数時間以内に担当者が返信します。`,
    duplicate: (ref) => `この件ではすでにチケット ${ref} があるので、このチャットを追加しました。`,
    glad: "お役に立ててうれしいです！ほかに何かありますか？",
    offline: "オフラインです。再接続したらまたお手伝いします。",
    error: "問題が発生しました。少し待ってからもう一度お試しください。",
    suggestions: ["プランを解約するには？", "請求書はどこ？", "支払いに失敗しました", "投稿が失敗したのはなぜ？"],
    related: "関連", faqLink: "ヘルプセンターを見る", lang: "言語",
    more: "すみません。もう少し詳しく教えてもらえますか？", nudge: "質問はありますか？お手伝いします。",
  },
  ru: {
    open: "Чат с Pip", close: "Закрыть чат", title: "Pip из Outlly", status: "Обычно отвечает сразу",
    hello: "Привет! Я Pip. Спрашивайте что угодно об Outlly: оплата, публикации, ваш аккаунт. Если не смогу помочь, позову человека.",
    placeholder: "Введите вопрос", send: "Отправить", thinking: "Pip думает",
    helpful: "Это помогло?", yes: "Да, спасибо", no: "Не совсем", human: "Связаться с человеком",
    escalate: "Я не смог это решить, поэтому передаю вопрос нашей команде в приоритетном порядке. Куда вам ответить?",
    email: "Ваш email", raise: "Создать обращение", raising: "Создаём обращение",
    raised: (ref, emailed) => `Готово. Обращение ${ref} создано${emailed ? ", копия отправлена вам на почту" : ""}. Специалист скоро ответит, обычно в течение нескольких часов.`,
    duplicate: (ref) => `У вас уже есть обращение ${ref} по этому вопросу, я добавил к нему этот чат.`,
    glad: "Рад, что помог! Что-нибудь ещё?",
    offline: "Вы офлайн. Я буду здесь, когда связь вернётся.",
    error: "Что-то пошло не так. Попробуйте чуть позже.",
    suggestions: ["Как отменить подписку?", "Где мои счета?", "Оплата не прошла", "Почему публикация не удалась?"],
    related: "Похожее", faqLink: "Открыть центр помощи", lang: "Язык",
    more: "Извините. Расскажете чуть подробнее?", nudge: "Есть вопросы? Я помогу.",
  },
  id: {
    open: "Chat dengan Pip", close: "Tutup chat", title: "Pip dari Outlly", status: "Biasanya langsung menjawab",
    hello: "Hai! Aku Pip. Tanya apa saja tentang Outlly: tagihan, publikasi, akunmu. Kalau aku tidak bisa membantu, aku panggilkan orang dari tim kami.",
    placeholder: "Ketik pertanyaanmu", send: "Kirim", thinking: "Pip sedang berpikir",
    helpful: "Apakah ini membantu?", yes: "Ya, terima kasih", no: "Kurang", human: "Bicara dengan orang",
    escalate: "Aku belum bisa menyelesaikannya, jadi aku teruskan ke tim kami dengan prioritas. Ke mana kami harus membalas?",
    email: "Email kamu", raise: "Buka tiket", raising: "Membuka tiket",
    raised: (ref, emailed) => `Selesai. Tiket ${ref} sudah dibuka${emailed ? " dan salinannya sudah kami kirim ke email kamu" : ""}. Tim kami akan segera membalas, biasanya dalam beberapa jam.`,
    duplicate: (ref) => `Kamu sudah punya tiket ${ref} untuk hal ini, jadi chat ini aku tambahkan ke sana.`,
    glad: "Senang bisa membantu! Ada lagi?",
    offline: "Kamu sedang offline. Aku akan tetap di sini saat kamu terhubung lagi.",
    error: "Ada kendala. Coba lagi sebentar lagi.",
    suggestions: ["Bagaimana cara membatalkan paket?", "Di mana invoice saya?", "Pembayaran saya gagal", "Kenapa postingan saya gagal?"],
    related: "Terkait", faqLink: "Lihat pusat bantuan", lang: "Bahasa",
    more: "Maaf soal itu. Bisa ceritakan sedikit lagi?", nudge: "Ada pertanyaan? Aku bisa bantu.",
  },
  bn: {
    open: "Pip-এর সাথে চ্যাট", close: "চ্যাট বন্ধ করুন", title: "Outlly-এর Pip", status: "সাধারণত সঙ্গে সঙ্গে উত্তর দেয়",
    hello: "নমস্কার! আমি Pip। Outlly নিয়ে যা খুশি জিজ্ঞেস করুন: বিলিং, পাবলিশিং, আপনার অ্যাকাউন্ট। আমি সমাধান না পারলে একজন মানুষকে ডেকে দেব।",
    placeholder: "আপনার প্রশ্ন লিখুন", send: "পাঠান", thinking: "Pip ভাবছে",
    helpful: "এটা কি কাজে লাগল?", yes: "হ্যাঁ, ধন্যবাদ", no: "তেমন না", human: "একজন মানুষের সাথে কথা বলুন",
    escalate: "আমি এটা সমাধান করতে পারিনি, তাই অগ্রাধিকার দিয়ে আমাদের টিমের কাছে পাঠাচ্ছি। কোথায় উত্তর দেব?",
    email: "আপনার ইমেল", raise: "টিকিট খুলুন", raising: "টিকিট খোলা হচ্ছে",
    raised: (ref, emailed) => `হয়ে গেছে। টিকিট ${ref} খোলা হয়েছে${emailed ? " এবং একটি কপি আপনার ইমেলে পাঠানো হয়েছে" : ""}। শিগগিরই কেউ উত্তর দেবে, সাধারণত কয়েক ঘণ্টার মধ্যে।`,
    duplicate: (ref) => `এ বিষয়ে আপনার টিকিট ${ref} আগেই খোলা আছে, তাই এই চ্যাটটি তাতে যোগ করেছি।`,
    glad: "সাহায্য করতে পেরে ভালো লাগল! আর কিছু?",
    offline: "আপনি অফলাইনে আছেন। আবার যুক্ত হলে আমি এখানেই থাকব।",
    error: "কিছু একটা সমস্যা হয়েছে। একটু পরে আবার চেষ্টা করুন।",
    suggestions: ["আমার প্ল্যান কীভাবে বাতিল করব?", "আমার ইনভয়েস কোথায়?", "আমার পেমেন্ট ব্যর্থ হয়েছে", "আমার পোস্ট কেন ব্যর্থ হল?"],
    related: "সম্পর্কিত", faqLink: "হেল্প সেন্টার দেখুন", lang: "ভাষা",
    more: "দুঃখিত। আরেকটু বিস্তারিত বলবেন?", nudge: "প্রশ্ন আছে? আমি সাহায্য করতে পারি।",
  },
};

type HelpT = { eyebrow: string; title: string; search: string; noMatch: string; all: string; stuck: string; stuckBody: string; ask: string; write: string; name: string; email: string; message: string; submit: string; sent: (r: string) => string };
export const HELP_T: Record<Lang, HelpT> = {
  en: { eyebrow: "Help centre", title: "How can we help?", search: "Search questions", noMatch: "No questions match that yet.", all: "All", stuck: "Still stuck?", stuckBody: "Ask Pip, or write to us and a person will reply by email.", ask: "Ask Pip", write: "Write to us", name: "Name", email: "Email", message: "What's going on?", submit: "Send to support", sent: (r) => `Thanks. Ticket ${r} is open and a copy is in your inbox.` },
  hi: { eyebrow: "हेल्प सेंटर", title: "हम कैसे मदद करें?", search: "सवाल खोजें", noMatch: "इससे मिलता कोई सवाल अभी नहीं है।", all: "सभी", stuck: "अब भी अटके हैं?", stuckBody: "Pip से पूछें, या हमें लिखें, कोई व्यक्ति ईमेल से जवाब देगा।", ask: "Pip से पूछें", write: "हमें लिखें", name: "नाम", email: "ईमेल", message: "क्या समस्या है?", submit: "सपोर्ट को भेजें", sent: (r) => `धन्यवाद। टिकट ${r} खुल गया है और कॉपी आपके ईमेल पर है।` },
  es: { eyebrow: "Centro de ayuda", title: "¿Cómo podemos ayudarte?", search: "Buscar preguntas", noMatch: "Aún no hay preguntas que coincidan.", all: "Todas", stuck: "¿Sigues atascado?", stuckBody: "Pregúntale a Pip o escríbenos y una persona te responderá por correo.", ask: "Preguntar a Pip", write: "Escríbenos", name: "Nombre", email: "Correo", message: "¿Qué está pasando?", submit: "Enviar a soporte", sent: (r) => `Gracias. El ticket ${r} está abierto y tienes una copia en tu correo.` },
  fr: { eyebrow: "Centre d'aide", title: "Comment pouvons-nous aider ?", search: "Rechercher une question", noMatch: "Aucune question ne correspond pour l'instant.", all: "Toutes", stuck: "Toujours bloqué ?", stuckBody: "Demande à Pip, ou écris-nous et une personne te répondra par e-mail.", ask: "Demander à Pip", write: "Nous écrire", name: "Nom", email: "E-mail", message: "Que se passe-t-il ?", submit: "Envoyer au support", sent: (r) => `Merci. Le ticket ${r} est ouvert et une copie est dans ta boîte mail.` },
  de: { eyebrow: "Hilfe-Center", title: "Wie können wir helfen?", search: "Fragen durchsuchen", noMatch: "Dazu passt noch keine Frage.", all: "Alle", stuck: "Kommst du nicht weiter?", stuckBody: "Frag Pip oder schreib uns, ein Mensch antwortet per E-Mail.", ask: "Pip fragen", write: "Schreib uns", name: "Name", email: "E-Mail", message: "Was ist los?", submit: "An den Support senden", sent: (r) => `Danke. Ticket ${r} ist offen, eine Kopie liegt in deinem Postfach.` },
  pt: { eyebrow: "Central de ajuda", title: "Como podemos ajudar?", search: "Buscar perguntas", noMatch: "Nenhuma pergunta corresponde ainda.", all: "Todas", stuck: "Ainda com dúvida?", stuckBody: "Pergunte ao Pip ou escreva para nós e uma pessoa responde por e-mail.", ask: "Perguntar ao Pip", write: "Fale conosco", name: "Nome", email: "E-mail", message: "O que está acontecendo?", submit: "Enviar ao suporte", sent: (r) => `Obrigado. O chamado ${r} está aberto e uma cópia está no seu e-mail.` },
  ar: { eyebrow: "مركز المساعدة", title: "كيف يمكننا المساعدة؟", search: "ابحث في الأسئلة", noMatch: "لا توجد أسئلة مطابقة بعد.", all: "الكل", stuck: "ما زلت عالقًا؟", stuckBody: "اسأل Pip، أو راسلنا وسيرد عليك شخص عبر البريد.", ask: "اسأل Pip", write: "راسلنا", name: "الاسم", email: "البريد الإلكتروني", message: "ما المشكلة؟", submit: "إرسال إلى الدعم", sent: (r) => `شكرًا. التذكرة ${r} مفتوحة ونسخة منها في بريدك.` },
  zh: { eyebrow: "帮助中心", title: "需要什么帮助？", search: "搜索问题", noMatch: "暂时没有匹配的问题。", all: "全部", stuck: "还没解决？", stuckBody: "问问 Pip，或给我们留言，工作人员会通过邮件回复。", ask: "问 Pip", write: "给我们留言", name: "姓名", email: "邮箱", message: "遇到了什么问题？", submit: "发送给客服", sent: (r) => `谢谢。工单 ${r} 已创建，副本已发送到你的邮箱。` },
  ja: { eyebrow: "ヘルプセンター", title: "どのようなご用件ですか？", search: "質問を検索", noMatch: "一致する質問はまだありません。", all: "すべて", stuck: "まだ解決しませんか？", stuckBody: "Pip に聞くか、お問い合わせいただければ担当者がメールで返信します。", ask: "Pip に聞く", write: "お問い合わせ", name: "お名前", email: "メール", message: "どうされましたか？", submit: "サポートに送信", sent: (r) => `ありがとうございます。チケット ${r} を作成し、控えをメールでお送りしました。` },
  ru: { eyebrow: "Центр помощи", title: "Чем помочь?", search: "Поиск по вопросам", noMatch: "Пока нет подходящих вопросов.", all: "Все", stuck: "Всё ещё нужна помощь?", stuckBody: "Спросите Pip или напишите нам, и человек ответит по почте.", ask: "Спросить Pip", write: "Написать нам", name: "Имя", email: "Email", message: "Что случилось?", submit: "Отправить в поддержку", sent: (r) => `Спасибо. Обращение ${r} создано, копия у вас на почте.` },
  id: { eyebrow: "Pusat bantuan", title: "Ada yang bisa kami bantu?", search: "Cari pertanyaan", noMatch: "Belum ada pertanyaan yang cocok.", all: "Semua", stuck: "Masih bingung?", stuckBody: "Tanya Pip, atau tulis ke kami dan tim kami akan membalas lewat email.", ask: "Tanya Pip", write: "Tulis ke kami", name: "Nama", email: "Email", message: "Ada masalah apa?", submit: "Kirim ke dukungan", sent: (r) => `Terima kasih. Tiket ${r} sudah dibuka dan salinannya ada di inbox kamu.` },
  bn: { eyebrow: "হেল্প সেন্টার", title: "কীভাবে সাহায্য করতে পারি?", search: "প্রশ্ন খুঁজুন", noMatch: "এখনও মিলে যাওয়া কোনো প্রশ্ন নেই।", all: "সব", stuck: "এখনও আটকে আছেন?", stuckBody: "Pip-কে জিজ্ঞেস করুন, অথবা আমাদের লিখুন, একজন মানুষ ইমেলে উত্তর দেবে।", ask: "Pip-কে জিজ্ঞেস করুন", write: "আমাদের লিখুন", name: "নাম", email: "ইমেল", message: "কী সমস্যা হচ্ছে?", submit: "সাপোর্টে পাঠান", sent: (r) => `ধন্যবাদ। টিকিট ${r} খোলা হয়েছে এবং একটি কপি আপনার ইনবক্সে আছে।` },
};

/** Saved choice first, then the browser's own languages, then English. */
export function readLang(): Lang {
  if (typeof window === "undefined") return "en";
  const v = localStorage.getItem(LANG_KEY);
  if (isLang(v)) return v;
  for (const l of navigator.languages ?? [navigator.language]) {
    const base = l?.toLowerCase().split("-")[0];
    if (isLang(base)) return base;
  }
  return "en";
}
export function writeLang(l: Lang) {
  localStorage.setItem(LANG_KEY, l);
  window.dispatchEvent(new CustomEvent("outly:lang", { detail: l }));
}
