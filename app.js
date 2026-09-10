/**
 * PediaTrack — Encuesta Conversacional de Viabilidad
 * Lógica de navegación, grabación de audio nativa y envío a Google Sheets / Drive
 */

// ==========================================================
// CONFIGURACIÓN
// Webhook endpoint generado en Google Apps Script
const GOOGLE_APPS_SCRIPT_URL = typeof atob === "function" 
  ? atob("aHR0cHM6Ly9zY3JpcHQuZ29vZ2xlLmNvbS9tYWNyb3Mvcy9BS2Z5Y2J4bURjVzhsUWRCRmpxcHFPLThYUi1ycnNhalp0THFJZGE5dDlnekVTVy1Sa05aZTJ4c3ZZS3BzS2N6Vk9rQ0Q2cmUvZXhlYw==")
  : ""; 

// Estado global de la encuesta
const state = {
  role: null, // 'padre' | 'profesional'
  currentStepIndex: 0,
  steps: [],
  responses: {
    fecha_envio: new Date().toISOString(),
    origen_url: window.location.href,
  },
  audioBlob: null,
  audioBase64: null,
};

// ==========================================================
// SECUENCIA DE PASOS Y RAMIFICACIONES
// ==========================================================
const STEPS_PADRE_COMPLETO = [
  "step-0",
  "step-p1",
  "step-p2",
  "step-p3",
  "step-p4",
  "step-p-guardia",
  "step-p-docs-tipos",
  "step-p-docs-desorden",
  "step-p5",
  "step-p6",
  "step-p-modelo",
  "step-p7"
];

// Flujo acotado si en los últimos 3 meses no hubo tratamiento prolongado
const STEPS_PADRE_SIN_TRATAMIENTO = [
  "step-0",
  "step-p1",
  "step-p-guardia",
  "step-p-docs-tipos",
  "step-p-docs-desorden",
  "step-p5",
  "step-p6",
  "step-p-modelo",
  "step-p7"
];

const STEPS_PROFESIONAL = [
  "step-0",
  "step-m1",
  "step-m-datos",
  "step-m2",
  "step-m3",
  "step-m4",
  "step-m5"
];

// ==========================================================
// INICIALIZACIÓN
// ==========================================================
document.addEventListener("DOMContentLoaded", () => {
  setupRoleSelection();
  setupOptionButtons();
  setupMultiSelect();
  setupAudioRecorder("p"); // Audio recorder para padres
  setupAudioRecorder("m"); // Audio recorder para profesionales
  setupNavigationButtons();
  setupBackButton();
  setupCtaSubmissions();
  setupShareButton();
  updateProgress();
});

// ==========================================================
// SELECCIÓN DE ROL Y RUTAS
// ==========================================================
function setupRoleSelection() {
  const roleButtons = document.querySelectorAll(".role-btn");
  roleButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      const selectedRole = btn.dataset.role;
      state.role = selectedRole;
      state.responses.rol = selectedRole === "padre" ? "Mamá/Papá/Cuidador" : "Profesional de la Salud";

      // Ocultar pantalla de bienvenida y activar el flujo correspondiente
      document.getElementById("step-0").classList.remove("active");
      
      if (selectedRole === "padre") {
        document.getElementById("flow-padres").style.display = "block";
        state.steps = [...STEPS_PADRE_COMPLETO];
      } else {
        document.getElementById("flow-profesionales").style.display = "block";
        state.steps = [...STEPS_PROFESIONAL];
      }

      state.currentStepIndex = 1; // Avanzar al primer paso del rol
      showCard(state.steps[state.currentStepIndex]);
      updateProgress();
    });
  });
}

