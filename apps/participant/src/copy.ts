// Every word participants see, in one place, so Nickii can change wording without touching code.
// Short labels are bilingual ("Ask · Frag"). Sentences are shown in the phone's language (German or English).
// Rules (CLAUDE.md): never show "typing…", a human name, read receipts or "last seen".

export type Lang = 'de' | 'en';
export type Text = Record<Lang, string>;

export function pickLang(languages: readonly string[]): Lang {
  return languages.some((l) => l.toLowerCase().startsWith('de')) ? 'de' : 'en';
}

export const LABELS = {
  wordmark: 'NICKII AI',
  modes: { chat: 'CHAT', line: 'LINE', live: 'LIVE' },
  ask: 'Ask · Frag',
  send: 'Send · Senden',
  activate: 'Activate · Aktivieren',
  agree: 'I agree · Ich stimme zu',
  install: 'Install · Installieren',
  next: 'Next · Weiter',
  back: 'Back · Zurück',
  copyLink: 'Copy link · Link kopieren',
  copied: 'Copied · Kopiert',
  leaveLine: 'Leave · Verlassen',
} as const;

export const STATUS_WORDS = {
  listening: 'LISTENING',
  thinking: 'THINKING',
  waiting: 'WAITING',
  transmission: 'DIRECT TRANSMISSION',
  offline: 'OFFLINE',
} as const;

export const SENTENCES = {
  chatIdle: {
    en: 'Type or dictate a question. The answer also arrives as a notification.',
    de: 'Schreib oder diktiere eine Frage. Die Antwort kommt auch als Mitteilung.',
  },
  chatThinking: {
    en: 'Your answer will appear here and as a notification.',
    de: 'Deine Antwort erscheint hier und als Mitteilung.',
  },
  chatAway: {
    en: 'Answers may take a while. You will get a notification.',
    de: 'Antworten können dauern. Du bekommst eine Mitteilung.',
  },
  lineWaiting: {
    en: 'You are in the line. You will be connected automatically.',
    de: 'Du bist in der Leitung. Du wirst automatisch verbunden.',
  },
  liveNow: {
    en: 'This transmission is for you only. Answer by text.',
    de: 'Diese Übertragung ist nur für dich. Antworte per Text.',
  },
  offline: {
    en: 'No connection. Your text stays here; send it again when you are back online.',
    de: 'Keine Verbindung. Dein Text bleibt hier; sende ihn erneut, sobald du wieder online bist.',
  },
} satisfies Record<string, Text>;

export const LINE_LABELS = {
  position: { en: 'Position', de: 'Position' },
  wait: { en: 'Wait', de: 'Wartezeit' },
  minutes: { en: 'min', de: 'Min.' },
  next: { en: 'You are next.', de: 'Du bist als Nächstes dran.' },
} satisfies Record<string, Text>;

// --- install gate screens ---

