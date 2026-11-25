import nodemailer from 'nodemailer';

export interface MailerConfig {
  host: string;
  port: number;
  user?: string;
  pass?: string;
  from?: string;
}

export interface SendMailInput {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface Mailer {
  sendMail(input: SendMailInput): Promise<{ messageId: string }>;
  close(): Promise<void>;
}

export function createMailer(config: MailerConfig): Mailer {
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: false,
    auth:
      config.user && config.pass
        ? { user: config.user, pass: config.pass }
        : undefined,
  });

  const from = config.from || 'MediBook Telehealth <noreply@medibook.local>';

  return {
    async sendMail(input: SendMailInput) {
      const info = await transporter.sendMail({
        from,
        to: input.to,
        subject: input.subject,
        text: input.text,
        html: input.html,
      });
      return { messageId: info.messageId };
    },
    async close() {
      transporter.close();
    },
  };
}
