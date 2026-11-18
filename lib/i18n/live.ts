import type { Lang } from "./support";
import { parseSys, SYS } from "../support/live-core";

/**
 * R1184 Live Assist words in the Pip widget. English is the source (the state lines are the exact wording
 * agreed for the product); every other language is a translation of it. Missing keys fall back to English.
 */
export type LiveT = {
  offer: string;
  connect: string;
  keepPip: string;
  connecting: string;
  waiting: string;
  position: (n: number) => string;
  connected: string;
  unavailable: string;
  reconnecting: string;
  resolved: string;
  cancel: string;
  /** R1194: "Continue waiting" under the queue line. */
  continueWaiting: string;
  /** R1194: Pip's one line when the person asks for a specialist (stored once as the live.requested status line). */
  handoff: string;
  /** R1194: a second ask while already in the queue. Shown once, never stored. */
  already: string;
  /** R1194: "You're now connected with Priya." (the specialist's first name). */
  connectedWith: (name: string) => string;
  leave: string;
  leaving: string;
  left: (ref: string) => string;
  endChat: string;
  pipBack: string;
  cancelled: string;
  customerLeft: string;
  transferred: (name: string) => string;
  reopened: string;
  agentLabel: (name: string) => string;
  saidAgent: string;
  typing: (name: string) => string;
  placeholder: string;
  sending: string;
  sent: string;
  delivered: string;
  seen: string;
  failed: string;
  retry: string;
  helpful: string;
  yes: string;
  no: string;
  thanks: string;
  newChat: string;
  error: string;
  statusWaiting: string;
  statusConnected: string;
  statusUnavailable: string;
  statusReconnecting: string;
  unread: (n: number) => string;
  /** R1205: the queue line while a specialist is online and nobody is ahead (the first minute only). */
  waitingEta: string;
  /** R1205: the honest update once the first minute has passed. */
  waitingLong: string;
  queueConnecting: string;
  queueWaiting: string;
  queueAway: string;
  etaLine: string;
  /** R1205: a specialist came online while the customer was told nobody was available. */
  available: string;
  /** R1205: the live.left status line: the message stays in this chat. */
  leftHere: string;
  leaveHint: string;
  signedOut: string;
  /** R1205: the header, from the server's yes or no (never shown before it answers). */
  humanOnline: string;
  humanAway: string;
  humanLabel: string;
};

const en: LiveT = {
  offer: "I'd like a person to help you with this. Would you like me to connect you with a human support specialist?",
  connect: "Connect to a human",
  keepPip: "Continue with Pip",
  connecting: "Sending your request to our support team...",
  waiting: "You're in the support queue. Your conversation is saved. An Outlly support specialist will join this chat.",
  position: (n) => (n <= 1 ? "You're next in line." : `You're number ${n} in line.`),
  connected: "You're now connected with an Outlly support specialist.",
  unavailable: "No specialist is available right now. Your conversation is saved. Leave a message here and a specialist will reply in this chat.",
  reconnecting: "Connection interrupted. We're trying to reconnect you...",
  resolved: "Your conversation with our support team has been marked as resolved. If you need anything else, you can start another conversation.",
  cancel: "Cancel support request",
  continueWaiting: "Continue waiting",
  handoff: "Connecting you with a support specialist now. You can keep writing here while you wait.",
  already: "You're already in the support queue. A specialist will join this chat as soon as one is available.",
  connectedWith: (n) => `You're now connected with ${n}. They'll assist you here.`,
  leave: "Leave a message",
  leaving: "Saving your message...",
  left: (ref) => `Got it. Your message is saved as ticket ${ref} and we'll follow up by email.`,
  endChat: "End chat",
  pipBack: "Pip is back. Our support team handed this chat back to Pip, so ask away.",
  cancelled: "Request cancelled. Pip is here to help.",
  customerLeft: "You left the chat with our support team. Pip is here to help.",
  transferred: (name) => `${name} from Outlly support has joined the chat.`,
  reopened: "Our support team reopened this conversation.",
  agentLabel: (name) => `${name}, Outlly support`,
  saidAgent: "Support specialist said",
  typing: (name) => `${name} is typing`,
  placeholder: "Message our support team",
  sending: "Sending",
  sent: "Sent",
  delivered: "Delivered",
  seen: "Seen",
  failed: "Not sent",
  retry: "Retry",
  helpful: "Was our support team helpful?",
  yes: "Yes",
  no: "No",
  thanks: "Thanks for telling us.",
  newChat: "Start a new conversation",
  error: "We couldn't reach our support team just now. Try again in a moment.",
  statusWaiting: "In the queue",
  statusConnected: "Support specialist",
  statusUnavailable: "Team unavailable",
  statusReconnecting: "Reconnecting",
  unread: (n) => (n === 1 ? "1 new message from support" : `${n} new messages from support`),
  waitingEta: "You're in the queue. Please wait approximately 1 minute while we connect you to a support specialist.",
  waitingLong: "Still connecting you. It's taking longer than a minute, and your place in the queue is kept.",
  queueConnecting: "Queue status: Connecting to a specialist",
  queueWaiting: "Queue status: Waiting for a specialist",
  queueAway: "Queue status: No specialist available right now",
  etaLine: "Estimated wait: Approximately 1 minute",
  available: "A support specialist is online now, and you're still in the queue.",
  leftHere: "Your message is saved in this chat. A specialist will reply here as soon as one is available.",
  leaveHint: "Write your message below and send it. A specialist will reply in this chat.",
  signedOut: "You're signed out. Sign in again to talk to our support team here.",
  humanOnline: "Human support · Online",
  humanAway: "Human support · Away",
  humanLabel: "Human support",
};

