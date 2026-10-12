// Guesses whether a message was typed or dictated with the keyboard microphone, for the dataset.
// GUESS, not verified on devices: dictation inserts text without key presses, typing produces about
// one key event per character. Pasted text and autocorrect blur this, so the answer can be 'unknown'.

export type InputMethod = 'typed' | 'dictated' | 'unknown';

export class InputMethodTracker {
  private keys = 0;
  private pasted = false;

  keyDown(): void {
    this.keys++;
  }

  input(inputType: string): void {
    if (inputType === 'insertFromPaste' || inputType === 'insertFromDrop') this.pasted = true;
  }

  guess(text: string): InputMethod {
    const chars = text.trim().length;
    if (chars === 0 || this.pasted) return 'unknown';
    const ratio = this.keys / chars;
    if (ratio >= 0.5) return 'typed';
    if (ratio <= 0.15) return 'dictated';
    return 'unknown';
  }

  reset(): void {
    this.keys = 0;
    this.pasted = false;
  }
}