// ==========================================================
// BOTONES DE OPCIÓN (PREGUNTAS CERRADAS - SELECCIÓN ÚNICA)
// ==========================================================
function setupOptionButtons() {
  const optionButtons = document.querySelectorAll(".btn-option:not(.role-btn):not(.multi-option)");
  
  optionButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.key;
      const val = btn.dataset.val;

      // Deseleccionar otros botones en el mismo grupo
      const parentGroup = btn.closest(".options-group");
      if (parentGroup) {
        parentGroup.querySelectorAll(".btn-option").forEach(b => b.classList.remove("selected"));
      }
      btn.classList.add("selected");

      // Guardar respuesta
      if (key && val) {
        state.responses[key] = val;
      }

      // Ramificación para Pregunta 1 (Padres): si no hubo tratamiento, omitir P2, P3, P4
      if (key === "frecuencia_tratamientos") {
        const hasTreatment = btn.dataset.hasTreatment === "true";
        state.steps = hasTreatment ? [...STEPS_PADRE_COMPLETO] : [...STEPS_PADRE_SIN_TRATAMIENTO];
      }

      // Adaptación contextual de Pregunta 3 según si es cuidador único o compartido
      if (key === "cantidad_cuidadores") {
        const p3Title = document.getElementById("p3Title");
        const p3Subtitle = document.getElementById("p3Subtitle");
        if (val === "1") {
          if (p3Title) p3Title.textContent = "¿Alguna vez te pasó dudar si ya le habías dado la dosis por el cansancio o la rutina?";
          if (p3Subtitle) p3Subtitle.innerHTML = "Ese momento de agotamiento en el que no recordás con seguridad si pasaron 6 u 8 horas o si ya tomó el remedio.";
        } else {
          if (p3Title) p3Title.textContent = "¿Alguna vez te pasó no saber con certeza si ya se le había dado una dosis o dudar del horario?";
          if (p3Subtitle) p3Subtitle.innerHTML = "Ese momento típico de: <em>'¿Se lo diste vos o se lo doy yo?'</em> o miedo a duplicar.";
        }
      }

      // Comportamiento especial en paso CTA (P7 o M5)
      if (key === "quiere_beta") {
        handleBetaCta(val);
        return;
      }
      if (key === "quiere_alianza") {
        handleAlianzaCta(val);
        return;
      }

      // En preguntas normales: avanzar automáticamente tras 220ms de feedback visual
      setTimeout(() => {
        goToNextStep();
      }, 220);
    });
  });
}

// ==========================================================
// SELECCIÓN MÚLTIPLE (CHECKBOXES CON BOTÓN CONTINUAR)
// ==========================================================
function setupMultiSelect() {
  const multiOptions = document.querySelectorAll(".multi-option");
  multiOptions.forEach(opt => {
    opt.addEventListener("click", () => {
      const isExclusive = opt.dataset.exclusive === "true";
      const parentGroup = opt.closest(".options-group");

      if (isExclusive) {
        // Desmarcar todas las demás opciones si elige la exclusiva
        parentGroup.querySelectorAll(".multi-option").forEach(o => {
          if (o !== opt) o.classList.remove("selected");
        });
        opt.classList.toggle("selected");
      } else {
        // Desmarcar cualquier opción exclusiva si elige una normal
        const exclusiveOpt = parentGroup.querySelector('.multi-option[data-exclusive="true"]');
        if (exclusiveOpt) exclusiveOpt.classList.remove("selected");
        opt.classList.toggle("selected");
      }
    });
  });

  const nextMultiButtons = document.querySelectorAll(".btn-next-multi");
  nextMultiButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      const targetKey = btn.dataset.targetKey;
      const parentCard = btn.closest(".card");
      if (!parentCard) return;

      const selectedOpts = parentCard.querySelectorAll(".multi-option.selected");
      if (selectedOpts.length === 0) {
        alert("Por favor seleccioná al menos una opción para continuar.");
        return;
      }

      const values = Array.from(selectedOpts).map(o => o.dataset.val);
      state.responses[targetKey] = values.join("; ");
      goToNextStep();
    });
  });
}

function handleBetaCta(val) {
  const contactBox = document.getElementById("contactFields-p");
  if (val.includes("Sí")) {
    contactBox.style.display = "flex";
    contactBox.scrollIntoView({ behavior: "smooth" });
  } else {
    contactBox.style.display = "none";
    // Envío directo si respondió que no
    submitData();
  }
}

function handleAlianzaCta(val) {
  const contactBox = document.getElementById("contactFields-m");
  if (val.includes("Sí") || val.includes("adelante")) {
    contactBox.style.display = "flex";
    contactBox.scrollIntoView({ behavior: "smooth" });
  } else {
    contactBox.style.display = "none";
    submitData();
  }
}

// ==========================================================
// NAVEGACIÓN ENTRE TARJETAS
// ==========================================================
function showCard(cardId) {
  document.querySelectorAll(".card").forEach(c => c.classList.remove("active"));
  const target = document.getElementById(cardId);
  if (target) {
    target.classList.add("active");

    // Actualizar badge de número de pregunta según posición real en el flujo activo
    const badge = target.querySelector(".step-badge:not(.highlight-badge)");
    if (badge && state.currentStepIndex > 0) {
      if (cardId === "step-p5") {
        badge.textContent = `Pregunta ${state.currentStepIndex} (Experiencia real)`;
      } else if (state.role === "profesional") {
        badge.textContent = `Pregunta ${state.currentStepIndex} (Profesional)`;
      } else {
        badge.textContent = `Pregunta ${state.currentStepIndex}`;
      }
    }

    window.scrollTo({ top: 0, behavior: "smooth" });
  }
}

function goToNextStep() {
  if (state.currentStepIndex < state.steps.length - 1) {
    state.currentStepIndex++;
    showCard(state.steps[state.currentStepIndex]);
    updateProgress();
  }
}

