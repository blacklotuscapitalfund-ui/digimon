const statusEl = document.getElementById("status");
const terminalEl = document.getElementById("terminal-log");
const hintEl = document.getElementById("hint");
const bodyEl = document.body;

let mediaRecorder;
let chunks = [];
let stream;
let audioContext;
let analyser;
let analyserData;
let silenceMonitorId;
let lastSoundTime = 0;
let recordingStart = 0;
let isListening = false;
let isProcessing = false;
let hasUserGesture = false;
let soundDetected = false;
let isSpeaking = false;
let currentAudio = null;
let idleDinoTimerId = null;

const silenceMs = 1200;
const minRecordingMs = 800;
const maxRecordingMs = 10000;
const rmsThreshold = 0.02;
const idleDinoMinMs = 9000;
const idleDinoMaxMs = 18000;
const idleMinSilenceMs = 7000;
const dinoSounds = [
  "/dinosaur-roar-with-screams-and-growls-193210.mp3",
  "/dinosaur-roar-390283.mp3",
  "/dinosaur-99810.mp3",
];

const log = (message, details) => {
  if (details === undefined) {
    console.log(`[voice] ${message}`);
  } else {
    console.log(`[voice] ${message}`, details);
  }
};

const setSpeakingState = (value) => {
  isSpeaking = value;
  if (bodyEl) {
    bodyEl.classList.toggle("is-speaking", value);
  }
};

const setStatus = (text) => {
  statusEl.textContent = text;
};

const setHint = (text, visible) => {
  if (!hintEl) return;
  hintEl.textContent = text;
  hintEl.hidden = !visible;
};

const appendLog = (role, text) => {
  if (!terminalEl || !text) return;
  const line = document.createElement("div");
  line.className = `line ${role}`;
  const label = document.createElement("span");
  label.className = "label";
  label.textContent =
    role === "user" ? "YOU" : role === "solamon" ? "SOLAMON" : "SYSTEM";
  const content = document.createElement("span");
  content.textContent = text;
  line.appendChild(label);
  line.appendChild(content);
  terminalEl.appendChild(line);
  terminalEl.scrollTop = terminalEl.scrollHeight;
};

const resetText = () => {
  if (!terminalEl) return;
  terminalEl.textContent = "";
  appendLog("system", "Signal acquired. Awaiting your words.");
};

const waitForUserGesture = () => {
  if (hasUserGesture) return Promise.resolve();
  return new Promise((resolve) => {
    const handler = () => {
      hasUserGesture = true;
      if (audioContext && audioContext.state === "suspended") {
        audioContext.resume();
      }
      setHint("", false);
      document.removeEventListener("click", handler);
      resolve();
    };
    document.addEventListener("click", handler);
    setHint("Click anywhere once to enable audio playback.", true);
  });
};

const playAudio = async (base64Audio) => {
  const audio = new Audio(`data:audio/wav;base64,${base64Audio}`);
  try {
    log("Starting audio playback.");
    currentAudio = audio;
    setSpeakingState(true);
    await audio.play();
  } catch (error) {
    setSpeakingState(false);
    await waitForUserGesture();
    try {
      log("Retrying audio playback after user gesture.");
      currentAudio = audio;
      setSpeakingState(true);
      await audio.play();
    } catch (secondError) {
      console.error(secondError);
      setSpeakingState(false);
      currentAudio = null;
      return;
    }
  }

  await new Promise((resolve) => {
    audio.addEventListener("ended", resolve, { once: true });
    audio.addEventListener("pause", resolve, { once: true });
  });
  setSpeakingState(false);
  currentAudio = null;
  log("Audio playback ended.");
};

const playDinoSound = async () => {
  if (!dinoSounds.length) return;
  const index = Math.floor(Math.random() * dinoSounds.length);
  const audio = new Audio(dinoSounds[index]);
  audio.volume = 0.35;
  try {
    if (!hasUserGesture) {
      await waitForUserGesture();
    }
    log("Playing idle dinosaur sound.", { file: dinoSounds[index] });
    await audio.play();
  } catch (error) {
    console.error(error);
  }
};

const scheduleIdleDino = () => {
  if (idleDinoTimerId) {
    clearTimeout(idleDinoTimerId);
  }
  const delay =
    Math.floor(Math.random() * (idleDinoMaxMs - idleDinoMinMs + 1)) + idleDinoMinMs;
  idleDinoTimerId = setTimeout(async () => {
    const now = performance.now();
    const idleLongEnough = now - lastSoundTime > idleMinSilenceMs;
    if (!isProcessing && !isSpeaking && isListening && idleLongEnough) {
      await playDinoSound();
    }
    scheduleIdleDino();
  }, delay);
};

