// Generic Resend sender — the one place that actually talks to Resend's
// API. Requires RESEND_API_KEY (and optionally RESEND_FROM_EMAIL) in env
// vars. Every other email in the app should call this rather than hitting
// fetch() directly, so sender config and error handling stay in one place.
export async function sendEmail(to: string, subject: string, html: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM_EMAIL ?? "Nestegg <onboarding@resend.dev>",
      to,
      subject,
      html,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend failed: ${body}`);
  }
}

// Sends the OTP verification email.
export async function sendOtpEmail(to: string, code: string) {
  await sendEmail(
    to,
    `${code} is your Nestegg verification code`,
    `
      <div style="font-family: sans-serif; max-width: 400px; margin: 0 auto;">
        <h2 style="color:#0B2E5C;">Verify your email</h2>
        <p style="color:#5B6B85;">Enter this code to continue. It expires in 10 minutes.</p>
        <p style="font-size: 32px; font-weight: 800; letter-spacing: 8px; color:#1B4FC4;">${code}</p>
        <p style="color:#5B6B85; font-size: 12px;">If you didn't request this, you can ignore this email.</p>
      </div>
    `
  );
}

// Sends the weekly savings-reminder nudge.
export async function sendSavingsReminderEmail(to: string, firstName: string) {
  await sendEmail(
    to,
    "Keep your savings streak going",
    `
      <div style="font-family: sans-serif; max-width: 400px; margin: 0 auto;">
        <h2 style="color:#0B2E5C;">Hey ${firstName || "there"} 👋</h2>
        <p style="color:#5B6B85;">
          It's been a week since your last deposit toward a savings goal.
          A small top-up now keeps you on track.
        </p>
        <p style="color:#5B6B85; font-size: 12px;">
          You're getting this because you have an active goal on Nestegg.
        </p>
      </div>
    `
  );
}