function goToPreviousStep() {
  if (state.currentStepIndex > 1) {
    state.currentStepIndex--;
    showCard(state.steps[state.currentStepIndex]);
    updateProgress();
  } else if (state.currentStepIndex === 1) {
    // Volver a la pantalla de bienvenida y selección de rol
    state.currentStepIndex = 0;
    state.role = null;
    state.steps = [];
    const flowPadres = document.getElementById("flow-padres");
    const flowProf = document.getElementById("flow-profesionales");
    if (flowPadres) flowPadres.style.display = "none";
    if (flowProf) flowProf.style.display = "none";
    showCard("step-0");
    updateProgress();
  }
}

function setupBackButton() {
  const btnBack = document.getElementById("btnBack");
  if (btnBack) {
    btnBack.addEventListener("click", () => {
      goToPreviousStep();
    });
  }
}

function updateProgress() {
  const progressBar = document.getElementById("progressBar");
  const stepIndicator = document.getElementById("stepIndicator");
  const btnBack = document.getElementById("btnBack");

  // Control de visibilidad del botón volver
  if (btnBack) {
    btnBack.style.display = state.currentStepIndex > 0 ? "inline-flex" : "none";
  }

  if (!state.steps.length) {
    progressBar.style.width = "5%";
    stepIndicator.textContent = "Progreso: 0%";
    return;
  }

  const total = state.steps.length - 1; // Excluyendo la bienvenida
  const current = state.currentStepIndex;
  const percent = Math.min(100, Math.round((current / total) * 100));

  progressBar.style.width = `${Math.max(8, percent)}%`;
  stepIndicator.textContent = `Progreso: ${percent}%`;
}

function setupNavigationButtons() {
  // Botón continuar en paso de audio Padre
  const btnNextP5 = document.getElementById("btnNext-p5");
  if (btnNextP5) {
    btnNextP5.addEventListener("click", () => {
      const textVal = document.getElementById("textResponse-p").value.trim();
      if (textVal) {
        state.responses.anecdota_texto = textVal;
      }
      goToNextStep();
    });
  }

  // Botón continuar en paso de audio Profesional
  const btnNextM3 = document.getElementById("btnNext-m3");
  if (btnNextM3) {
    btnNextM3.addEventListener("click", () => {
      const textVal = document.getElementById("textResponse-m").value.trim();
      if (textVal) {
        state.responses.anecdota_texto_profesional = textVal;
      }
      goToNextStep();
    });
  }
}

// ==========================================================
// GRABADOR DE AUDIO NATIVO (MediaRecorder)
// ==========================================================
function setupAudioRecorder(suffix) {
  const recordBtn = document.getElementById(`recordBtn-${suffix}`);
  const recordText = document.getElementById(`recordText-${suffix}`);
  const timerDisplay = document.getElementById(`recordTimer-${suffix}`);
  const previewBox = document.getElementById(`audioPreview-${suffix}`);
  const audioPlayer = document.getElementById(`audioPlayer-${suffix}`);
  const retryBtn = document.getElementById(`retryAudio-${suffix}`);

  if (!recordBtn) return;

  let mediaRecorder = null;
  let audioChunks = [];
  let timerInterval = null;
  let secondsElapsed = 0;
  const MAX_SECONDS = 60; // 1 minuto máximo para mantener audios ágiles

  recordBtn.addEventListener("click", async () => {
    if (mediaRecorder && mediaRecorder.state === "recording") {
      stopRecording();
    } else {
      await startRecording();
    }
  });

  retryBtn.addEventListener("click", () => {
    previewBox.style.display = "none";
    recordBtn.style.display = "inline-flex";
    recordText.textContent = "Grabar nota de voz (hasta 60 seg)";
    state.audioBlob = null;
    state.audioBase64 = null;
  });

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunks = [];
      secondsElapsed = 0;

      // Configurar tipo de audio compatible (WebM preferido en Android/Chrome, MP4/WAV en Safari)
      let options = {};
      if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
        options = { mimeType: "audio/webm;codecs=opus" };
      } else if (MediaRecorder.isTypeSupported("audio/mp4")) {
        options = { mimeType: "audio/mp4" };
      }

      mediaRecorder = new MediaRecorder(stream, options);

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunks.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        clearInterval(timerInterval);
        timerDisplay.style.display = "none";
        recordBtn.classList.remove("recording");
        stream.getTracks().forEach(track => track.stop());

        const mime = mediaRecorder.mimeType || "audio/webm";
        const blob = new Blob(audioChunks, { type: mime });
        state.audioBlob = blob;

        // Convertir a base64 para envío a Google Drive / Sheets
        const reader = new FileReader();
        reader.readAsDataURL(blob);
        reader.onloadend = () => {
          state.audioBase64 = reader.result; // DataURL completa con cabecera
          state.responses.tiene_audio = "Sí";
        };

        // Mostrar reproductor
        const audioUrl = URL.createObjectURL(blob);
        audioPlayer.src = audioUrl;
        previewBox.style.display = "flex";
        recordBtn.style.display = "none";
      };

      mediaRecorder.start();
      recordBtn.classList.add("recording");
      recordText.textContent = "⏹️ Detener grabación";
      timerDisplay.style.display = "block";
      timerDisplay.textContent = "00:00";

      timerInterval = setInterval(() => {
        secondsElapsed++;
        const mins = String(Math.floor(secondsElapsed / 60)).padStart(2, "0");
        const secs = String(secondsElapsed % 60).padStart(2, "0");
        timerDisplay.textContent = `${mins}:${secs}`;

        if (secondsElapsed >= MAX_SECONDS) {
          stopRecording();
        }
      }, 1000);

    } catch (err) {
      console.error("Error al acceder al micrófono:", err);
      alert("No se pudo acceder al micrófono. Podés escribir tu respuesta en el campo de texto.");
      const textarea = document.getElementById(`textResponse-${suffix}`);
      if (textarea) {
        textarea.focus();
      }
    }
  }

  function stopRecording() {
    if (mediaRecorder && mediaRecorder.state === "recording") {
      mediaRecorder.stop();
    }
  }
}

