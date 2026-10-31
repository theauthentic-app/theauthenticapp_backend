import { Injectable, Logger } from '@nestjs/common';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import Handlebars from 'handlebars';
import nodemailer, { type Transporter } from 'nodemailer';
import { Resend } from 'resend';
import { env } from '../common/utils/env.util';

export type MailTemplate =
  | 'welcome'
  | 'verify-email'
  | 'reset-password'
  | 'member-added'
  | 'payment-received'
  | 'org-approved'
  | 'trial-ending'
  | 'period-ending'
  | 'period-expired'
  | 'quota-warning'
  | 'recall-created'
  | 'risk-alert';

export type SendMailInput = {
  to: string;
  subject: string;
  template: MailTemplate;
  context: Record<string, unknown>;
};

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly templates = new Map<
    string,
    Handlebars.TemplateDelegate<Record<string, unknown>>
  >();
  private layout?: Handlebars.TemplateDelegate<Record<string, unknown>>;
  private smtp?: Transporter;
  private resend?: Resend;

  constructor() {
    this.loadTemplates();
    this.prepareTransports();
  }

  /** Effective preference for health/UI: resend | smtp | log */
  provider(): string {
    const explicit = (env('EMAIL_PROVIDER') ?? '').toLowerCase();
    if (explicit === 'log') return 'log';
    if (explicit === 'smtp' || explicit === 'nodemailer') {
      return this.smtp ? 'smtp' : 'log';
    }
    if (explicit === 'resend') {
      return this.resend ? 'resend' : this.smtp ? 'smtp' : 'log';
    }
    if (this.resend) return 'resend';
    if (this.smtp) return 'smtp';
    return 'log';
  }

  async send(
    input: SendMailInput,
  ): Promise<{ delivered: boolean; provider: string }> {
    const html = this.render(input.template, {
      ...input.context,
      subject: input.subject,
      year: new Date().getFullYear(),
    });
    const text = stripHtml(html);
    const from = env('MAIL_FROM') ?? 'AUTHENTIC <noreply@localhost>';
    const explicit = (env('EMAIL_PROVIDER') ?? '').toLowerCase();

    if (explicit === 'log') {
      this.log(from, input, text);
      return { delivered: false, provider: 'log' };
    }

    const preferSmtpOnly =
      explicit === 'smtp' || explicit === 'nodemailer';

    // Default + resend: try Resend first, then SMTP.
    if (!preferSmtpOnly && this.resend) {
      try {
        await this.resend.emails.send({
          from,
          to: input.to,
          subject: input.subject,
          html,
          text,
        });
        return { delivered: true, provider: 'resend' };
      } catch (error) {
        this.logger.warn(
          `Resend failed (${String(error)}); falling back to SMTP if configured.`,
        );
      }
    }

    if (this.smtp) {
      try {
        await this.smtp.sendMail({
          from,
          to: input.to,
          subject: input.subject,
          html,
          text,
        });
        return { delivered: true, provider: 'smtp' };
      } catch (error) {
        this.logger.error(`SMTP send failed: ${String(error)}`);
      }
    }

    this.log(from, input, text);
    return { delivered: false, provider: 'log' };
  }

  render(template: MailTemplate, context: Record<string, unknown>): string {
    const compiled = this.templates.get(template);
    if (!compiled || !this.layout) {
      throw new Error(`Email template "${template}" is not registered.`);
    }
    const body = compiled(context);
    return this.layout({ ...context, body });
  }

  private resolveTemplatesDir(): string {
    const candidates = [
      join(__dirname, 'templates'),
      join(__dirname, '..', '..', 'mail', 'templates'),
      join(process.cwd(), 'dist', 'mail', 'templates'),
      join(process.cwd(), 'dist', 'src', 'mail', 'templates'),
      join(process.cwd(), 'src', 'mail', 'templates'),
    ];
    for (const dir of candidates) {
      if (existsSync(join(dir, 'layout.hbs'))) return dir;
    }
    throw new Error(
      `Email templates not found. Tried: ${candidates.join(' | ')}`,
    );
  }

  private loadTemplates() {
    const dir = this.resolveTemplatesDir();
    this.layout = Handlebars.compile(
      readFileSync(join(dir, 'layout.hbs'), 'utf8'),
    );
    for (const name of [
      'welcome',
      'verify-email',
      'reset-password',
      'member-added',
      'payment-received',
      'org-approved',
      'trial-ending',
      'period-ending',
      'period-expired',
      'quota-warning',
      'recall-created',
      'risk-alert',
    ] as const) {
      this.templates.set(
        name,
        Handlebars.compile(readFileSync(join(dir, `${name}.hbs`), 'utf8')),
      );
    }
  }

  private prepareTransports() {
    const resendKey = env('RESEND_API_KEY');
    if (resendKey) {
      this.resend = new Resend(resendKey);
    }
    const host = env('SMTP_HOST');
    if (host) {
      const user = (env('SMTP_USER') ?? '').trim();
      // Gmail App Passwords are often copied with spaces — strip them.
      const pass = (env('SMTP_PASS') ?? '').replace(/\s+/g, '');
      this.smtp = nodemailer.createTransport({
        host,
        port: Number(env('SMTP_PORT') ?? '587'),
        secure: env('SMTP_SECURE') === 'true',
        auth: user
          ? {
              user,
              pass,
            }
          : undefined,
      });
    }
  }

  private log(from: string, input: SendMailInput, text: string) {
    this.logger.log(
      `[mail:${input.template}] from=${from} to=${input.to} subject=${input.subject}\n${text}`,
    );
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
