import nodemailer from "nodemailer";

export interface MailMessage {
  from?: string;
  to: string;
  subject: string;
  html: string;
}

export interface MailTransport {
  sendMail(message: MailMessage): Promise<{ messageId: string }>;
}

export interface MailEnvironment {
  GMAIL_USER?: string;
  GMAIL_APP_PASSWORD?: string;
  REPORT_RECIPIENT?: string;
  /** Optional From display name; defaults to 个人每日简报. */
  MAIL_FROM_NAME?: string;
}

export interface BriefEmail {
  subject: string;
  html: string;
}

export async function sendBrief(
  email: BriefEmail,
  env: MailEnvironment = process.env,
  injectedTransport?: MailTransport,
): Promise<{ messageId: string; recipientCount: number }> {
  const user = env.GMAIL_USER?.trim();
  const password = env.GMAIL_APP_PASSWORD?.trim();
  const recipient = env.REPORT_RECIPIENT?.trim();
  if (!user || !password || !recipient) {
    throw new Error(
      "GMAIL_USER, GMAIL_APP_PASSWORD, and REPORT_RECIPIENT are required",
    );
  }

  const transport =
    injectedTransport ??
    (nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user, pass: password },
    }) as MailTransport);

  const fromName = env.MAIL_FROM_NAME?.trim() || "个人每日简报";
  const result = await transport.sendMail({
    from: `${fromName} <${user}>`,
    to: recipient,
    subject: email.subject,
    html: email.html,
  });
  return {
    messageId: result.messageId,
    recipientCount: recipient.split(",").filter((value) => value.trim()).length,
  };
}
