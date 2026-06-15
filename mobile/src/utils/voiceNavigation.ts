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
  if (_muted) return;
  Speech.stop();
  Speech.speak(text, { language: 'es-ES', rate: 0.95 });
}

export function checkVoiceAnnouncements(distDoneM: number, totalDistM: number) {
  if (totalDistM <= 0) return;
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
    speak(`Kilómetro ${km}`);
  }
}
