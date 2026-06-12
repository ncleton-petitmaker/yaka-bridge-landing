import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");
const PORT = Number(process.env.PORT || 80);
const SITE_URL = process.env.SITE_URL || "https://yaka-bridge.com";
const BOOKING_DURATION_MINUTES = Number(process.env.BOOKING_DURATION_MINUTES || 30);
const BOOKING_TIMEZONE = "Europe/Paris";
const GOOGLE_CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID || "primary";
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const BOOKING_EMAIL_FROM = process.env.BOOKING_EMAIL_FROM || "Nicolas Cléton <nicolas.cleton@yaka-performance.com>";
const BOOKING_NOTIFICATION_EMAIL = process.env.BOOKING_NOTIFICATION_EMAIL || "nicolas.cleton@yaka-performance.com";
const BOOKING_PREVIEW_SLOTS =
  process.env.BOOKING_PREVIEW_SLOTS === "true" ||
  (process.env.NODE_ENV !== "production" && process.env.BOOKING_PREVIEW_SLOTS !== "false");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
};

const WEEKLY_HOURS = {
  1: [{ start: "09:00", end: "17:00" }],
  2: [{ start: "09:00", end: "17:00" }],
  3: [{ start: "09:00", end: "17:00" }],
  4: [{ start: "09:00", end: "17:00" }],
  5: [{ start: "09:00", end: "12:00" }],
};

const rateLimits = new Map();
const AVAILABILITY_PATHS = new Set([
  "/api/booking/availability",
  "/.netlify/functions/booking-availability",
]);
const CONFIRM_PATHS = new Set([
  "/api/booking/confirm",
  "/.netlify/functions/booking-confirm",
]);

function json(res, statusCode, body) {
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function redirect(res, location) {
  res.writeHead(303, {
    location,
    "cache-control": "no-store",
  });
  res.end();
}

function getClientIp(req) {
  return String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown").split(",")[0].trim();
}

function isRateLimited(key, limit, windowMs) {
  const now = Date.now();
  const timestamps = (rateLimits.get(key) || []).filter((ts) => now - ts < windowMs);
  if (timestamps.length >= limit) return true;
  timestamps.push(now);
  rateLimits.set(key, timestamps);
  return false;
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 64_000) throw new Error("body-too-large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function isGoogleConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REFRESH_TOKEN);
}

async function getGoogleAccessToken() {
  if (!isGoogleConfigured()) return null;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
    }),
  });
  if (!response.ok) {
    console.error("[booking] Google token refresh failed:", await response.text());
    return null;
  }
  const data = await response.json();
  return data.access_token || null;
}

async function fetchFreeBusy(accessToken, timeMin, timeMax) {
  const response = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      timeMin,
      timeMax,
      timeZone: BOOKING_TIMEZONE,
      items: [{ id: GOOGLE_CALENDAR_ID }],
    }),
  });
  if (!response.ok) {
    throw new Error(`Google freeBusy failed: ${await response.text()}`);
  }
  const data = await response.json();
  return data.calendars?.[GOOGLE_CALENDAR_ID]?.busy || [];
}