const hi: Partial<LiveT> = {
  offer: "मैं चाहूँगा कि इसमें कोई इंसानी विशेषज्ञ आपकी मदद करे। क्या मैं आपको हमारी सपोर्ट टीम से जोड़ दूँ?",
  connect: "किसी इंसान से जुड़ें",
  keepPip: "Pip के साथ जारी रखें",
  connecting: "आपका अनुरोध हमारी सपोर्ट टीम को भेजा जा रहा है...",
  waiting: "आप सपोर्ट कतार में हैं। आपकी बातचीत सहेज ली गई है। Outlly का सपोर्ट विशेषज्ञ इस चैट में जुड़ेगा।",
  position: (n) => (n <= 1 ? "अगली बारी आपकी है।" : `कतार में आपका नंबर ${n} है।`),
  connected: "अब आप Outlly सपोर्ट विशेषज्ञ से जुड़ गए हैं।",
  unavailable: "अभी कोई विशेषज्ञ उपलब्ध नहीं है। आपकी बातचीत सहेज ली गई है। यहीं संदेश छोड़ें, विशेषज्ञ इसी चैट में जवाब देंगे।",
  reconnecting: "कनेक्शन टूट गया। हम आपको फिर से जोड़ने की कोशिश कर रहे हैं...",
  resolved: "हमारी सपोर्ट टीम के साथ आपकी बातचीत हल के रूप में चिह्नित कर दी गई है। कुछ और चाहिए तो आप नई बातचीत शुरू कर सकते हैं।",
  cancel: "सपोर्ट अनुरोध रद्द करें",
  continueWaiting: "इंतज़ार जारी रखें",
  handoff: "मैं आपको अभी सपोर्ट विशेषज्ञ से जोड़ रहा हूँ। इंतज़ार के दौरान आप यहीं लिखते रह सकते हैं।",
  already: "आप पहले से सपोर्ट कतार में हैं। जैसे ही कोई विशेषज्ञ उपलब्ध होगा, वह इस चैट में जुड़ जाएगा।",
  connectedWith: (n) => `अब आप ${n} से जुड़ गए हैं। वे यहीं आपकी मदद करेंगे।`,
  leave: "संदेश छोड़ें",
  leaving: "आपका संदेश सहेजा जा रहा है...",
  left: (ref) => `ठीक है। आपका संदेश टिकट ${ref} के रूप में सहेज लिया गया है, हम ईमेल से संपर्क करेंगे।`,
  endChat: "चैट खत्म करें",
  pipBack: "Pip वापस आ गया है। हमारी सपोर्ट टीम ने यह चैट Pip को लौटा दी है, बेझिझक पूछें।",
  cancelled: "अनुरोध रद्द हो गया। Pip मदद के लिए यहाँ है।",
  customerLeft: "आपने सपोर्ट टीम के साथ चैट छोड़ दी। Pip मदद के लिए यहाँ है।",
  transferred: (name) => `Outlly सपोर्ट से ${name} चैट में जुड़ गए हैं।`,
  reopened: "हमारी सपोर्ट टीम ने यह बातचीत फिर से खोल दी है।",
  agentLabel: (name) => `${name}, Outlly सपोर्ट`,
  saidAgent: "सपोर्ट विशेषज्ञ ने कहा",
  typing: (name) => `${name} लिख रहे हैं`,
  placeholder: "हमारी सपोर्ट टीम को संदेश लिखें",
  sending: "भेजा जा रहा है", sent: "भेजा गया", delivered: "पहुँच गया", seen: "देखा गया", failed: "नहीं भेजा गया", retry: "फिर से कोशिश करें",
  helpful: "क्या हमारी सपोर्ट टीम मददगार थी?", yes: "हाँ", no: "नहीं", thanks: "बताने के लिए धन्यवाद।",
  newChat: "नई बातचीत शुरू करें",
  error: "अभी हम सपोर्ट टीम तक नहीं पहुँच पाए। थोड़ी देर में फिर कोशिश करें।",
  statusWaiting: "कतार में", statusConnected: "सपोर्ट विशेषज्ञ", statusUnavailable: "टीम उपलब्ध नहीं", statusReconnecting: "फिर से जोड़ रहे हैं",
  unread: (n) => `सपोर्ट से ${n} नए संदेश`,
  waitingEta: "आप कतार में हैं। कृपया लगभग 1 मिनट प्रतीक्षा करें, हम आपको सपोर्ट विशेषज्ञ से जोड़ रहे हैं।",
  waitingLong: "हम अभी भी आपको जोड़ रहे हैं। इसमें एक मिनट से ज़्यादा लग रहा है, कतार में आपकी जगह बनी हुई है।",
  queueConnecting: "कतार की स्थिति: विशेषज्ञ से जोड़ा जा रहा है",
  queueWaiting: "कतार की स्थिति: विशेषज्ञ का इंतज़ार",
  queueAway: "कतार की स्थिति: अभी कोई विशेषज्ञ उपलब्ध नहीं",
  etaLine: "अनुमानित प्रतीक्षा: लगभग 1 मिनट",
  available: "एक सपोर्ट विशेषज्ञ अभी ऑनलाइन है, और आप अभी भी कतार में हैं।",
  leftHere: "आपका संदेश इस चैट में सहेज लिया गया है। विशेषज्ञ उपलब्ध होते ही यहीं जवाब देंगे।",
  leaveHint: "नीचे अपना संदेश लिखकर भेजें। विशेषज्ञ इसी चैट में जवाब देंगे।",
  signedOut: "आप साइन आउट हो गए हैं। हमारी सपोर्ट टीम से यहाँ बात करने के लिए फिर से साइन इन करें।",
  humanOnline: "ह्यूमन सपोर्ट · ऑनलाइन",
  humanAway: "ह्यूमन सपोर्ट · अभी उपलब्ध नहीं",
  humanLabel: "ह्यूमन सपोर्ट",
};

const es: Partial<LiveT> = {
  offer: "Me gustaría que una persona experta te ayude con esto. ¿Quieres que te conecte con nuestro equipo de soporte?",
  connect: "Hablar con una persona",
  keepPip: "Seguir con Pip",
  connecting: "Enviando tu solicitud a nuestro equipo de soporte...",
  waiting: "Estás en la cola de soporte. Tu conversación está guardada. Un especialista de soporte de Outlly se unirá a este chat.",
  position: (n) => (n <= 1 ? "Eres el siguiente." : `Eres el número ${n} en la cola.`),
  connected: "Ya estás conectado con un especialista de soporte de Outlly.",
  unavailable: "Ahora mismo no hay ningún especialista disponible. Tu conversación está guardada. Deja un mensaje aquí y un especialista te responderá en este chat.",
  reconnecting: "Se interrumpió la conexión. Estamos intentando reconectarte...",
  resolved: "Tu conversación con nuestro equipo de soporte se marcó como resuelta. Si necesitas algo más, puedes iniciar otra conversación.",
  cancel: "Cancelar solicitud de soporte",
  continueWaiting: "Seguir esperando",
  handoff: "Te estoy conectando con un especialista de soporte. Puedes seguir escribiendo aquí mientras esperas.",
  already: "Ya estás en la cola de soporte. Un especialista se unirá a este chat en cuanto haya uno disponible.",
  connectedWith: (n) => `Ya estás conectado con ${n}. Te ayudará aquí mismo.`,
  leave: "Dejar un mensaje",
  leaving: "Guardando tu mensaje...",
  left: (ref) => `Listo. Tu mensaje quedó guardado como el ticket ${ref} y te responderemos por correo.`,
  endChat: "Terminar chat",
  pipBack: "Pip ha vuelto. Nuestro equipo de soporte le devolvió este chat a Pip, así que pregunta lo que quieras.",
  cancelled: "Solicitud cancelada. Pip está aquí para ayudarte.",
  customerLeft: "Saliste del chat con nuestro equipo de soporte. Pip está aquí para ayudarte.",
  transferred: (name) => `${name}, de soporte de Outlly, se unió al chat.`,
  reopened: "Nuestro equipo de soporte reabrió esta conversación.",
  agentLabel: (name) => `${name}, soporte de Outlly`,
  saidAgent: "El especialista de soporte dijo",
  typing: (name) => `${name} está escribiendo`,
  placeholder: "Escribe a nuestro equipo de soporte",
  sending: "Enviando", sent: "Enviado", delivered: "Entregado", seen: "Visto", failed: "No enviado", retry: "Reintentar",
  helpful: "¿Te ayudó nuestro equipo de soporte?", yes: "Sí", no: "No", thanks: "Gracias por contárnoslo.",
  newChat: "Iniciar otra conversación",
  error: "No pudimos contactar a nuestro equipo de soporte ahora. Inténtalo de nuevo en un momento.",
  statusWaiting: "En la cola", statusConnected: "Especialista de soporte", statusUnavailable: "Equipo no disponible", statusReconnecting: "Reconectando",
  unread: (n) => (n === 1 ? "1 mensaje nuevo de soporte" : `${n} mensajes nuevos de soporte`),
  waitingEta: "Estás en la cola. Espera aproximadamente 1 minuto mientras te conectamos con un especialista de soporte.",
  waitingLong: "Seguimos conectándote. Está tardando más de un minuto, pero conservas tu lugar en la cola.",
  queueConnecting: "Estado de la cola: conectando con un especialista",
  queueWaiting: "Estado de la cola: esperando a un especialista",
  queueAway: "Estado de la cola: ningún especialista disponible ahora",
  etaLine: "Espera estimada: aproximadamente 1 minuto",
  available: "Ya hay un especialista de soporte en línea y sigues en la cola.",
  leftHere: "Tu mensaje está guardado en este chat. Un especialista te responderá aquí en cuanto esté disponible.",
  leaveHint: "Escribe tu mensaje abajo y envíalo. Un especialista te responderá en este chat.",
  signedOut: "Se cerró tu sesión. Inicia sesión de nuevo para hablar aquí con nuestro equipo de soporte.",
  humanOnline: "Soporte humano · En línea",
  humanAway: "Soporte humano · No disponible",
  humanLabel: "Soporte humano",
};

