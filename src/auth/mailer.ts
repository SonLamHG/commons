export interface Mailer {
  send(to: string, subject: string, text: string): Promise<void>;
}

/** Dev mailer: writes the message (incl. any magic-link) to stderr. */
export function consoleMailer(): Mailer {
  return {
    async send(to, subject, text) {
      process.stderr.write(`[mailer:console] to=${to} subject=${subject}\n${text}\n`);
    },
  };
}

/** Resend mailer over HTTP (no SDK). */
export function resendMailer(apiKey: string, from: string): Mailer {
  return {
    async send(to, subject, text) {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from, to, subject, text }),
      });
      if (!r.ok) throw new Error(`resend failed: ${r.status} ${await r.text()}`);
    },
  };
}

/** Pick a mailer from env: Resend if RESEND_API_KEY + MAIL_FROM are set, else console. */
export function mailerFromEnv(): Mailer {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM;
  return key && from ? resendMailer(key, from) : consoleMailer();
}