async function createCalendarEvent(accessToken, params) {
  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(GOOGLE_CALENDAR_ID)}/events?conferenceDataVersion=1&sendUpdates=all`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        summary: `Rendez-vous Yaka-Bridge - ${params.name}`,
        description: [
          "Reserve via yaka-bridge.com",
          "",
          `Contact : ${params.name} <${params.email}>`,
          params.company ? `Entreprise : ${params.company}` : "",
          params.guests ? `Invites : ${params.guests}` : "",
          params.notes ? `Notes : ${params.notes}` : "",
        ].filter(Boolean).join("\n"),
        start: { dateTime: params.slotStart, timeZone: BOOKING_TIMEZONE },
        end: { dateTime: params.slotEnd, timeZone: BOOKING_TIMEZONE },
        attendees: [{ email: params.email, displayName: params.name }],
        conferenceData: {
          createRequest: {
            requestId: randomUUID(),
            conferenceSolutionKey: { type: "hangoutsMeet" },
          },
        },
      }),
    }
  );
  if (!response.ok) {
    throw new Error(`Google Calendar event creation failed: ${await response.text()}`);
  }
  const data = await response.json();
  return { eventId: data.id, meetLink: data.hangoutLink || data.conferenceData?.entryPoints?.[0]?.uri || "" };
}

function parisToUtc(dateStr, timeStr) {
  const [h, m] = timeStr.split(":").map(Number);
  const approx = new Date(`${dateStr}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`);
  const parisStr = approx.toLocaleString("en-US", { timeZone: BOOKING_TIMEZONE, hour12: false });
  const parisDate = new Date(`${parisStr} UTC`);
  const offsetMs = parisDate.getTime() - approx.getTime();
  return new Date(approx.getTime() - offsetMs);
}

function parisDayOfWeek(dateStr) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: BOOKING_TIMEZONE, weekday: "short" }).format(d);
  return { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[wd] || 0;
}

function monthDays(month) {
  const [year, mon] = month.split("-").map(Number);
  const days = [];
  const d = new Date(Date.UTC(year, mon - 1, 1));
  while (d.getUTCMonth() === mon - 1) {
    days.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return days;
}

function getAvailableSlots(month, busySlots, durationMinutes = BOOKING_DURATION_MINUTES) {
  const now = Date.now();
  const minTime = now + 24 * 3600_000;
  const maxTime = now + 60 * 86400_000;
  const busy = busySlots.map((slot) => ({
    start: new Date(slot.start).getTime(),
    end: new Date(slot.end).getTime(),
  }));
  const days = [];
  for (const dateStr of monthDays(month)) {
    const windows = WEEKLY_HOURS[parisDayOfWeek(dateStr)];
    if (!windows) continue;
    const slots = [];
    for (const window of windows) {
      const [startH, startM] = window.start.split(":").map(Number);
      const [endH, endM] = window.end.split(":").map(Number);
      for (let slotMin = startH * 60 + startM; slotMin + durationMinutes <= endH * 60 + endM; slotMin += BOOKING_DURATION_MINUTES) {
        const timeStr = `${String(Math.floor(slotMin / 60)).padStart(2, "0")}:${String(slotMin % 60).padStart(2, "0")}`;
        const slotStart = parisToUtc(dateStr, timeStr);
        const slotEnd = new Date(slotStart.getTime() + durationMinutes * 60_000);
        if (slotStart.getTime() < minTime || slotStart.getTime() > maxTime) continue;
        if (busy.some((b) => slotStart.getTime() < b.end && slotEnd.getTime() > b.start)) continue;
        slots.push(timeStr);
      }
    }
    if (slots.length) days.push({ date: dateStr, slots });
  }
  return days;
}

function formatParis(iso, options) {
  return new Intl.DateTimeFormat("fr-FR", { timeZone: BOOKING_TIMEZONE, ...options }).format(new Date(iso));
}

function getParisDateTime(iso) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BOOKING_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso)).reduce((acc, part) => {
    if (part.type !== "literal") acc[part.type] = part.value;
    return acc;
  }, {});
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

function bookingEmailHtml(params) {
  const date = formatParis(params.slotStart, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const startTime = formatParis(params.slotStart, { hour: "2-digit", minute: "2-digit" });
  const endTime = formatParis(params.slotEnd, { hour: "2-digit", minute: "2-digit" });
  return `<!doctype html><html lang="fr"><body style="margin:0;background:#faf9f7;color:#1a1916;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#faf9f7;padding:32px 16px;"><tr><td align="center">
    <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
      <tr><td style="background:#2A211B;border-radius:14px 14px 0 0;padding:22px 28px;color:#fff;"><strong style="font-size:18px;">Yaka-Bridge</strong></td></tr>
      <tr><td style="background:#fff;border:1px solid #ebe8e1;border-top:0;padding:30px 28px;">
        <p style="font-size:15px;line-height:1.6;margin:0 0 18px;">Bonjour ${escapeHtml(params.name)},</p>
        <p style="font-size:15px;line-height:1.6;margin:0 0 24px;">Votre rendez-vous Yaka-Bridge est confirme.</p>
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f2ed;border-radius:10px;border-left:4px solid #c96442;"><tr><td style="padding:18px 22px;">
          <p style="margin:0 0 8px;font-size:15px;"><strong>${date}</strong></p>
          <p style="margin:0;color:#74716b;font-size:14px;">${startTime} - ${endTime} · ${BOOKING_DURATION_MINUTES} min</p>
          ${params.meetLink ? `<p style="margin:14px 0 0;"><a href="${params.meetLink}" style="color:#1a1916;font-weight:700;">Rejoindre la visioconference</a></p>` : ""}
        </td></tr></table>
        <p style="font-size:14px;line-height:1.6;color:#74716b;margin:22px 0 0;">Pour modifier ou annuler, repondez simplement a cet email.</p>
      </td></tr>
      <tr><td style="background:#fff;border:1px solid #ebe8e1;border-top:0;border-radius:0 0 14px 14px;padding:18px 28px;color:#74716b;font-size:13px;">Nicolas Cleton · Yaka-Bridge</td></tr>
    </table>
  </td></tr></table></body></html>`;
}

function notificationEmailHtml(params) {
  return `Nouveau rendez-vous Yaka-Bridge<br><br>
  Nom: ${escapeHtml(params.name)}<br>
  Email: ${escapeHtml(params.email)}<br>
  Entreprise: ${escapeHtml(params.company || "-")}<br>
  Creneau: ${escapeHtml(params.slotStart)}<br>
  Invites: ${escapeHtml(params.guests || "-")}<br>
  Notes: ${escapeHtml(params.notes || "-")}<br>
  Meet: ${params.meetLink ? `<a href="${params.meetLink}">${params.meetLink}</a>` : "-"}`;
}

function guestEmailHtml(params) {
  const date = formatParis(params.slotStart, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const startTime = formatParis(params.slotStart, { hour: "2-digit", minute: "2-digit" });
  const endTime = formatParis(params.slotEnd, { hour: "2-digit", minute: "2-digit" });
  return `<!doctype html><html lang="fr"><body style="margin:0;background:#faf9f7;color:#1a1916;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#faf9f7;padding:32px 16px;"><tr><td align="center">
    <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
      <tr><td style="background:#2A211B;border-radius:14px 14px 0 0;padding:22px 28px;color:#fff;"><strong style="font-size:18px;">Yaka-Bridge</strong></td></tr>
      <tr><td style="background:#fff;border:1px solid #ebe8e1;border-top:0;border-radius:0 0 14px 14px;padding:30px 28px;">
        <p style="font-size:15px;line-height:1.6;margin:0 0 18px;">${escapeHtml(params.inviterName)} vous invite à un rendez-vous Yaka-Bridge.</p>
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f2ed;border-radius:10px;border-left:4px solid #c96442;"><tr><td style="padding:18px 22px;">
          <p style="margin:0 0 8px;font-size:15px;"><strong>${date}</strong></p>
          <p style="margin:0;color:#74716b;font-size:14px;">${startTime} - ${endTime} · ${BOOKING_DURATION_MINUTES} min</p>
          ${params.meetLink ? `<p style="margin:14px 0 0;"><a href="${params.meetLink}" style="color:#1a1916;font-weight:700;">Rejoindre la visioconférence</a></p>` : ""}
        </td></tr></table>
      </td></tr>
    </table>
  </td></tr></table></body></html>`;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function sendResendEmail(message) {
  if (!RESEND_API_KEY) return false;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${RESEND_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(message),
  });
  if (!response.ok) {
    console.error("[booking] Resend email failed:", await response.text());
    return false;
  }
  return true;
}

async function handleAvailability(req, res, url) {
  const ip = getClientIp(req);
  if (isRateLimited(`availability:${ip}`, 30, 60_000)) return json(res, 429, { error: "Too many requests" });
  const month = url.searchParams.get("month") || "";
  const durationMinutes = Number(url.searchParams.get("duration_minutes") || BOOKING_DURATION_MINUTES);
  if (!/^\d{4}-\d{2}$/.test(month)) return json(res, 400, { error: "Missing or invalid month parameter" });
  if (!Number.isFinite(durationMinutes) || durationMinutes < 15 || durationMinutes > 240) {
    return json(res, 400, { error: "Invalid duration_minutes parameter" });
  }

  let busySlots = [];
  const accessToken = await getGoogleAccessToken();
  if (accessToken) {
    const [year, mon] = month.split("-").map(Number);
    const timeMin = new Date(Date.UTC(year, mon - 1, 0)).toISOString();
    const timeMax = new Date(Date.UTC(year, mon, 1)).toISOString();
    try {
      busySlots = await fetchFreeBusy(accessToken, timeMin, timeMax);
    } catch (err) {
      console.error("[booking] Google freeBusy failed:", err);
      return json(res, 502, { error: "Calendar availability is unavailable" });
    }
  } else if (!BOOKING_PREVIEW_SLOTS) {
    return json(res, 503, { error: "Booking calendar is not connected yet" });
  }

  json(res, 200, {
    days: getAvailableSlots(month, busySlots, durationMinutes),
    calendarConnected: Boolean(accessToken),
  });
}

async function handleConfirm(req, res) {
  const ip = getClientIp(req);
  if (isRateLimited(`confirm:${ip}`, 8, 60 * 60_000)) return json(res, 429, { error: "Too many requests" });

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return json(res, 400, { error: "Invalid JSON" });
  }

  const name = clean(body.name);
  const email = clean(body.email).toLowerCase();
  const company = clean(body.company);
  const guests = clean(body.guests);
  const guestEmails = parseGuestEmails(guests).filter((guestEmail) => guestEmail !== email);
  const notes = clean(body.notes);
  const slotStartRaw = clean(body.slot_start);
  if (!name || !email || !slotStartRaw) return json(res, 400, { error: "Missing required fields" });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(res, 400, { error: "Invalid email format" });

  const slotStart = new Date(slotStartRaw);
  if (Number.isNaN(slotStart.getTime())) return json(res, 400, { error: "Invalid slot_start" });
  const slotEnd = new Date(slotStart.getTime() + BOOKING_DURATION_MINUTES * 60_000);

  const accessToken = await getGoogleAccessToken();
  if (!accessToken) return json(res, 503, { error: "Booking calendar is not connected yet" });

  let busySlots;
  try {
    busySlots = await fetchFreeBusy(accessToken, slotStart.toISOString(), slotEnd.toISOString());
  } catch (err) {
    console.error("[booking] Google freeBusy failed:", err);
    return json(res, 502, { error: "Calendar availability is unavailable" });
  }
  if (busySlots.length) return json(res, 409, { error: "This slot is no longer available" });
  const parisSlot = getParisDateTime(slotStart.toISOString());
  const allowedSlots = getAvailableSlots(parisSlot.date.slice(0, 7), busySlots, BOOKING_DURATION_MINUTES)
    .find((day) => day.date === parisSlot.date)?.slots || [];
  if (!allowedSlots.includes(parisSlot.time)) {
    return json(res, 400, { error: "This slot is outside booking hours" });
  }

  let event;
  try {
    event = await createCalendarEvent(accessToken, {
      name,
      email,
      company,
      guests,
      notes,
      slotStart: slotStart.toISOString(),
      slotEnd: slotEnd.toISOString(),
    });
  } catch (err) {
    console.error("[booking] Calendar event creation failed:", err);
    return json(res, 500, { error: "Failed to create calendar event" });
  }

  const params = {
    name,
    email,
    company,
    guests,
    notes,
    slotStart: slotStart.toISOString(),
    slotEnd: slotEnd.toISOString(),
    meetLink: event.meetLink,
  };
  await sendResendEmail({
    from: BOOKING_EMAIL_FROM,
    to: [email],
    subject: "Confirmation - Rendez-vous Yaka-Bridge",
    html: bookingEmailHtml(params),
  });
  await sendResendEmail({
    from: BOOKING_EMAIL_FROM,
    to: [BOOKING_NOTIFICATION_EMAIL],
    reply_to: email,
    subject: `Nouveau rendez-vous Yaka-Bridge - ${name}`,
    html: notificationEmailHtml(params),
  });
  for (const guestEmail of guestEmails) {
    await sendResendEmail({
      from: BOOKING_EMAIL_FROM,
      to: [guestEmail],
      subject: `Invitation - Rendez-vous Yaka-Bridge avec ${name}`,
      html: guestEmailHtml({ ...params, inviterName: name }),
    });
  }

  json(res, 200, {
    success: true,
    meet_link: event.meetLink,
    slot_start: slotStart.toISOString(),
    slot_end: slotEnd.toISOString(),
    event_id: event.eventId,
  });
}

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function parseGuestEmails(value) {
  return [...new Set(String(value || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))];
}

async function serveStatic(req, res, url) {
  if (url.pathname === "/health") {
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    res.end("ok\n");
    return;
  }

  const decoded = decodeURIComponent(url.pathname);
  const safePath = decoded === "/" ? "/index.html" : decoded;
  let filePath = path.normalize(path.join(PUBLIC_DIR, safePath));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const info = await stat(filePath);
    if (info.isDirectory()) filePath = path.join(filePath, "index.html");
  } catch {
    filePath = path.join(PUBLIC_DIR, "index.html");
  }

  try {
    const data = await readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const immutable = /\.(?:css|js|svg|png|jpg|jpeg|webp|ico|woff2?)$/i.test(filePath);
    res.writeHead(200, {
      "content-type": MIME_TYPES[ext] || "application/octet-stream",
      "x-content-type-options": "nosniff",
      "x-frame-options": "SAMEORIGIN",
      "referrer-policy": "strict-origin-when-cross-origin",
      "permissions-policy": "camera=(), microphone=(), geolocation=()",
      "cache-control": immutable ? "public, max-age=2592000, immutable" : "no-cache",
    });
    res.end(data);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

createServer(async (req, res) => {
  const url = new URL(req.url || "/", SITE_URL);
  try {
    if (req.method === "GET" && AVAILABILITY_PATHS.has(url.pathname)) {
      await handleAvailability(req, res, url);
      return;
    }
    if (req.method === "POST" && CONFIRM_PATHS.has(url.pathname)) {
      await handleConfirm(req, res);
      return;
    }
    if (req.method === "GET" && CONFIRM_PATHS.has(url.pathname)) {
      const accept = String(req.headers.accept || "");
      if (accept.includes("text/html")) {
        redirect(res, "/#rdv");
      } else {
        json(res, 405, { error: "Use POST to confirm a booking" });
      }
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      json(res, 404, { error: "Not found" });
      return;
    }
    await serveStatic(req, res, url);
  } catch (err) {
    console.error("[server] Unhandled error:", err);
    json(res, 500, { error: "Internal server error" });
  }
}).listen(PORT, () => {
  console.log(`[yaka-bridge-landing] listening on :${PORT}`);
});
