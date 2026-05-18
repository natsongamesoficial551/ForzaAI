type SoundType = "click" | "typing" | "notification" | "complete";

const frequencies: Record<SoundType, number[]> = {
  click: [520],
  typing: [360],
  notification: [660, 880],
  complete: [523, 659, 784],
};

export function playInterfaceSound(type: SoundType, enabled = true) {
  if (!enabled || typeof window === "undefined") return;
  const AudioContext =
    window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof window.AudioContext }).webkitAudioContext;
  if (!AudioContext) return;

  const ctx = new AudioContext();
  frequencies[type].forEach((frequency, index) => {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.frequency.value = frequency;
    oscillator.type = "sine";
    gain.gain.setValueAtTime(0.0001, ctx.currentTime + index * 0.08);
    gain.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + index * 0.08 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + index * 0.08 + 0.12);
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start(ctx.currentTime + index * 0.08);
    oscillator.stop(ctx.currentTime + index * 0.08 + 0.13);
  });
}

export async function notifyGenerationComplete(enabled = true) {
  playInterfaceSound("complete", enabled);
  if (!enabled || typeof window === "undefined" || !("Notification" in window)) return;

  if (Notification.permission === "default") {
    await Notification.requestPermission();
  }

  if (Notification.permission === "granted") {
    new Notification("ForzaAI", {
      body: "Seu projeto terminou de gerar.",
    });
  }
}
