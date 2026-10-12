import { describe, expect, it } from 'vitest';
import {
  detectDevice, detectInAppBrowser, detectStandalone, memoryStorage, parseNotificationOpen,
  stripNotificationParams, urlBase64ToUint8Array,
} from './platform';

const UA = {
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Mobile/15E148 Safari/604.1',
  ipadOS: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Safari/605.1.15',
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Safari/605.1.15',
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36',
  instagramIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0.0.0.0',
  facebookIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/470.0.0.0]',
  whatsappAndroid: 'Mozilla/5.0 (Linux; Android 13; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Mobile Safari/537.36 WhatsApp/2.24',
  windowsChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
};

describe('detectDevice', () => {
  it('recognises iPhone, Android and desktop', () => {
    expect(detectDevice(UA.iphoneSafari)).toBe('ios');
    expect(detectDevice(UA.androidChrome)).toBe('android');
    expect(detectDevice(UA.windowsChrome)).toBe('desktop');
    expect(detectDevice(UA.macSafari, 0)).toBe('desktop');
  });

  it('treats an iPad pretending to be a Mac as iOS', () => {
    expect(detectDevice(UA.ipadOS, 5)).toBe('ios');
  });
});

describe('detectInAppBrowser', () => {
  it('flags Instagram, Facebook and WhatsApp', () => {
    expect(detectInAppBrowser(UA.instagramIos)).toBe(true);
    expect(detectInAppBrowser(UA.facebookIos)).toBe(true);
    expect(detectInAppBrowser(UA.whatsappAndroid)).toBe(true);
  });

  it('does not flag real browsers', () => {
    for (const ua of [UA.iphoneSafari, UA.androidChrome, UA.macSafari, UA.windowsChrome]) {
      expect(detectInAppBrowser(ua)).toBe(false);
    }
  });
});

describe('detectStandalone', () => {
  const mm = (matching: string[]) => (q: string) => ({ matches: matching.some((m) => q.includes(m)) });

  it('is true when launched from the home screen', () => {
    expect(detectStandalone(mm(['standalone']), undefined)).toBe(true);
    expect(detectStandalone(mm(['fullscreen']), undefined)).toBe(true);
  });

  it('is true on older iOS via navigator.standalone', () => {
    expect(detectStandalone(mm([]), true)).toBe(true);
  });

  it('is false in a browser tab', () => {
    expect(detectStandalone(mm([]), false)).toBe(false);
    expect(detectStandalone(undefined, undefined)).toBe(false);
  });
});

describe('urlBase64ToUint8Array', () => {
  it('decodes URL-safe base64 without padding', () => {
    // "hi?>" -> standard base64 "aGk/Pg==" -> url-safe "aGk_Pg"
    expect(Array.from(urlBase64ToUint8Array('aGk_Pg'))).toEqual([104, 105, 63, 62]);
  });

  it('decodes a 65-byte VAPID public key', () => {
    const key = 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U';
    const bytes = urlBase64ToUint8Array(key);
    expect(bytes.length).toBe(65);
    expect(bytes[0]).toBe(0x04); // uncompressed P-256 point
  });
});

describe('memoryStorage', () => {
  it('stores, reads and removes strings', () => {
    const s = memoryStorage();
    expect(s.get('a')).toBeNull();
    s.set('a', '1');
    expect(s.get('a')).toBe('1');
    s.remove('a');
    expect(s.get('a')).toBeNull();
  });
});

describe('notification launch marker', () => {
  it('reads kind and mode from a notification link', () => {
    expect(parseNotificationOpen('https://app.example/?mode=line&from=push&kind=line_invite'))
      .toEqual({ kind: 'line_invite', mode: 'line' });
  });

  it('returns null for a normal launch', () => {
    expect(parseNotificationOpen('https://app.example/')).toBeNull();
    expect(parseNotificationOpen('/?mode=line')).toBeNull();
  });

  it('removes the marker but keeps the mode', () => {
    expect(stripNotificationParams('https://app.example/?mode=line&from=push&kind=line_invite'))
      .toBe('https://app.example/?mode=line');
  });
});