const fr: Partial<LiveT> = {
  offer: "J'aimerais qu'un expert vous aide sur ce point. Voulez-vous que je vous mette en contact avec notre équipe d'assistance ?",
  connect: "Parler à une personne",
  keepPip: "Continuer avec Pip",
  connecting: "Envoi de ta demande à notre équipe d'assistance...",
  waiting: "Tu es dans la file d'attente de l'assistance. Ta conversation est enregistrée. Un spécialiste de l'assistance Outlly rejoindra ce chat.",
  position: (n) => (n <= 1 ? "Vous êtes le prochain." : `Vous êtes numéro ${n} dans la file.`),
  connected: "Vous êtes maintenant en contact avec un spécialiste de l'assistance Outlly.",
  unavailable: "Aucun spécialiste n'est disponible pour le moment. Ta conversation est enregistrée. Laisse un message ici et un spécialiste te répondra dans ce chat.",
  reconnecting: "Connexion interrompue. Nous essayons de vous reconnecter...",
  resolved: "Votre conversation avec notre équipe d'assistance a été marquée comme résolue. Si vous avez besoin d'autre chose, vous pouvez démarrer une nouvelle conversation.",
  cancel: "Annuler la demande d'assistance",
  continueWaiting: "Continuer d'attendre",
  handoff: "Je te mets en relation avec un spécialiste de l'assistance. Tu peux continuer à écrire ici pendant l'attente.",
  already: "Tu es déjà dans la file d'attente. Un spécialiste rejoindra ce chat dès qu'il sera disponible.",
  connectedWith: (n) => `Tu es maintenant en relation avec ${n}, qui va t'aider ici.`,
  leave: "Laisser un message",
  leaving: "Enregistrement de votre message...",
  left: (ref) => `C'est noté. Votre message est enregistré sous le ticket ${ref} et nous vous répondrons par e-mail.`,
  endChat: "Terminer le chat",
  pipBack: "Pip est de retour. Notre équipe d'assistance a rendu ce chat à Pip, posez vos questions.",
  cancelled: "Demande annulée. Pip est là pour vous aider.",
  customerLeft: "Vous avez quitté le chat avec notre équipe d'assistance. Pip est là pour vous aider.",
  transferred: (name) => `${name}, de l'assistance Outlly, a rejoint le chat.`,
  reopened: "Notre équipe d'assistance a rouvert cette conversation.",
  agentLabel: (name) => `${name}, assistance Outlly`,
  saidAgent: "Le spécialiste de l'assistance a dit",
  typing: (name) => `${name} écrit`,
  placeholder: "Écrire à notre équipe d'assistance",
  sending: "Envoi", sent: "Envoyé", delivered: "Distribué", seen: "Vu", failed: "Non envoyé", retry: "Réessayer",
  helpful: "Notre équipe d'assistance vous a-t-elle aidé ?", yes: "Oui", no: "Non", thanks: "Merci pour votre retour.",
  newChat: "Démarrer une nouvelle conversation",
  error: "Impossible de joindre notre équipe d'assistance pour le moment. Réessayez dans un instant.",
  statusWaiting: "Dans la file", statusConnected: "Spécialiste de l'assistance", statusUnavailable: "Équipe indisponible", statusReconnecting: "Reconnexion",
  unread: (n) => (n === 1 ? "1 nouveau message de l'assistance" : `${n} nouveaux messages de l'assistance`),
  waitingEta: "Tu es dans la file d'attente. Patiente environ 1 minute pendant que nous te mettons en relation avec un spécialiste de l'assistance.",
  waitingLong: "Nous essayons toujours de te mettre en relation. Cela prend plus d'une minute, et tu gardes ta place dans la file.",
  queueConnecting: "État de la file : mise en relation avec un spécialiste",
  queueWaiting: "État de la file : en attente d'un spécialiste",
  queueAway: "État de la file : aucun spécialiste disponible pour le moment",
  etaLine: "Attente estimée : environ 1 minute",
  available: "Un spécialiste de l'assistance est en ligne, et tu es toujours dans la file.",
  leftHere: "Ton message est enregistré dans ce chat. Un spécialiste te répondra ici dès qu'il sera disponible.",
  leaveHint: "Écris ton message ci-dessous et envoie-le. Un spécialiste te répondra dans ce chat.",
  signedOut: "Tu es déconnecté. Reconnecte-toi pour parler ici à notre équipe d'assistance.",
  humanOnline: "Assistance humaine · En ligne",
  humanAway: "Assistance humaine · Indisponible",
  humanLabel: "Assistance humaine",
};

