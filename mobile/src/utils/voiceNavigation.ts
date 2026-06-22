import * as Speech from 'expo-speech';

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
    Speech.speak(text, { language: 'es-ES', rate: 0.95 });
  } catch {
    try { Speech.speak(text, { rate: 0.95 }); } catch {}
  }
}

export function announceNavigationStart(totalDistM: number) {
  if (_muted) return;
  const km = (totalDistM / 1000).toFixed(1);
  speak(`Navegación iniciada. Distancia total: ${km} kilómetros`);
}
