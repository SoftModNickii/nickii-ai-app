// Participant agreement. DRAFT: Nickii writes the final text (and fills in the [brackets]).
// CLAUDE.md requires it to say plainly: conversations are recorded for an artistic dataset,
// pseudonymised, what is kept after the 7 days, and how to ask for deletion until a stated date.
// Change AGREEMENT_VERSION whenever the text changes; the version each participant agreed to is stored.

import type { Lang } from './copy';

export const AGREEMENT_VERSION = 'draft-2026-10-12';

export const AGREEMENT: Record<Lang, { title: string; paragraphs: string[] }> = {
  en: {
    title: 'Before you start',
    paragraphs: [
      'Nickii AI is an artwork by Nickii Schamborski, running for 7 days.',
      'Your conversations are recorded for an artistic dataset. They are stored under a random code (pseudonym), never with your name, email or phone number.',
      'Only text is sent. Voice input is turned into text by your phone’s keyboard; no audio is uploaded or stored.',
      'After the 7 days, [what is kept: the conversations under the pseudonym, as part of the dataset]. Notification addresses and device information are deleted.',
      'You can ask for your conversations to be deleted until [date] by writing to [contact].',
      'Nickii AI sends you notifications. You can stop at any time by removing the app from your home screen.',
    ],
  },
  de: {
    title: 'Bevor du beginnst',
    paragraphs: [
      'Nickii AI ist ein Kunstwerk von Nickii Schamborski und läuft 7 Tage.',
      'Deine Gespräche werden für einen künstlerischen Datensatz aufgezeichnet. Sie werden unter einem zufälligen Code (Pseudonym) gespeichert, nie mit deinem Namen, deiner E-Mail oder Telefonnummer.',
      'Es wird nur Text gesendet. Spracheingabe wird von der Tastatur deines Handys in Text umgewandelt; es wird kein Ton hochgeladen oder gespeichert.',
      'Nach den 7 Tagen [was bleibt: die Gespräche unter dem Pseudonym, als Teil des Datensatzes]. Mitteilungsadressen und Geräteinformationen werden gelöscht.',
      'Bis zum [Datum] kannst du die Löschung deiner Gespräche verlangen: schreib an [Kontakt].',
      'Nickii AI schickt dir Mitteilungen. Du kannst jederzeit aufhören, indem du die App vom Home-Bildschirm entfernst.',
    ],
  },
};