const de: Partial<LiveT> = {
  offer: "Ich würde dir dafür gern eine echte Fachperson holen. Soll ich dich mit unserem Support-Team verbinden?",
  connect: "Mit einem Menschen verbinden",
  keepPip: "Mit Pip weitermachen",
  connecting: "Deine Anfrage wird an unser Support-Team gesendet...",
  waiting: "Du bist in der Support-Warteschlange. Deine Unterhaltung ist gespeichert. Eine Fachperson aus dem Outlly-Support kommt in diesen Chat.",
  position: (n) => (n <= 1 ? "Du bist als Nächstes dran." : `Du bist Nummer ${n} in der Warteschlange.`),
  connected: "Du bist jetzt mit einer Outlly Support-Fachkraft verbunden.",
  unavailable: "Gerade ist keine Fachperson verfügbar. Deine Unterhaltung ist gespeichert. Hinterlass hier eine Nachricht, dann antwortet dir eine Fachperson in diesem Chat.",
  reconnecting: "Verbindung unterbrochen. Wir versuchen, dich wieder zu verbinden...",
  resolved: "Deine Unterhaltung mit unserem Support-Team wurde als gelöst markiert. Wenn du noch etwas brauchst, kannst du eine neue Unterhaltung starten.",
  cancel: "Support-Anfrage abbrechen",
  continueWaiting: "Weiter warten",
  handoff: "Ich verbinde dich jetzt mit einer Fachperson aus dem Support. Du kannst hier weiterschreiben, während du wartest.",
  already: "Du bist bereits in der Support-Warteschlange. Eine Fachperson kommt in diesen Chat, sobald jemand frei ist.",
  connectedWith: (n) => `Du bist jetzt mit ${n} verbunden. ${n} hilft dir hier weiter.`,
  leave: "Nachricht hinterlassen",
  leaving: "Deine Nachricht wird gespeichert...",
  left: (ref) => `Erledigt. Deine Nachricht ist als Ticket ${ref} gespeichert und wir melden uns per E-Mail.`,
  endChat: "Chat beenden",
  pipBack: "Pip ist zurück. Unser Support-Team hat den Chat an Pip zurückgegeben, frag einfach weiter.",
  cancelled: "Anfrage abgebrochen. Pip hilft dir gern weiter.",
  customerLeft: "Du hast den Chat mit unserem Support-Team verlassen. Pip hilft dir gern weiter.",
  transferred: (name) => `${name} vom Outlly Support ist dem Chat beigetreten.`,
  reopened: "Unser Support-Team hat diese Unterhaltung wieder geöffnet.",
  agentLabel: (name) => `${name}, Outlly Support`,
  saidAgent: "Die Support-Fachkraft schrieb",
  typing: (name) => `${name} schreibt`,
  placeholder: "Nachricht an unser Support-Team",
  sending: "Wird gesendet", sent: "Gesendet", delivered: "Zugestellt", seen: "Gelesen", failed: "Nicht gesendet", retry: "Erneut versuchen",
  helpful: "Hat dir unser Support-Team geholfen?", yes: "Ja", no: "Nein", thanks: "Danke für deine Rückmeldung.",
  newChat: "Neue Unterhaltung starten",
  error: "Wir konnten unser Support-Team gerade nicht erreichen. Versuch es gleich noch einmal.",
  statusWaiting: "In der Warteschlange", statusConnected: "Support-Fachkraft", statusUnavailable: "Team nicht erreichbar", statusReconnecting: "Verbindet neu",
  unread: (n) => (n === 1 ? "1 neue Nachricht vom Support" : `${n} neue Nachrichten vom Support`),
  waitingEta: "Du bist in der Warteschlange. Bitte warte etwa 1 Minute, während wir dich mit einer Fachperson aus dem Support verbinden.",
  waitingLong: "Wir verbinden dich noch. Es dauert länger als eine Minute, dein Platz in der Warteschlange bleibt erhalten.",
  queueConnecting: "Warteschlange: Verbindung mit einer Fachperson",
  queueWaiting: "Warteschlange: Warten auf eine Fachperson",
  queueAway: "Warteschlange: Gerade keine Fachperson verfügbar",
  etaLine: "Geschätzte Wartezeit: etwa 1 Minute",
  available: "Eine Fachperson aus dem Support ist jetzt online, und du bist weiter in der Warteschlange.",
  leftHere: "Deine Nachricht ist in diesem Chat gespeichert. Eine Fachperson antwortet dir hier, sobald jemand verfügbar ist.",
  leaveHint: "Schreib unten deine Nachricht und sende sie ab. Eine Fachperson antwortet dir in diesem Chat.",
  signedOut: "Du wurdest abgemeldet. Melde dich wieder an, um hier mit unserem Support-Team zu sprechen.",
  humanOnline: "Persönlicher Support · Online",
  humanAway: "Persönlicher Support · Nicht verfügbar",
  humanLabel: "Persönlicher Support",
};

const pt: Partial<LiveT> = {
  offer: "Gostaria que um especialista humano te ajudasse com isso. Quer que eu te conecte com nossa equipe de suporte?",
  connect: "Falar com uma pessoa",
  keepPip: "Continuar com o Pip",
  connecting: "Enviando seu pedido para a nossa equipe de suporte...",
  waiting: "Você está na fila do suporte. Sua conversa está salva. Um especialista do suporte da Outlly vai entrar neste chat.",
  position: (n) => (n <= 1 ? "Você é o próximo da fila." : `Você é o número ${n} da fila.`),
  connected: "Agora você está conectado a um especialista de suporte da Outlly.",
  unavailable: "Nenhum especialista está disponível agora. Sua conversa está salva. Deixe uma mensagem aqui e um especialista responderá neste chat.",
  reconnecting: "Conexão interrompida. Estamos tentando reconectar você...",
  resolved: "Sua conversa com nossa equipe de suporte foi marcada como resolvida. Se precisar de mais alguma coisa, pode iniciar outra conversa.",
  cancel: "Cancelar pedido de suporte",
  continueWaiting: "Continuar esperando",
  handoff: "Estou conectando você com um especialista de suporte. Você pode continuar escrevendo aqui enquanto espera.",
  already: "Você já está na fila do suporte. Um especialista vai entrar neste chat assim que houver alguém disponível.",
  connectedWith: (n) => `Agora você está conectado com ${n}, que vai ajudar você aqui.`,
  leave: "Deixar uma mensagem",
  leaving: "Salvando sua mensagem...",
  left: (ref) => `Pronto. Sua mensagem foi salva como o ticket ${ref} e responderemos por e-mail.`,
  endChat: "Encerrar chat",
  pipBack: "O Pip voltou. Nossa equipe de suporte devolveu este chat ao Pip, pode perguntar.",
  cancelled: "Pedido cancelado. O Pip está aqui para ajudar.",
  customerLeft: "Você saiu do chat com nossa equipe de suporte. O Pip está aqui para ajudar.",
  transferred: (name) => `${name}, do suporte da Outlly, entrou no chat.`,
  reopened: "Nossa equipe de suporte reabriu esta conversa.",
  agentLabel: (name) => `${name}, suporte da Outlly`,
  saidAgent: "O especialista de suporte disse",
  typing: (name) => `${name} está digitando`,
  placeholder: "Escreva para nossa equipe de suporte",
  sending: "Enviando", sent: "Enviada", delivered: "Entregue", seen: "Vista", failed: "Não enviada", retry: "Tentar de novo",
  helpful: "Nossa equipe de suporte ajudou?", yes: "Sim", no: "Não", thanks: "Obrigado por nos contar.",
  newChat: "Iniciar outra conversa",
  error: "Não conseguimos falar com nossa equipe de suporte agora. Tente de novo em instantes.",
  statusWaiting: "Na fila", statusConnected: "Especialista de suporte", statusUnavailable: "Equipe indisponível", statusReconnecting: "Reconectando",
  unread: (n) => (n === 1 ? "1 nova mensagem do suporte" : `${n} novas mensagens do suporte`),
  waitingEta: "Você está na fila. Aguarde aproximadamente 1 minuto enquanto conectamos você com um especialista de suporte.",
  waitingLong: "Ainda estamos conectando você. Está levando mais de um minuto, e seu lugar na fila está garantido.",
  queueConnecting: "Status da fila: conectando com um especialista",
  queueWaiting: "Status da fila: aguardando um especialista",
  queueAway: "Status da fila: nenhum especialista disponível agora",
  etaLine: "Espera estimada: aproximadamente 1 minuto",
  available: "Um especialista de suporte está online agora, e você continua na fila.",
  leftHere: "Sua mensagem está salva neste chat. Um especialista responderá aqui assim que estiver disponível.",
  leaveHint: "Escreva sua mensagem abaixo e envie. Um especialista responderá neste chat.",
  signedOut: "Você saiu da sua conta. Entre de novo para falar aqui com nossa equipe de suporte.",
  humanOnline: "Suporte humano · Online",
  humanAway: "Suporte humano · Indisponível",
  humanLabel: "Suporte humano",
};

