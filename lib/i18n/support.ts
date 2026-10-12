/** Client-safe UI strings for the chat widget and help centre. Add a language by adding a key. */
export type Lang = "en" | "hi";
export const LANGS: { id: Lang; label: string; short: string }[] = [
  { id: "en", label: "English", short: "EN" },
  { id: "hi", label: "हिन्दी", short: "हि" },
];
export const LANG_KEY = "outly-lang";

export const T = {
  en: {
    open: "Chat with Pip", close: "Close chat", title: "Pip from Outlly", status: "Usually answers instantly",
    hello: "Hi! I'm Pip. Ask me anything about Outlly: billing, publishing, your account. If I can't solve it, I'll get a person.",
    placeholder: "Type your question", send: "Send", thinking: "Pip is thinking",
    helpful: "Did that help?", yes: "Yes, thanks", no: "Not really", human: "Talk to a person",
    escalate: "I couldn't solve this, so I'm handing it to our team and putting it at the front of the queue. Where should we reply?",
    email: "Your email", raise: "Open ticket", raising: "Opening ticket",
    raised: (ref: string, emailed: boolean) => `Done. Ticket ${ref} is open${emailed ? " and we've emailed you a copy" : ""}. A person will reply soon, usually within a few hours.`,
    duplicate: (ref: string) => `You already have ticket ${ref} open about this, so I added this chat to it.`,
    glad: "Glad I could help! Anything else?",
    offline: "You're offline. I'll be here when you reconnect.",
    error: "Something got in the way. Try again in a moment.",
    suggestions: ["How do I cancel my plan?", "Where are my invoices?", "My payment failed", "Why did my post fail?"],
    related: "Related", faqLink: "Browse the help centre",
    lang: "Language",
  },
  hi: {
    open: "Pip से बात करें", close: "चैट बंद करें", title: "Outlly का Pip", status: "आमतौर पर तुरंत जवाब देता है",
    hello: "नमस्ते! मैं Pip हूँ। Outlly के बारे में कुछ भी पूछिए: बिलिंग, पब्लिशिंग, आपका अकाउंट। अगर मैं हल न कर पाऊँ, तो किसी व्यक्ति को बुला दूँगा।",
    placeholder: "अपना सवाल लिखें", send: "भेजें", thinking: "Pip सोच रहा है",
    helpful: "क्या इससे मदद मिली?", yes: "हाँ, धन्यवाद", no: "नहीं", human: "किसी व्यक्ति से बात करें",
    escalate: "मैं इसे हल नहीं कर पाया, इसलिए इसे हमारी टीम को सबसे पहले देखने के लिए भेज रहा हूँ। हम जवाब कहाँ भेजें?",
    email: "आपका ईमेल", raise: "टिकट खोलें", raising: "टिकट खुल रहा है",
    raised: (ref: string, emailed: boolean) => `हो गया। टिकट ${ref} खुल गया है${emailed ? " और इसकी कॉपी आपको ईमेल कर दी गई है" : ""}। जल्द ही कोई व्यक्ति जवाब देगा।`,
    duplicate: (ref: string) => `इस बारे में आपका टिकट ${ref} पहले से खुला है, मैंने यह चैट उसी में जोड़ दी है।`,
    glad: "खुशी हुई कि मदद कर सका! और कुछ?",
    offline: "आप ऑफ़लाइन हैं। दोबारा कनेक्ट होने पर मैं यहीं मिलूँगा।",
    error: "कुछ गड़बड़ हो गई। थोड़ी देर में फिर कोशिश करें।",
    suggestions: ["मैं अपना प्लान कैसे रद्द करूँ?", "मेरे इनवॉइस कहाँ हैं?", "मेरा पेमेंट फेल हो गया", "Why did my post fail?"],
    related: "संबंधित", faqLink: "हेल्प सेंटर देखें",
    lang: "भाषा",
  },
} satisfies Record<Lang, unknown>;

export const HELP_T = {
  en: { eyebrow: "Help centre", title: "How can we help?", search: "Search questions", noMatch: "No questions match that yet.", all: "All", stuck: "Still stuck?", stuckBody: "Ask Pip, or write to us and a person will reply by email.", ask: "Ask Pip", write: "Write to us", name: "Name", email: "Email", message: "What's going on?", submit: "Send to support", sent: (r: string) => `Thanks. Ticket ${r} is open and a copy is in your inbox.` },
  hi: { eyebrow: "हेल्प सेंटर", title: "हम कैसे मदद करें?", search: "सवाल खोजें", noMatch: "इससे मिलता कोई सवाल अभी नहीं है।", all: "सभी", stuck: "अब भी अटके हैं?", stuckBody: "Pip से पूछें, या हमें लिखें, कोई व्यक्ति ईमेल से जवाब देगा।", ask: "Pip से पूछें", write: "हमें लिखें", name: "नाम", email: "ईमेल", message: "क्या समस्या है?", submit: "सपोर्ट को भेजें", sent: (r: string) => `धन्यवाद। टिकट ${r} खुल गया है और कॉपी आपके ईमेल पर है।` },
} satisfies Record<Lang, unknown>;

export function readLang(): Lang {
  if (typeof window === "undefined") return "en";
  const v = localStorage.getItem(LANG_KEY);
  if (v === "en" || v === "hi") return v;
  return navigator.language?.toLowerCase().startsWith("hi") ? "hi" : "en";
}
export function writeLang(l: Lang) {
  localStorage.setItem(LANG_KEY, l);
  window.dispatchEvent(new CustomEvent("outly:lang", { detail: l }));
}