// ==========================================================
// ENVÍO DE DATOS Y FINALIZACIÓN
// ==========================================================
function setupCtaSubmissions() {
  const submitP = document.getElementById("btnSubmit-p");
  if (submitP) {
    submitP.addEventListener("click", () => {
      const name = document.getElementById("contactName-p").value.trim();
      const wa = document.getElementById("contactWa-p").value.trim();
      const email = document.getElementById("contactEmail-p")?.value.trim() || "";
      state.responses.nombre_contacto = name || "No especificado";
      state.responses.whatsapp_contacto = wa || "No especificado";
      state.responses.email_contacto = email || "No especificado";
      submitData();
    });
  }

  const submitM = document.getElementById("btnSubmit-m");
  if (submitM) {
    submitM.addEventListener("click", () => {
      const name = document.getElementById("contactName-m").value.trim();
      const wa = document.getElementById("contactWa-m").value.trim();
      const email = document.getElementById("contactEmail-m")?.value.trim() || "";
      state.responses.nombre_contacto = name || "No especificado";
      state.responses.whatsapp_contacto = wa || "No especificado";
      state.responses.email_contacto = email || "No especificado";
      submitData();
    });
  }
}

async function submitData() {
  // Mostrar pantalla final con feedback inmediato
  const flowPadres = document.getElementById("flow-padres");
  const flowProf = document.getElementById("flow-profesionales");
  if (flowPadres) flowPadres.style.display = "none";
  if (flowProf) flowProf.style.display = "none";
  
  const stepGracias = document.getElementById("step-gracias");
  stepGracias.style.display = "flex";
  stepGracias.classList.add("active");

  const btnBack = document.getElementById("btnBack");
  if (btnBack) btnBack.style.display = "none";

  const progressBar = document.getElementById("progressBar");
  progressBar.style.width = "100%";
  document.getElementById("stepIndicator").textContent = "Progreso: 100%";

  // Preparar payload consolidado
  const payload = {
    ...state.responses,
    audioBase64: state.audioBase64 || null,
    audioMime: state.audioBlob ? state.audioBlob.type : null,
  };

  console.log("📦 Respuestas registradas:", payload);

  // Si hay URL de Google Apps Script configurada, enviar vía POST
  if (GOOGLE_APPS_SCRIPT_URL && GOOGLE_APPS_SCRIPT_URL.startsWith("https://script.google.com")) {
    try {
      await fetch(GOOGLE_APPS_SCRIPT_URL, {
        method: "POST",
        mode: "no-cors", // Requerido por Google Apps Script redirects
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      console.log("✅ Datos enviados con éxito a Google Apps Script.");
    } catch (err) {
      console.error("Error al enviar a Google Apps Script:", err);
    }
  } else {
    console.warn("⚠️ AVISO: Aún no configuraste GOOGLE_APPS_SCRIPT_URL en app.js. Los datos se mostraron arriba en la consola para prueba local.");
  }
}

// ==========================================================
// COMPARTIR POR WHATSAPP
// ==========================================================
function setupShareButton() {
  const shareBtn = document.getElementById("btnShareWa");
  if (shareBtn) {
    const shareText = encodeURIComponent(
      "Hola! Te comparto esta breve encuesta de 2 minutos sobre cómo coordinar remedios y salud en los chicos. Ayuda un montón a la investigación de PediaTrack: " + window.location.href
    );
    shareBtn.href = `https://wa.me/?text=${shareText}`;
  }
}