const ar: Partial<LiveT> = {
  offer: "أود أن يساعدك خبير بشري في هذا. هل تريد أن أوصلك بفريق الدعم لدينا؟",
  connect: "التحدث مع شخص",
  keepPip: "المتابعة مع Pip",
  connecting: "جارٍ إرسال طلبك إلى فريق الدعم...",
  waiting: "أنت في قائمة انتظار الدعم. محادثتك محفوظة. سينضم متخصص دعم من Outlly إلى هذه المحادثة.",
  position: (n) => (n <= 1 ? "أنت التالي في الدور." : `ترتيبك في قائمة الانتظار هو ${n}.`),
  connected: "أنت الآن متصل بأحد مختصي الدعم في Outlly.",
  unavailable: "لا يوجد متخصص متاح الآن. محادثتك محفوظة. اترك رسالة هنا وسيرد عليك أحد المتخصصين في هذه المحادثة.",
  reconnecting: "انقطع الاتصال. نحاول إعادة توصيلك...",
  resolved: "تم وضع علامة \"تم الحل\" على محادثتك مع فريق الدعم. إذا احتجت إلى أي شيء آخر، يمكنك بدء محادثة جديدة.",
  cancel: "إلغاء طلب الدعم",
  continueWaiting: "متابعة الانتظار",
  handoff: "أقوم الآن بتوصيلك بمتخصص دعم. يمكنك متابعة الكتابة هنا أثناء الانتظار.",
  already: "أنت بالفعل في قائمة انتظار الدعم. سينضم متخصص إلى هذه المحادثة بمجرد أن يتوفر أحد.",
  connectedWith: (n) => `أنت الآن على تواصل مع ${n}، وسيساعدك هنا.`,
  leave: "ترك رسالة",
  leaving: "جارٍ حفظ رسالتك...",
  left: (ref) => `تم. حُفظت رسالتك كتذكرة ${ref} وسنتواصل معك عبر البريد الإلكتروني.`,
  endChat: "إنهاء المحادثة",
  pipBack: "عاد Pip. أعاد فريق الدعم هذه المحادثة إلى Pip، اسأل ما تشاء.",
  cancelled: "أُلغي الطلب. Pip هنا للمساعدة.",
  customerLeft: "غادرت المحادثة مع فريق الدعم. Pip هنا للمساعدة.",
  transferred: (name) => `انضم ${name} من دعم Outlly إلى المحادثة.`,
  reopened: "أعاد فريق الدعم فتح هذه المحادثة.",
  agentLabel: (name) => `${name}، دعم Outlly`,
  saidAgent: "قال مختص الدعم",
  typing: (name) => `${name} يكتب`,
  placeholder: "اكتب رسالة إلى فريق الدعم",
  sending: "جارٍ الإرسال", sent: "أُرسلت", delivered: "وصلت", seen: "قُرئت", failed: "لم تُرسل", retry: "إعادة المحاولة",
  helpful: "هل كان فريق الدعم مفيدًا؟", yes: "نعم", no: "لا", thanks: "شكرًا لإخبارنا.",
  newChat: "بدء محادثة جديدة",
  error: "تعذّر الوصول إلى فريق الدعم الآن. حاول مرة أخرى بعد قليل.",
  statusWaiting: "في قائمة الانتظار", statusConnected: "مختص الدعم", statusUnavailable: "الفريق غير متاح", statusReconnecting: "جارٍ إعادة الاتصال",
  unread: (n) => `${n} رسائل جديدة من الدعم`,
  waitingEta: "أنت في قائمة الانتظار. يُرجى الانتظار دقيقة واحدة تقريبًا بينما نوصلك بمتخصص دعم.",
  waitingLong: "ما زلنا نحاول توصيلك. يستغرق الأمر أكثر من دقيقة، ومكانك في قائمة الانتظار محفوظ.",
  queueConnecting: "حالة قائمة الانتظار: جارٍ التوصيل بمتخصص",
  queueWaiting: "حالة قائمة الانتظار: في انتظار متخصص",
  queueAway: "حالة قائمة الانتظار: لا يوجد متخصص متاح الآن",
  etaLine: "مدة الانتظار المتوقعة: دقيقة واحدة تقريبًا",
  available: "أحد متخصصي الدعم متصل الآن، وما زلت في قائمة الانتظار.",
  leftHere: "رسالتك محفوظة في هذه المحادثة. سيرد عليك متخصص هنا فور توفره.",
  leaveHint: "اكتب رسالتك في الأسفل وأرسلها. سيرد عليك متخصص في هذه المحادثة.",
  signedOut: "تم تسجيل خروجك. سجّل الدخول مرة أخرى للتحدث مع فريق الدعم هنا.",
  humanOnline: "الدعم البشري · متصل",
  humanAway: "الدعم البشري · غير متاح",
  humanLabel: "الدعم البشري",
};

const zh: Partial<LiveT> = {
  offer: "我想请一位人工专家来帮你处理这个问题。要我为你联系我们的支持团队吗？",
  connect: "联系人工客服",
  keepPip: "继续使用 Pip",
  connecting: "正在把你的请求发送给支持团队...",
  waiting: "你已在支持队列中。对话已保存。Outlly 支持专员将加入这个对话。",
  position: (n) => (n <= 1 ? "下一个就是你。" : `你排在第 ${n} 位。`),
  connected: "你已接通 Outlly 支持专员。",
  unavailable: "目前没有可用的专员。你的对话已保存。请在这里留言，专员会在这个对话里回复你。",
  reconnecting: "连接中断，正在尝试重新连接...",
  resolved: "你与我们支持团队的对话已标记为已解决。如果还需要帮助，可以开始新的对话。",
  cancel: "取消支持请求",
  continueWaiting: "继续等待",
  handoff: "正在为你接通支持专员。等待期间，你可以继续在这里输入。",
  already: "你已经在支持队列中了。一有专员有空，就会加入这个对话。",
  connectedWith: (n) => `你已接通 ${n}，对方会在这里为你提供帮助。`,
  leave: "留言",
  leaving: "正在保存你的留言...",
  left: (ref) => `收到。你的留言已保存为工单 ${ref}，我们会通过邮件跟进。`,
  endChat: "结束对话",
  pipBack: "Pip 回来了。支持团队已将此对话交还给 Pip，请随时提问。",
  cancelled: "请求已取消。Pip 会继续为你服务。",
  customerLeft: "你已离开与支持团队的对话。Pip 会继续为你服务。",
  transferred: (name) => `Outlly 支持的 ${name} 已加入对话。`,
  reopened: "我们的支持团队已重新打开此对话。",
  agentLabel: (name) => `${name}，Outlly 支持`,
  saidAgent: "支持专员说",
  typing: (name) => `${name} 正在输入`,
  placeholder: "给支持团队发消息",
  sending: "发送中", sent: "已发送", delivered: "已送达", seen: "已读", failed: "未发送", retry: "重试",
  helpful: "我们的支持团队有帮助吗？", yes: "有", no: "没有", thanks: "感谢你的反馈。",
  newChat: "开始新的对话",
  error: "暂时无法联系支持团队，请稍后再试。",
  statusWaiting: "排队中", statusConnected: "支持专员", statusUnavailable: "团队暂不可用", statusReconnecting: "正在重新连接",
  unread: (n) => `${n} 条来自支持团队的新消息`,
  waitingEta: "你已进入排队。请等待约 1 分钟，我们正在为你接通支持专员。",
  waitingLong: "仍在为你接通。已超过一分钟，你在队列中的位置会保留。",
  queueConnecting: "排队状态：正在接通专员",
  queueWaiting: "排队状态：等待专员",
  queueAway: "排队状态：目前没有可用的专员",
  etaLine: "预计等待：约 1 分钟",
  available: "现在有支持专员在线，你仍在队列中。",
  leftHere: "你的留言已保存在这个对话中。专员有空后会在这里回复你。",
  leaveHint: "请在下方输入留言并发送。专员会在这个对话里回复你。",
  signedOut: "你已退出登录。请重新登录，在这里与我们的支持团队交流。",
  humanOnline: "人工支持 · 在线",
  humanAway: "人工支持 · 暂不可用",
  humanLabel: "人工支持",
};

