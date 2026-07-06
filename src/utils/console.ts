import type { ConsoleRecord } from '../types.js';

export function isConsoleError(record: ConsoleRecord): boolean {
  return record.type === 'error' || /error|exception|uncaught|unhandled/i.test(record.text);
}

export function isNativeResourceLoadConsole(record: Pick<ConsoleRecord, 'type' | 'text'>): boolean {
  if (record.type !== 'error') return false;
  return (
    /Failed to load resource/i.test(record.text) ||
    /\bnet::ERR_[A-Z0-9_]+\b/.test(record.text)
  );
}

export function isActionableConsoleError(record: ConsoleRecord): boolean {
  return isConsoleError(record) && !isNativeResourceLoadConsole(record);
}