const buildRecorder = () => {
  const options = MediaRecorder.isTypeSupported("audio/webm")
    ? { mimeType: "audio/webm" }
    : undefined;
  mediaRecorder = new MediaRecorder(stream, options);

  mediaRecorder.ondataavailable = (event) => {
    if (event.data.size > 0) {
      if (chunks.length === 0) {
        log("Captured audio chunk.", { bytes: event.data.size });
      }
      chunks.push(event.data);
    }
  };

  mediaRecorder.onstop = async () => {
    if (silenceMonitorId) {
      cancelAnimationFrame(silenceMonitorId);
    }
    silenceMonitorId = null;
    isListening = false;
    isProcessing = true;
    setStatus("Processing...");
    soundDetected = false;

    const blob = new Blob(chunks, { type: mediaRecorder.mimeType || "audio/webm" });
    const formData = new FormData();
    formData.append("audio", blob, "speech.webm");

    try {
      const recordingMs = Math.round(performance.now() - recordingStart);
      log("Uploading audio for transcription.", { bytes: blob.size, ms: recordingMs });
      const response = await fetch("/api/voice", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error("Server error");
      }

      const data = await response.json();
      log("Received server response.", {
        transcriptChars: data.transcript?.length || 0,
        replyChars: data.reply?.length || 0,
        hasAudio: Boolean(data.audio),
      });
      if (data.transcript) {
        appendLog("user", data.transcript);
      }
      if (data.reply) {
        appendLog("solamon", data.reply);
      }

      if (data.audio) {
        setStatus("Speaking...");
        await playAudio(data.audio);
      }

      setStatus("Listening...");
      isProcessing = false;
      startListening();
    } catch (error) {
      console.error(error);
      setStatus("Error, check the server console.");
      appendLog("system", "Signal disrupted. Check the server console.");
      isProcessing = false;
      setTimeout(startListening, 1500);
    }
  };
};

const monitorSilence = () => {
  if (!analyser) return;

  analyser.getByteTimeDomainData(analyserData);
  let sumSquares = 0;
  for (let i = 0; i < analyserData.length; i += 1) {
    const sample = (analyserData[i] - 128) / 128;
    sumSquares += sample * sample;
  }
  const rms = Math.sqrt(sumSquares / analyserData.length);
  const now = performance.now();

  if (rms > rmsThreshold) {
    if (!soundDetected) {
      soundDetected = true;
      log("Audio input detected (above threshold).", { rms: Number(rms.toFixed(4)) });
    }
    if (isSpeaking) {
      log("User audio detected during playback; interrupting speech.");
      if (currentAudio) {
        currentAudio.pause();
        currentAudio.currentTime = 0;
      }
      setSpeakingState(false);
      currentAudio = null;
      setStatus("Listening...");
      isProcessing = false;
      startListening();
      return;
    }
    if (isListening) {
      lastSoundTime = now;
    }
  }

  if (isListening) {
    const silentFor = now - lastSoundTime;
    const recordingFor = now - recordingStart;

    if (recordingFor > maxRecordingMs || (recordingFor > minRecordingMs && silentFor > silenceMs)) {
      stopListening();
      return;
    }
  }

  silenceMonitorId = requestAnimationFrame(monitorSilence);
};

const startListening = () => {
  if (!mediaRecorder || isListening || isProcessing) return;

  chunks = [];
  recordingStart = performance.now();
  lastSoundTime = recordingStart;
  soundDetected = false;
  isListening = true;
  setStatus("Listening...");
  log("Recording started.");
  mediaRecorder.start();
  if (!silenceMonitorId) {
    silenceMonitorId = requestAnimationFrame(monitorSilence);
  }
};

const stopListening = () => {
  if (!mediaRecorder || mediaRecorder.state !== "recording") return;
  log("Recording stop triggered.");
  mediaRecorder.stop();
};

const initAudioLoop = async () => {
  resetText();
  setStatus("Requesting microphone...");
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (error) {
    console.error(error);
    setStatus("Microphone permission denied.");
    return;
  }
  log("Microphone access granted.");

  const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
  if (AudioContextConstructor) {
    audioContext = new AudioContextConstructor();
    const source = audioContext.createMediaStreamSource(stream);
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;
    analyserData = new Uint8Array(analyser.fftSize);
    source.connect(analyser);
  }

  buildRecorder();
  setStatus("Listening...");
  startListening();
  if (!silenceMonitorId) {
    silenceMonitorId = requestAnimationFrame(monitorSilence);
  }
  scheduleIdleDino();
};

initAudioLoop();