const ja: Partial<LiveT> = {
  offer: "この件は担当者がお手伝いするのがよさそうです。サポートチームにおつなぎしましょうか？",
  connect: "担当者につなぐ",
  keepPip: "Pip で続ける",
  connecting: "サポートチームにリクエストを送信しています...",
  waiting: "サポートの待機列に入っています。会話は保存されています。Outlly のサポート担当者がこのチャットに参加します。",
  position: (n) => (n <= 1 ? "次はあなたの番です。" : `あなたは ${n} 番目です。`),
  connected: "Outlly のサポート担当者につながりました。",
  unavailable: "現在対応できる担当者がいません。会話は保存されています。ここにメッセージを残していただければ、担当者がこのチャットで返信します。",
  reconnecting: "接続が切れました。再接続しています...",
  resolved: "サポートチームとの会話は解決済みになりました。ほかにご用件があれば、新しい会話を始めてください。",
  cancel: "サポートリクエストを取り消す",
  continueWaiting: "待ち続ける",
  handoff: "サポート担当者におつなぎしています。お待ちの間も、ここで続けて入力できます。",
  already: "すでにサポートの待機列に入っています。担当者の手が空き次第、このチャットに参加します。",
  connectedWith: (n) => `${n} におつなぎしました。このチャットでサポートします。`,
  leave: "メッセージを残す",
  leaving: "メッセージを保存しています...",
  left: (ref) => `承りました。メッセージはチケット ${ref} として保存されました。メールでご連絡します。`,
  endChat: "チャットを終了",
  pipBack: "Pip が戻りました。サポートチームがこのチャットを Pip に戻しました。何でも聞いてください。",
  cancelled: "リクエストを取り消しました。Pip がお手伝いします。",
  customerLeft: "サポートチームとのチャットを終了しました。Pip がお手伝いします。",
  transferred: (name) => `Outlly サポートの ${name} がチャットに参加しました。`,
  reopened: "サポートチームがこの会話を再開しました。",
  agentLabel: (name) => `${name}（Outlly サポート）`,
  saidAgent: "サポート担当者のメッセージ",
  typing: (name) => `${name} が入力中`,
  placeholder: "サポートチームにメッセージ",
  sending: "送信中", sent: "送信済み", delivered: "配信済み", seen: "既読", failed: "未送信", retry: "再試行",
  helpful: "サポートチームはお役に立てましたか？", yes: "はい", no: "いいえ", thanks: "ご回答ありがとうございます。",
  newChat: "新しい会話を始める",
  error: "現在サポートチームに接続できません。しばらくしてからもう一度お試しください。",
  statusWaiting: "順番待ち", statusConnected: "サポート担当者", statusUnavailable: "対応できません", statusReconnecting: "再接続中",
  unread: (n) => `サポートから新着メッセージ ${n} 件`,
  waitingEta: "順番待ちに入りました。サポート担当者におつなぎするまで、約1分お待ちください。",
  waitingLong: "引き続きおつなぎしています。1分以上かかっていますが、順番はそのまま保たれています。",
  queueConnecting: "待ち状況：担当者におつなぎ中",
  queueWaiting: "待ち状況：担当者を待っています",
  queueAway: "待ち状況：現在対応できる担当者がいません",
  etaLine: "予想待ち時間：約1分",
  available: "サポート担当者がオンラインになりました。順番待ちはそのまま続いています。",
  leftHere: "メッセージはこのチャットに保存されました。担当者が対応でき次第、ここで返信します。",
  leaveHint: "下にメッセージを入力して送信してください。担当者がこのチャットで返信します。",
  signedOut: "サインアウトしました。ここでサポートチームと話すには、もう一度サインインしてください。",
  humanOnline: "スタッフサポート · オンライン",
  humanAway: "スタッフサポート · 現在不在",
  humanLabel: "スタッフサポート",
};

