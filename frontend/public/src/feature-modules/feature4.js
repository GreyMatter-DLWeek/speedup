export function initFeature4(ctx) {
  const { runtime } = ctx;

  function toggleVoice() {
    const btn = document.getElementById("voiceBtn");
    const status = document.getElementById("voiceStatus");
    if (!btn) return;

    runtime.voiceActive = !runtime.voiceActive;
    if (runtime.voiceActive) {
      btn.classList.add("listening");
      btn.textContent = "🎙";
      if (status) status.textContent = "Listening or playing explanation...";

      const text = "Dynamic programming solves repeated sub-problems efficiently by storing intermediate results.";
      if ("speechSynthesis" in window) {
        const utter = new SpeechSynthesisUtterance(text);
        utter.rate = 0.92;
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utter);
        utter.onend = () => {
          runtime.voiceActive = false;
          btn.classList.remove("listening");
          btn.textContent = "🔊";
          if (status) status.textContent = "Tap to listen to AI audio explanation";
        };
      }
    } else {
      btn.classList.remove("listening");
      btn.textContent = "🔊";
      if (status) status.textContent = "Tap to listen to AI audio explanation";
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    }
  }

  function startVoice() {
    toggleVoice();
  }

  return { startVoice, toggleVoice };
}
