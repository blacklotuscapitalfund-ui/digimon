"use client";

import { useEffect, useRef } from "react";

export default function HomePage() {
  const statusRef = useRef<HTMLSpanElement>(null);
  const terminalRef = useRef<HTMLDivElement>(null);
  const hintRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const statusEl = statusRef.current;
    const terminalEl = terminalRef.current;
    const hintEl = hintRef.current;
    if (!statusEl || !terminalEl || !hintEl) return;

    let mediaRecorder: MediaRecorder | null = null;
    let chunks: Blob[] = [];
    let stream: MediaStream | null = null;
    let audioContext: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let analyserData: Uint8Array | null = null;
    let silenceMonitorId: number | null = null;
    let lastSoundTime = 0;
    let recordingStart = 0;
    let isListening = false;
    let isProcessing = false;
    let hasUserGesture = false;
    let soundDetected = false;
    let isSpeaking = false;
    let currentAudio: HTMLAudioElement | null = null;
    let idleDinoTimerId: number | null = null;
    let gestureHandler: (() => void) | null = null;

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

    const log = (message: string, details?: unknown) => {
      if (details === undefined) {
        console.log(`[voice] ${message}`);
      } else {
        console.log(`[voice] ${message}`, details);
      }
    };

    const setSpeakingState = (value: boolean) => {
      isSpeaking = value;
      document.body.classList.toggle("is-speaking", value);
    };

    const setStatus = (text: string) => {
      statusEl.textContent = text;
    };

    const setHint = (text: string, visible: boolean) => {
      hintEl.textContent = text;
      hintEl.hidden = !visible;
    };

    const appendLog = (role: "user" | "solamon" | "system", text: string) => {
      if (!text) return;
      const line = document.createElement("div");
      line.className = `line ${role}`;
      const label = document.createElement("span");
      label.className = "label";
      label.textContent = role === "user" ? "YOU" : role === "solamon" ? "SOLAMON" : "SYSTEM";
      const content = document.createElement("span");
      content.textContent = text;
      line.appendChild(label);
      line.appendChild(content);
      terminalEl.appendChild(line);
      terminalEl.scrollTop = terminalEl.scrollHeight;
    };

    const resetText = () => {
      terminalEl.textContent = "";
      appendLog("system", "Signal acquired. Awaiting your words.");
    };

    const waitForUserGesture = () => {
      if (hasUserGesture) return Promise.resolve();
      return new Promise<void>((resolve) => {
        gestureHandler = () => {
          hasUserGesture = true;
          if (audioContext && audioContext.state === "suspended") {
            audioContext.resume();
          }
          setHint("", false);
          if (gestureHandler) {
            document.removeEventListener("click", gestureHandler);
            gestureHandler = null;
          }
          resolve();
        };
        document.addEventListener("click", gestureHandler);
        setHint("Click anywhere once to enable audio playback.", true);
      });
    };

    const playAudio = async (base64Audio: string) => {
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

      await new Promise<void>((resolve) => {
        audio.addEventListener("ended", () => resolve(), { once: true });
        audio.addEventListener("pause", () => resolve(), { once: true });
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
        window.clearTimeout(idleDinoTimerId);
      }
      const delay =
        Math.floor(Math.random() * (idleDinoMaxMs - idleDinoMinMs + 1)) + idleDinoMinMs;
      idleDinoTimerId = window.setTimeout(async () => {
        const now = performance.now();
        const idleLongEnough = now - lastSoundTime > idleMinSilenceMs;
        if (!isProcessing && !isSpeaking && isListening && idleLongEnough) {
          await playDinoSound();
        }
        scheduleIdleDino();
      }, delay);
    };

    const buildRecorder = () => {
      if (!stream) return;
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
        if (silenceMonitorId !== null) {
          cancelAnimationFrame(silenceMonitorId);
        }
        silenceMonitorId = null;
        isListening = false;
        isProcessing = true;
        setStatus("Processing...");
        soundDetected = false;

        const blob = new Blob(chunks, { type: mediaRecorder?.mimeType || "audio/webm" });
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

          const data = (await response.json()) as {
            transcript?: string;
            reply?: string;
            audio?: string | null;
          };
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
          window.setTimeout(startListening, 1500);
        }
      };
    };

    const monitorSilence = () => {
      if (!analyser || !analyserData) return;

      analyser.getByteTimeDomainData(analyserData as Uint8Array);
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

        if (
          recordingFor > maxRecordingMs ||
          (recordingFor > minRecordingMs && silentFor > silenceMs)
        ) {
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
      if (silenceMonitorId === null) {
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
      if (silenceMonitorId === null) {
        silenceMonitorId = requestAnimationFrame(monitorSilence);
      }
      scheduleIdleDino();
    };

    initAudioLoop();

    return () => {
      if (silenceMonitorId !== null) {
        cancelAnimationFrame(silenceMonitorId);
      }
      if (idleDinoTimerId !== null) {
        window.clearTimeout(idleDinoTimerId);
      }
      if (mediaRecorder && mediaRecorder.state === "recording") {
        mediaRecorder.stop();
      }
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
      if (currentAudio) {
        currentAudio.pause();
        currentAudio.currentTime = 0;
      }
      if (audioContext && audioContext.state !== "closed") {
        audioContext.close();
      }
      if (gestureHandler) {
        document.removeEventListener("click", gestureHandler);
      }
      document.body.classList.remove("is-speaking");
    };
  }, []);

  return (
    <main className="matrix">
      <header className="hero">
        <p className="eyebrow">DIGITAL TERMINAL // HBIM</p>
        <h1>THE DIGITAL PASSWORD GUARDIAN MONSTER</h1>
      </header>

      <section className="terminal-stack">
        <div className="character-card">
          <div className="character-label">HBIM // Visual Link</div>
          <div className="hal-eye" aria-hidden="true">
            <div className="hal-eye-core"></div>
            <div className="hal-eye-ring"></div>
            <div className="hal-eye-glow"></div>
          </div>
          <img src="/Fudge_Monster.webp" alt="HBIM portrait" className="viewer hbim-portrait" />
        </div>

        <div className="terminal">
          <div className="terminal-header">
            <span>UNKNOWN_DIGIMON</span>
            <span className="terminal-dot"></span>
          </div>
          <div ref={terminalRef} className="terminal-log" aria-live="polite"></div>
          <div className="status-line">
            <span className="status-label">STATUS</span>
            <span ref={statusRef} className="status">
              Requesting microphone...
            </span>
          </div>
          <div ref={hintRef} className="hint" hidden>
            Click anywhere once to enable audio playback.
          </div>
        </div>
      </section>
    </main>
  );
}