const ru: Partial<LiveT> = {
  offer: "Я бы хотел подключить к этому живого специалиста. Соединить вас с нашей службой поддержки?",
  connect: "Связаться с человеком",
  keepPip: "Продолжить с Pip",
  connecting: "Отправляем ваш запрос в службу поддержки...",
  waiting: "Вы в очереди поддержки. Разговор сохранён. Специалист поддержки Outlly подключится к этому чату.",
  position: (n) => (n <= 1 ? "Вы следующий в очереди." : `Вы ${n}-й в очереди.`),
  connected: "Вы на связи со специалистом поддержки Outlly.",
  unavailable: "Сейчас нет свободных специалистов. Ваш разговор сохранён. Оставьте сообщение здесь, и специалист ответит в этом чате.",
  reconnecting: "Соединение прервалось. Пытаемся переподключить вас...",
  resolved: "Ваш разговор со службой поддержки отмечен как решённый. Если нужно что-то ещё, начните новый разговор.",
  cancel: "Отменить запрос в поддержку",
  continueWaiting: "Продолжить ожидание",
  handoff: "Подключаю вас к специалисту поддержки. Пока ждёте, можете писать здесь.",
  already: "Вы уже в очереди поддержки. Специалист подключится к этому чату, как только освободится.",
  connectedWith: (n) => `Вы на связи с ${n}. Вам помогут прямо здесь.`,
  leave: "Оставить сообщение",
  leaving: "Сохраняем ваше сообщение...",
  left: (ref) => `Готово. Ваше сообщение сохранено как обращение ${ref}, мы ответим по почте.`,
  endChat: "Завершить чат",
  pipBack: "Pip снова здесь. Служба поддержки вернула этот чат Pip, спрашивайте.",
  cancelled: "Запрос отменён. Pip готов помочь.",
  customerLeft: "Вы вышли из чата со службой поддержки. Pip готов помочь.",
  transferred: (name) => `${name} из поддержки Outlly присоединился к чату.`,
  reopened: "Служба поддержки снова открыла этот разговор.",
  agentLabel: (name) => `${name}, поддержка Outlly`,
  saidAgent: "Специалист поддержки написал",
  typing: (name) => `${name} печатает`,
  placeholder: "Напишите в службу поддержки",
  sending: "Отправляется", sent: "Отправлено", delivered: "Доставлено", seen: "Прочитано", failed: "Не отправлено", retry: "Повторить",
  helpful: "Служба поддержки вам помогла?", yes: "Да", no: "Нет", thanks: "Спасибо за отзыв.",
  newChat: "Начать новый разговор",
  error: "Сейчас не удалось связаться со службой поддержки. Попробуйте чуть позже.",
  statusWaiting: "В очереди", statusConnected: "Специалист поддержки", statusUnavailable: "Команда недоступна", statusReconnecting: "Переподключение",
  unread: (n) => `Новых сообщений от поддержки: ${n}`,
  waitingEta: "Вы в очереди. Подождите примерно 1 минуту, пока мы подключаем вас к специалисту поддержки.",
  waitingLong: "Мы всё ещё подключаем вас. Это занимает больше минуты, ваше место в очереди сохраняется.",
  queueConnecting: "Статус очереди: подключаем специалиста",
  queueWaiting: "Статус очереди: ожидание специалиста",
  queueAway: "Статус очереди: сейчас нет свободных специалистов",
  etaLine: "Примерное ожидание: около 1 минуты",
  available: "Специалист поддержки сейчас в сети, а вы по-прежнему в очереди.",
  leftHere: "Ваше сообщение сохранено в этом чате. Специалист ответит здесь, как только освободится.",
  leaveHint: "Напишите сообщение ниже и отправьте его. Специалист ответит в этом чате.",
  signedOut: "Вы вышли из аккаунта. Войдите снова, чтобы поговорить здесь с нашей поддержкой.",
  humanOnline: "Живая поддержка · В сети",
  humanAway: "Живая поддержка · Недоступна",
  humanLabel: "Живая поддержка",
};

const id: Partial<LiveT> = {
  offer: "Sebaiknya ahli dari tim kami yang membantu soal ini. Mau saya hubungkan dengan tim dukungan kami?",
  connect: "Hubungkan ke manusia",
  keepPip: "Lanjut dengan Pip",
  connecting: "Mengirim permintaanmu ke tim support...",
  waiting: "Kamu ada di antrean support. Percakapanmu tersimpan. Spesialis support Outlly akan bergabung ke chat ini.",
  position: (n) => (n <= 1 ? "Kamu berikutnya." : `Kamu nomor ${n} dalam antrean.`),
  connected: "Kamu sekarang terhubung dengan spesialis dukungan Outlly.",
  unavailable: "Belum ada spesialis yang tersedia saat ini. Percakapanmu tersimpan. Tinggalkan pesan di sini dan spesialis akan membalas di chat ini.",
  reconnecting: "Koneksi terputus. Kami mencoba menghubungkanmu kembali...",
  resolved: "Percakapanmu dengan tim dukungan kami telah ditandai selesai. Jika butuh hal lain, kamu bisa memulai percakapan baru.",
  cancel: "Batalkan permintaan support",
  continueWaiting: "Lanjut menunggu",
  handoff: "Aku sedang menghubungkan kamu dengan spesialis support. Kamu bisa terus menulis di sini sambil menunggu.",
  already: "Kamu sudah ada di antrean support. Spesialis akan bergabung ke chat ini begitu ada yang tersedia.",
  connectedWith: (n) => `Kamu sekarang terhubung dengan ${n}. Mereka akan membantumu di sini.`,
  leave: "Tinggalkan pesan",
  leaving: "Menyimpan pesanmu...",
  left: (ref) => `Siap. Pesanmu disimpan sebagai tiket ${ref} dan kami akan membalas lewat email.`,
  endChat: "Akhiri chat",
  pipBack: "Pip kembali. Tim dukungan menyerahkan chat ini ke Pip, silakan bertanya.",
  cancelled: "Permintaan dibatalkan. Pip siap membantu.",
  customerLeft: "Kamu keluar dari chat dengan tim dukungan. Pip siap membantu.",
  transferred: (name) => `${name} dari dukungan Outlly bergabung ke chat.`,
  reopened: "Tim dukungan kami membuka kembali percakapan ini.",
  agentLabel: (name) => `${name}, dukungan Outlly`,
  saidAgent: "Spesialis dukungan menulis",
  typing: (name) => `${name} sedang mengetik`,
  placeholder: "Kirim pesan ke tim dukungan",
  sending: "Mengirim", sent: "Terkirim", delivered: "Tersampaikan", seen: "Dibaca", failed: "Gagal terkirim", retry: "Coba lagi",
  helpful: "Apakah tim dukungan kami membantu?", yes: "Ya", no: "Tidak", thanks: "Terima kasih atas masukannya.",
  newChat: "Mulai percakapan baru",
  error: "Kami belum bisa menghubungi tim dukungan. Coba lagi sebentar lagi.",
  statusWaiting: "Dalam antrean", statusConnected: "Spesialis dukungan", statusUnavailable: "Tim tidak tersedia", statusReconnecting: "Menghubungkan ulang",
  unread: (n) => `${n} pesan baru dari dukungan`,
  waitingEta: "Kamu dalam antrean. Harap tunggu sekitar 1 menit sementara kami menghubungkanmu dengan spesialis support.",
  waitingLong: "Kami masih menghubungkanmu. Ini memakan waktu lebih dari satu menit, dan posisimu di antrean tetap terjaga.",
  queueConnecting: "Status antrean: Menghubungkan ke spesialis",
  queueWaiting: "Status antrean: Menunggu spesialis",
  queueAway: "Status antrean: Belum ada spesialis yang tersedia",
  etaLine: "Perkiraan waktu tunggu: Sekitar 1 menit",
  available: "Spesialis support sedang online, dan kamu masih dalam antrean.",
  leftHere: "Pesanmu tersimpan di chat ini. Spesialis akan membalas di sini begitu tersedia.",
  leaveHint: "Tulis pesanmu di bawah lalu kirim. Spesialis akan membalas di chat ini.",
  signedOut: "Kamu sudah keluar. Masuk lagi untuk bicara dengan tim support kami di sini.",
  humanOnline: "Support manusia · Online",
  humanAway: "Support manusia · Tidak tersedia",
  humanLabel: "Support manusia",
};

