import test from "node:test";
import assert from "node:assert/strict";
import {
  sendBrief,
  type MailMessage,
  type MailTransport,
} from "../../lib/index-brief/mail";

test("refuses to send without SMTP configuration", async () => {
  await assert.rejects(
    () =>
      sendBrief(
        { html: "<p>x</p>", subject: "x" },
        {},
        { sendMail: async () => ({ messageId: "unused" }) },
      ),
    /GMAIL_USER.*GMAIL_APP_PASSWORD.*REPORT_RECIPIENT/,
  );
});

test("sends through the injected transport without exposing the password", async () => {
  let sent: MailMessage | undefined;
  const transport: MailTransport = {
    sendMail: async (message) => {
      sent = message;
      return { messageId: "message-1" };
    },
  };
  const result = await sendBrief(
    { html: "<p>brief</p>", subject: "日报" },
    {
      GMAIL_USER: "sender@gmail.com",
      GMAIL_APP_PASSWORD: "secret-app-password",
      REPORT_RECIPIENT: "reader@example.com",
    },
    transport,
  );
  assert.equal(result.messageId, "message-1");
  assert.equal(sent?.to, "reader@example.com");
  assert.equal(sent?.html, "<p>brief</p>");
  assert.doesNotMatch(JSON.stringify(sent), /secret-app-password/);
});
