import type { BrowserContext, Page } from 'playwright';
import type { ConsoleRecord, PageErrorRecord } from '../types.js';
import { createId } from '../utils/id.js';
import { compactText } from '../utils/text.js';
import { redactText, redactUrl } from '../utils/redact.js';

const MAX_CONSOLE_RECORDS = 1000;
const MAX_PAGE_ERRORS = 300;

export class ConsoleCollector {
  private readonly messages: ConsoleRecord[] = [];
  private readonly pageErrors: PageErrorRecord[] = [];
  private readonly attachedPages = new WeakSet<Page>();
  private consoleCounter = 0;
  private errorCounter = 0;

  attach(page: Page): void {
    if (this.attachedPages.has(page)) {
      return;
    }
    this.attachedPages.add(page);
    page.on('console', async (message) => {
      try {
        if (this.messages.length >= MAX_CONSOLE_RECORDS) {
          return;
        }
        const id = createId('CON', ++this.consoleCounter);
        const location = message.location();
        const handles = message.args().slice(0, 5);
        const argsPreview = await Promise.all(
          handles.map(async (arg) => {
            try {
              const value = await arg.jsonValue().catch(() => undefined);
              if (value === undefined) {
                return compactText(redactText(arg.toString()), 120);
              }
              return compactText(redactText(typeof value === 'string' ? value : safeStringify(value)), 120);
            } finally {
              await arg.dispose().catch(() => undefined);
            }
          })
        );
        this.messages.push({
          id,
          type: message.type(),
          text: compactText(redactText(message.text()), 2000),
          location: location.url ? { ...location, url: redactUrl(location.url) } : location,
          timestamp: new Date().toISOString(),
          argsPreview
        });
      } catch (error) {
        this.messages.push({
          id: createId('CON', ++this.consoleCounter),
          type: 'collector-error',
          text: compactText(redactText(error instanceof Error ? error.message : String(error)), 2000),
          timestamp: new Date().toISOString()
        });
      }
    });

    page.on('pageerror', (error) => {
      if (this.pageErrors.length >= MAX_PAGE_ERRORS) {
        return;
      }
      this.pageErrors.push({
        id: createId('ERR', ++this.errorCounter),
        name: error.name,
        message: redactText(error.message),
        stack: error.stack ? redactText(error.stack) : undefined,
        timestamp: new Date().toISOString()
      });
    });
  }

  attachContext(context: BrowserContext): void {
    for (const page of context.pages()) {
      this.attach(page);
    }
    context.on('page', (page) => this.attach(page));
  }

  getMessages(): ConsoleRecord[] {
    return [...this.messages];
  }

  getPageErrors(): PageErrorRecord[] {
    return [...this.pageErrors];
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
