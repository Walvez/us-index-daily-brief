/**
 * Re-export the proven Gmail transport with personal-brief default branding.
 * Secrets are never logged here.
 */
export {
  sendBrief,
  type BriefEmail,
  type MailEnvironment,
  type MailMessage,
  type MailTransport,
} from "../index-brief/mail";