const bn: Partial<LiveT> = {
  offer: "আমি চাই এ বিষয়ে একজন মানুষ বিশেষজ্ঞ আপনাকে সাহায্য করুক। আপনাকে কি আমাদের সাপোর্ট টিমের সঙ্গে যুক্ত করব?",
  connect: "একজন মানুষের সঙ্গে যুক্ত হন",
  keepPip: "Pip-এর সঙ্গে চালিয়ে যান",
  connecting: "আপনার অনুরোধ সাপোর্ট টিমকে পাঠানো হচ্ছে...",
  waiting: "আপনি সাপোর্ট সারিতে আছেন। আপনার কথোপকথন সংরক্ষিত। Outlly-এর একজন সাপোর্ট বিশেষজ্ঞ এই চ্যাটে যোগ দেবেন।",
  position: (n) => (n <= 1 ? "পরের পালা আপনার।" : `সারিতে আপনার নম্বর ${n}।`),
  connected: "আপনি এখন Outlly সাপোর্ট বিশেষজ্ঞের সঙ্গে যুক্ত।",
  unavailable: "এই মুহূর্তে কোনো বিশেষজ্ঞ উপলব্ধ নেই। আপনার কথোপকথন সংরক্ষিত আছে। এখানে একটি বার্তা রেখে যান, বিশেষজ্ঞ এই চ্যাটেই উত্তর দেবেন।",
  reconnecting: "সংযোগ বিচ্ছিন্ন হয়েছে। আমরা আবার যুক্ত করার চেষ্টা করছি...",
  resolved: "আমাদের সাপোর্ট টিমের সঙ্গে আপনার কথোপকথন সমাধান হিসেবে চিহ্নিত হয়েছে। আর কিছু দরকার হলে নতুন কথোপকথন শুরু করতে পারেন।",
  cancel: "সাপোর্ট অনুরোধ বাতিল করুন",
  continueWaiting: "অপেক্ষা চালিয়ে যান",
  handoff: "আপনাকে এখন একজন সাপোর্ট বিশেষজ্ঞের সঙ্গে যুক্ত করছি। অপেক্ষার সময় এখানেই লিখতে থাকুন।",
  already: "আপনি আগে থেকেই সাপোর্ট সারিতে আছেন। একজন বিশেষজ্ঞ ফ্রি হলেই এই চ্যাটে যোগ দেবেন।",
  connectedWith: (n) => `আপনি এখন ${n}-এর সঙ্গে যুক্ত। তিনি এখানেই আপনাকে সাহায্য করবেন।`,
  leave: "বার্তা রেখে যান",
  leaving: "আপনার বার্তা সংরক্ষণ করা হচ্ছে...",
  left: (ref) => `ঠিক আছে। আপনার বার্তা টিকিট ${ref} হিসেবে সংরক্ষিত হয়েছে, আমরা ইমেলে যোগাযোগ করব।`,
  endChat: "চ্যাট শেষ করুন",
  pipBack: "Pip ফিরে এসেছে। সাপোর্ট টিম এই চ্যাট Pip-কে ফিরিয়ে দিয়েছে, নির্দ্বিধায় জিজ্ঞাসা করুন।",
  cancelled: "অনুরোধ বাতিল হয়েছে। Pip সাহায্যের জন্য আছে।",
  customerLeft: "আপনি সাপোর্ট টিমের চ্যাট ছেড়ে দিয়েছেন। Pip সাহায্যের জন্য আছে।",
  transferred: (name) => `Outlly সাপোর্টের ${name} চ্যাটে যোগ দিয়েছেন।`,
  reopened: "আমাদের সাপোর্ট টিম এই কথোপকথন আবার খুলেছে।",
  agentLabel: (name) => `${name}, Outlly সাপোর্ট`,
  saidAgent: "সাপোর্ট বিশেষজ্ঞ বললেন",
  typing: (name) => `${name} লিখছেন`,
  placeholder: "সাপোর্ট টিমকে বার্তা লিখুন",
  sending: "পাঠানো হচ্ছে", sent: "পাঠানো হয়েছে", delivered: "পৌঁছেছে", seen: "দেখা হয়েছে", failed: "পাঠানো যায়নি", retry: "আবার চেষ্টা করুন",
  helpful: "আমাদের সাপোর্ট টিম কি সাহায্য করেছে?", yes: "হ্যাঁ", no: "না", thanks: "জানানোর জন্য ধন্যবাদ।",
  newChat: "নতুন কথোপকথন শুরু করুন",
  error: "এই মুহূর্তে সাপোর্ট টিমের সঙ্গে যোগাযোগ করা গেল না। একটু পরে আবার চেষ্টা করুন।",
  statusWaiting: "সারিতে", statusConnected: "সাপোর্ট বিশেষজ্ঞ", statusUnavailable: "টিম উপলব্ধ নয়", statusReconnecting: "আবার যুক্ত হচ্ছে",
  unread: (n) => `সাপোর্ট থেকে ${n}টি নতুন বার্তা`,
  waitingEta: "আপনি সারিতে আছেন। আমরা আপনাকে একজন সাপোর্ট বিশেষজ্ঞের সঙ্গে যুক্ত করছি, অনুগ্রহ করে প্রায় ১ মিনিট অপেক্ষা করুন।",
  waitingLong: "আমরা এখনও আপনাকে যুক্ত করার চেষ্টা করছি। এক মিনিটের বেশি লাগছে, সারিতে আপনার জায়গা বজায় আছে।",
  queueConnecting: "সারির অবস্থা: বিশেষজ্ঞের সঙ্গে যুক্ত করা হচ্ছে",
  queueWaiting: "সারির অবস্থা: বিশেষজ্ঞের অপেক্ষায়",
  queueAway: "সারির অবস্থা: এই মুহূর্তে কোনো বিশেষজ্ঞ উপলব্ধ নেই",
  etaLine: "আনুমানিক অপেক্ষা: প্রায় ১ মিনিট",
  available: "একজন সাপোর্ট বিশেষজ্ঞ এখন অনলাইনে আছেন, আর আপনি এখনও সারিতে আছেন।",
  leftHere: "আপনার বার্তা এই চ্যাটে সংরক্ষিত হয়েছে। বিশেষজ্ঞ উপলব্ধ হলেই এখানে উত্তর দেবেন।",
  leaveHint: "নিচে আপনার বার্তা লিখে পাঠান। বিশেষজ্ঞ এই চ্যাটেই উত্তর দেবেন।",
  signedOut: "আপনি সাইন আউট হয়ে গেছেন। এখানে আমাদের সাপোর্ট টিমের সঙ্গে কথা বলতে আবার সাইন ইন করুন।",
  humanOnline: "মানব সাপোর্ট · অনলাইন",
  humanAway: "মানব সাপোর্ট · এখন উপলব্ধ নয়",
  humanLabel: "মানব সাপোর্ট",
};

const BY: Record<Lang, Partial<LiveT>> = { en, hi, es, fr, de, pt, ar, zh, ja, ru, id, bn };
export const LIVE_EN = en;
export const liveT = (l: Lang): LiveT => ({ ...en, ...(BY[l] ?? {}) });

/** A stored status code (PipMessage role "system") in the reader's words. Unknown codes return null and are not shown. */
export function liveSysLine(t: LiveT, raw: string): string | null {
  const { code, arg } = parseSys(raw);
  switch (code) {
    case SYS.requested:
      return t.handoff;
    case SYS.connected:
      return arg ? t.connectedWith(arg) : t.connected;
    case SYS.transferred:
      return t.transferred(arg || "Outlly");
    case SYS.pipBack:
      return t.pipBack;
    case SYS.resolved:
      return t.resolved;
    case SYS.reopened:
      return t.reopened;
    case SYS.cancelled:
      return t.cancelled;
    case SYS.customerLeft:
      return t.customerLeft;
    case SYS.ticket:
      return t.left(arg || "");
    case SYS.left:
      return t.leftHere;
    default:
      return null;
  }
}
