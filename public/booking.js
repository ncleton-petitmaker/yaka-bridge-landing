(function () {
  const TIMEZONE = "Europe/Paris";
  const DURATION_MINUTES = 30;
  const WEEKDAYS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

  const state = {
    ready: false,
    loading: false,
    submitting: false,
    error: "",
    calendarConnected: true,
    currentMonth: startOfMonth(new Date()),
    days: [],
    selectedDate: "",
    selectedTime: "",
    success: null,
    step: "calendar",
    form: {},
  };

  function startOfMonth(date) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 12, 0, 0));
  }

  function monthParam(date) {
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  }

  function monthLabel(date) {
    return capitalize(new Intl.DateTimeFormat("fr-FR", {
      month: "long",
      year: "numeric",
      timeZone: TIMEZONE,
    }).format(date));
  }

  function dateLabel(dateStr, options) {
    return new Intl.DateTimeFormat("fr-FR", {
      timeZone: TIMEZONE,
      ...options,
    }).format(new Date(`${dateStr}T12:00:00Z`));
  }

  function dateTimeLabel(iso) {
    return new Intl.DateTimeFormat("fr-FR", {
      weekday: "long",
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: TIMEZONE,
    }).format(new Date(iso));
  }

  function capitalize(value) {
    return value ? value.charAt(0).toUpperCase() + value.slice(1) : "";
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function zonedSlotToUtcIso(dateStr, timeStr) {
    const [hour, minute] = timeStr.split(":").map(Number);
    const guess = new Date(`${dateStr}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`);
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).formatToParts(guess).reduce((acc, part) => {
      if (part.type !== "literal") acc[part.type] = part.value;
      return acc;
    }, {});
    const asUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second)
    );
    return new Date(guess.getTime() - (asUtc - guess.getTime())).toISOString();
  }

  function ensureModal() {
    if (state.ready) return;
    document.body.insertAdjacentHTML("beforeend", `
      <div class="yb-booking-backdrop" id="yb-booking-backdrop" hidden>
        <section class="yb-booking-modal" role="dialog" aria-modal="true" aria-labelledby="yb-booking-title">
          <aside class="yb-booking-side">
            <div>
              <p class="yb-booking-kicker">Rendez-vous Yaka-Bridge</p>
              <h2>Cadrez votre premier module.</h2>
              <p>On part d'un workflow concret, on identifie le gain rapide, puis on voit comment Bridge peut connecter vos métiers à ChatGPT Codex ou à un modèle local.</p>
              <div class="yb-booking-meta" aria-label="Informations du rendez-vous">
                <span>30 minutes</span>
                <span>Visio Google Meet</span>
                <span>Fuseau Europe/Paris</span>
              </div>
            </div>
            <div class="yb-booking-brand">
              <img src="logo-options/yaka-bridge-app-icon-eyes-512.png?v=20260611-option2b" alt="">
              <span>yaka-bridge</span>
            </div>
          </aside>
          <div class="yb-booking-panel">
            <button class="yb-booking-close" type="button" data-booking-close aria-label="Fermer">×</button>
            <div class="yb-booking-content" id="yb-booking-content"></div>
          </div>
        </section>
      </div>
    `);
    state.ready = true;
  }

  function backdrop() {
    return document.getElementById("yb-booking-backdrop");
  }

  function content() {
    return document.getElementById("yb-booking-content");
  }

  async function openModal() {
    ensureModal();
    const root = backdrop();
    if (!root) return;
    root.hidden = false;
    document.body.classList.add("yb-booking-lock");
    root.querySelector("[data-booking-close]")?.focus({ preventScroll: true });
    if (!state.days.length) await fetchAvailability();
    render();
  }

  function closeModal() {
    const root = backdrop();
    if (!root) return;
    root.hidden = true;
    document.body.classList.remove("yb-booking-lock");
  }

  async function fetchAvailability() {
    state.loading = true;
    state.error = "";
    render();
    try {
      const response = await fetch(`/api/booking/availability?month=${monthParam(state.currentMonth)}&duration_minutes=${DURATION_MINUTES}`, {
        headers: { accept: "application/json" },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 503) {
          throw new Error("Le calendrier Yaka-Bridge n'est pas encore connecté. Aucun créneau n'est publié pour le moment.");
        }
        throw new Error(data.error || "Impossible de charger les créneaux.");
      }
      state.days = Array.isArray(data.days) ? data.days : [];
      state.calendarConnected = data.calendarConnected !== false;
      if (!state.days.some((day) => day.date === state.selectedDate)) {
        state.selectedDate = state.days[0]?.date || "";
      }
      state.selectedTime = "";
    } catch (error) {
      state.days = [];
      state.error = error.message || "Impossible de charger les créneaux.";
    } finally {
      state.loading = false;
      render();
    }
  }

  function slotsByDate() {
    return new Map(state.days.map((day) => [day.date, day.slots || []]));
  }

  function render() {
    const target = content();
    if (!target) return;
    if (state.loading) {
      target.innerHTML = `<div class="yb-booking-loader">Chargement des créneaux...</div>`;
      return;
    }
    if (state.step === "success") {
      target.innerHTML = renderSuccess();
      return;
    }
    if (state.step === "form") {
      target.innerHTML = renderForm();
      return;
    }
    target.innerHTML = renderCalendar();
  }

  function renderCalendar() {
    const selectedDateLabel = state.selectedDate
      ? capitalize(dateLabel(state.selectedDate, { weekday: "long", day: "numeric", month: "long" }))
      : "";
    const selectedSlots = slotsByDate().get(state.selectedDate) || [];
    return `
      <div class="yb-booking-topline">
        <h3 id="yb-booking-title">Choisir un créneau</h3>
        <p>Les disponibilités sont celles du calendrier Yaka-Bridge. Après validation, le rendez-vous est créé avec un lien Google Meet.</p>
        ${state.calendarConnected ? "" : `<div class="yb-booking-alert">Mode prévisualisation : le calendrier Google n'est pas encore connecté sur cet environnement.</div>`}
        ${state.error ? `<div class="yb-booking-alert" data-tone="danger">${escapeHtml(state.error)}</div>` : ""}
      </div>
      <div class="yb-booking-scheduler">
        <div>
          <div class="yb-booking-month">
            <strong>${escapeHtml(monthLabel(state.currentMonth))}</strong>
            <div class="yb-booking-icon-row">
              <button class="yb-booking-icon-btn" type="button" data-booking-month="-1" aria-label="Mois précédent">‹</button>
              <button class="yb-booking-icon-btn" type="button" data-booking-month="1" aria-label="Mois suivant">›</button>
            </div>
          </div>
          <div class="yb-booking-weekdays" aria-hidden="true">
            ${WEEKDAYS.map((day) => `<span>${day}</span>`).join("")}
          </div>
          <div class="yb-booking-grid">
            ${renderDayCells()}
          </div>
        </div>
        <div class="yb-booking-slots">
          ${state.selectedDate ? `
            <h4>${escapeHtml(selectedDateLabel)}</h4>
            <p>Heure locale France. Durée : ${DURATION_MINUTES} min.</p>
            ${selectedSlots.length ? `
              <div class="yb-booking-slot-list">
                ${selectedSlots.map((time) => `
                  <button class="yb-booking-slot" type="button" data-booking-time="${escapeHtml(time)}">
                    <span>${escapeHtml(time)}</span>
                    <span>Choisir</span>
                  </button>
                `).join("")}
              </div>
            ` : `<div class="yb-booking-muted">Aucun créneau disponible ce jour-là.</div>`}
          ` : `<div class="yb-booking-muted">Sélectionnez une date disponible.</div>`}
        </div>
      </div>
    `;
  }

  function renderDayCells() {
    const param = monthParam(state.currentMonth);
    const [year, month] = param.split("-").map(Number);
    const firstDay = new Date(Date.UTC(year, month - 1, 1, 12, 0, 0));
    const dayCount = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const firstOffset = (firstDay.getUTCDay() + 6) % 7;
    const available = slotsByDate();
    const cells = [];
    for (let i = 0; i < firstOffset; i += 1) {
      cells.push(`<span class="yb-booking-empty" aria-hidden="true"></span>`);
    }
    for (let day = 1; day <= dayCount; day += 1) {
      const dateStr = `${param}-${String(day).padStart(2, "0")}`;
      const hasSlots = available.has(dateStr);
      cells.push(`
        <button
          class="yb-booking-day"
          type="button"
          data-booking-date="${dateStr}"
          ${hasSlots ? "" : "disabled"}
          aria-pressed="${state.selectedDate === dateStr ? "true" : "false"}"
          aria-label="${escapeHtml(dateLabel(dateStr, { weekday: "long", day: "numeric", month: "long", year: "numeric" }))}"
        >${day}</button>
      `);
    }
    return cells.join("");
  }

  function renderForm() {
    const iso = zonedSlotToUtcIso(state.selectedDate, state.selectedTime);
    const summary = dateTimeLabel(iso);
    return `
      <div class="yb-booking-topline">
        <h3 id="yb-booking-title">Confirmer le rendez-vous</h3>
        <p>Un email de confirmation partira dès que le créneau sera inscrit dans le calendrier.</p>
        ${state.error ? `<div class="yb-booking-alert" data-tone="danger">${escapeHtml(state.error)}</div>` : ""}
      </div>
      <div class="yb-booking-summary">
        <span class="yb-booking-pill">${escapeHtml(capitalize(summary))}</span>
        <span class="yb-booking-pill">${DURATION_MINUTES} min</span>
        <span class="yb-booking-pill">Google Meet</span>
      </div>
      <form class="yb-booking-form" data-booking-form>
        <input type="hidden" name="slot_start" value="${escapeHtml(iso)}">
        <div class="yb-booking-field">
          <label for="yb-booking-name">Nom</label>
          <input id="yb-booking-name" name="name" autocomplete="name" value="${escapeHtml(state.form.name || "")}" required>
        </div>
        <div class="yb-booking-field">
          <label for="yb-booking-email">Email</label>
          <input id="yb-booking-email" name="email" type="email" autocomplete="email" value="${escapeHtml(state.form.email || "")}" required>
        </div>
        <div class="yb-booking-field">
          <label for="yb-booking-company">Entreprise</label>
          <input id="yb-booking-company" name="company" autocomplete="organization" value="${escapeHtml(state.form.company || "")}">
        </div>
        <div class="yb-booking-field">
          <label for="yb-booking-guests">Invités</label>
          <input id="yb-booking-guests" name="guests" placeholder="emails séparés par des virgules" value="${escapeHtml(state.form.guests || "")}">
        </div>
        <div class="yb-booking-field">
          <label for="yb-booking-notes">Contexte</label>
          <textarea id="yb-booking-notes" name="notes" placeholder="Le workflow à automatiser, vos outils actuels, ou ce qui vous bloque.">${escapeHtml(state.form.notes || "")}</textarea>
        </div>
        <div class="yb-booking-actions">
          <button class="yb-booking-btn" type="button" data-booking-back>Retour</button>
          <button class="yb-booking-btn" data-variant="primary" type="submit" ${state.submitting ? "disabled" : ""}>
            ${state.submitting ? "Confirmation..." : "Confirmer le rendez-vous"}
          </button>
        </div>
      </form>
    `;
  }

  function renderSuccess() {
    const start = state.success?.slot_start ? dateTimeLabel(state.success.slot_start) : "";
    const icsUrl = state.success ? createIcsUrl(state.success) : "";
    return `
      <div class="yb-booking-success">
        <div class="yb-booking-success-mark" aria-hidden="true">✓</div>
        <h3 id="yb-booking-title">Rendez-vous confirmé.</h3>
        <p>${start ? `Créneau réservé le ${escapeHtml(start)}.` : "Votre créneau est réservé."} La confirmation vient de partir par email.</p>
        <div class="yb-booking-actions">
          ${state.success?.meet_link ? `<a class="yb-booking-btn" data-variant="primary" href="${escapeHtml(state.success.meet_link)}" target="_blank" rel="noreferrer">Ouvrir Google Meet</a>` : ""}
          ${icsUrl ? `<a class="yb-booking-btn" href="${icsUrl}" download="yaka-bridge-rdv.ics">Ajouter au calendrier</a>` : ""}
          <button class="yb-booking-btn" type="button" data-booking-close>Fermer</button>
        </div>
      </div>
    `;
  }

  function createIcsUrl(success) {
    if (!success.slot_start || !success.slot_end) return "";
    const fmt = (iso) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Yaka-Bridge//Booking//FR",
      "BEGIN:VEVENT",
      `UID:${escapeIcs(success.event_id || `${Date.now()}-${Math.random().toString(36).slice(2)}`)}@yaka-bridge.com`,
      `DTSTAMP:${fmt(new Date().toISOString())}`,
      `DTSTART:${fmt(success.slot_start)}`,
      `DTEND:${fmt(success.slot_end)}`,
      "SUMMARY:Rendez-vous Yaka-Bridge",
      success.meet_link ? `LOCATION:${escapeIcs(success.meet_link)}` : "",
      success.meet_link ? `DESCRIPTION:${escapeIcs(`Google Meet: ${success.meet_link}`)}` : "",
      "END:VEVENT",
      "END:VCALENDAR",
    ].filter(Boolean);
    return URL.createObjectURL(new Blob([lines.join("\r\n")], { type: "text/calendar;charset=utf-8" }));
  }

  function escapeIcs(value) {
    return String(value || "").replace(/\\/g, "\\\\").replace(/,/g, "\\,").replace(/;/g, "\\;").replace(/\n/g, "\\n");
  }

  async function submitBooking(form) {
    const formData = new FormData(form);
    const payload = Object.fromEntries(formData.entries());
    state.form = payload;
    state.submitting = true;
    state.error = "";
    render();
    try {
      const response = await fetch("/api/booking/confirm", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 503) {
          throw new Error("Le calendrier Yaka-Bridge n'est pas encore connecté. Écrivez à nicolas.cleton@yaka-performance.com pour réserver ce créneau.");
        }
        if (response.status === 409) {
          throw new Error("Ce créneau vient d'être pris. Choisissez-en un autre.");
        }
        throw new Error(data.error || "Impossible de confirmer le rendez-vous.");
      }
      state.success = data;
      state.step = "success";
    } catch (error) {
      state.error = error.message || "Impossible de confirmer le rendez-vous.";
    } finally {
      state.submitting = false;
      render();
    }
  }

  document.addEventListener("click", async (event) => {
    const openTrigger = event.target.closest("[data-booking-open]");
    if (openTrigger) {
      event.preventDefault();
      await openModal();
      return;
    }

    const root = backdrop();
    if (!root || root.hidden) return;

    if (event.target === root || event.target.closest("[data-booking-close]")) {
      closeModal();
      return;
    }

    const monthButton = event.target.closest("[data-booking-month]");
    if (monthButton) {
      const delta = Number(monthButton.dataset.bookingMonth || 0);
      state.currentMonth = new Date(Date.UTC(
        state.currentMonth.getUTCFullYear(),
        state.currentMonth.getUTCMonth() + delta,
        1,
        12,
        0,
        0
      ));
      await fetchAvailability();
      return;
    }

    const dayButton = event.target.closest("[data-booking-date]");
    if (dayButton) {
      state.selectedDate = dayButton.dataset.bookingDate || "";
      state.selectedTime = "";
      state.error = "";
      render();
      return;
    }

    const timeButton = event.target.closest("[data-booking-time]");
    if (timeButton) {
      state.selectedTime = timeButton.dataset.bookingTime || "";
      state.error = "";
      state.form = {};
      state.step = "form";
      render();
      setTimeout(() => document.getElementById("yb-booking-name")?.focus(), 0);
      return;
    }

    if (event.target.closest("[data-booking-back]")) {
      state.step = "calendar";
      state.error = "";
      render();
    }
  });

  document.addEventListener("submit", async (event) => {
    const form = event.target.closest("[data-booking-form]");
    if (!form) return;
    event.preventDefault();
    await submitBooking(form);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && backdrop() && !backdrop().hidden) {
      closeModal();
    }
  });

  window.addEventListener("DOMContentLoaded", () => {
    if (window.location.hash === "#rdv") openModal();
  });
})();