export const GATE = {
  openInBrowserTitle: { en: 'Open in Safari or Chrome', de: 'In Safari oder Chrome öffnen' },
  openInBrowserBody: {
    en: 'This app cannot be installed from inside Instagram, WhatsApp or similar apps. Tap ⋯ and choose “Open in browser”, or copy the link and paste it into Safari (iPhone) or Chrome (Android).',
    de: 'Aus Instagram, WhatsApp oder ähnlichen Apps lässt sich diese App nicht installieren. Tippe auf ⋯ und wähle „Im Browser öffnen“, oder kopiere den Link und füge ihn in Safari (iPhone) oder Chrome (Android) ein.',
  },
  installTitle: { en: 'Add Nickii AI to your home screen', de: 'Nickii AI zum Home-Bildschirm hinzufügen' },
  installAndroidBody: {
    en: 'Tap Install. Then open Nickii AI from your home screen.',
    de: 'Tippe auf Installieren. Öffne Nickii AI danach vom Home-Bildschirm.',
  },
  installAndroidManual: {
    en: 'In Chrome, tap ⋮ (top right) → “Add to Home screen” or “Install app”. Then open Nickii AI from your home screen.',
    de: 'Tippe in Chrome auf ⋮ (oben rechts) → „Zum Startbildschirm hinzufügen“ oder „App installieren“. Öffne Nickii AI danach vom Startbildschirm.',
  },
  installDesktopBody: {
    en: 'Nickii AI is made for phones. Open this address on your iPhone or Android phone.',
    de: 'Nickii AI ist für Smartphones gemacht. Öffne diese Adresse auf deinem iPhone oder Android-Handy.',
  },
  pushDeniedTitle: { en: 'Notifications are off', de: 'Mitteilungen sind aus' },
  pushDeniedBody: {
    en: 'Nickii AI needs notifications. Remove the Nickii AI icon from your home screen, open this address again in Safari or Chrome, add it again and tap Activate.',
    de: 'Nickii AI braucht Mitteilungen. Entferne das Nickii-AI-Symbol vom Home-Bildschirm, öffne diese Adresse erneut in Safari oder Chrome, füge sie wieder hinzu und tippe auf Aktivieren.',
  },
  pushUnsupportedTitle: { en: 'This phone cannot receive notifications', de: 'Dieses Handy kann keine Mitteilungen empfangen' },
  pushUnsupportedBody: {
    en: 'Nickii AI needs iOS 16.4 or newer on iPhone, or a current Chrome on Android. Please update and try again.',
    de: 'Nickii AI braucht iOS 16.4 oder neuer auf dem iPhone oder ein aktuelles Chrome auf Android. Bitte aktualisiere und versuche es erneut.',
  },
  activateTitle: { en: 'Activate notifications', de: 'Mitteilungen aktivieren' },
  activateBody: {
    en: 'Answers arrive as notifications, also when the app is closed. Tap Activate, then Allow.',
    de: 'Antworten kommen als Mitteilung, auch wenn die App geschlossen ist. Tippe auf Aktivieren und dann auf Erlauben.',
  },
  activateFailed: {
    en: 'That did not work. Check your connection and tap Activate again.',
    de: 'Das hat nicht geklappt. Prüfe deine Verbindung und tippe erneut auf Aktivieren.',
  },
  notConfigured: {
    en: 'Nickii AI is not available right now.',
    de: 'Nickii AI ist gerade nicht erreichbar.',
  },
} satisfies Record<string, Text>;

/**
 * iPhone install steps, one screen each. Safari's menus changed in iOS 26 (Share moved behind ⋯);
 * these steps cover both. Check them on a current iPhone before the performance.
 */
export const IOS_STEPS: Array<{ title: Text; body: Text }> = [
  {
    title: { en: '1 · Open the Share menu', de: '1 · Teilen-Menü öffnen' },
    body: {
      en: 'In Safari, tap the Share button (square with arrow). If you don’t see it, tap ⋯ first, then Share.',
      de: 'Tippe in Safari auf Teilen (Quadrat mit Pfeil). Wenn du es nicht siehst, tippe zuerst auf ⋯ und dann auf Teilen.',
    },
  },
  {
    title: { en: '2 · Add to Home Screen', de: '2 · Zum Home-Bildschirm' },
    body: {
      en: 'Scroll down and tap “Add to Home Screen”. If it is missing, tap “View More” or “Edit Actions”.',
      de: 'Scrolle nach unten und tippe auf „Zum Home-Bildschirm“. Fehlt es, tippe auf „Mehr anzeigen“ oder „Aktionen bearbeiten“.',
    },
  },
  {
    title: { en: '3 · Confirm', de: '3 · Bestätigen' },
    body: {
      en: 'If you see “Open as Web App”, keep it on. Tap Add.',
      de: 'Wenn „Als Web-App öffnen“ angezeigt wird, lass es eingeschaltet. Tippe auf Hinzufügen.',
    },
  },
  {
    title: { en: '4 · Open from the home screen', de: '4 · Vom Home-Bildschirm öffnen' },
    body: {
      en: 'Close Safari and open Nickii AI from your home screen. Everything else happens there.',
      de: 'Schließe Safari und öffne Nickii AI vom Home-Bildschirm. Alles Weitere passiert dort.',
    },
  },
];
