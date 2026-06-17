// expo-speech is a native module — it requires expo prebuild --clean to be registered.
// We use a defensive require so the app doesn't crash if the native module is missing.
let _Speech: { speak: (text: string, opts?: object) => void } | null = null;
try {
  _Speech = require('expo-speech');
} catch {}

let _muted = false;
let _lastKmAnnounced = -1;
let _announced500 = false;
let _announcedArrival = false;

export function setVoiceMuted(v: boolean) { _muted = v; }
export function isVoiceMuted() { return _muted; }

export function resetVoiceState() {
  _lastKmAnnounced = -1;
  _announced500 = false;
  _announcedArrival = false;
}

function speak(text: string) {
  try {
    _Speech?.speak(text, { language: 'es-ES', rate: 0.95 });
  } catch {}
}

export function checkVoiceAnnouncements(distDoneM: number, totalDistM: number) {
  if (_muted || totalDistM <= 0) return;
  const remaining = totalDistM - distDoneM;
  if (!_announcedArrival && remaining >= 0 && remaining < 30) {
    _announcedArrival = true;
    speak('Has llegado a tu destino');
    return;
  }
  if (!_announced500 && remaining > 0 && remaining <= 500) {
    _announced500 = true;
    speak('Quinientos metros para llegar al destino');
    return;
  }
  const km = Math.floor(distDoneM / 1000);
  if (km > 0 && km > _lastKmAnnounced) {
    _lastKmAnnounced = km;
    speak(`Kilometro ${km}`);
  }
}
