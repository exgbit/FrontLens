import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRecordedJourneyConfig, type RecordedDomEvent } from '../src/journeys/journeyRecorder.js';

function event(overrides: Partial<RecordedDomEvent>): RecordedDomEvent {
  return {
    kind: 'click',
    url: 'http://example.test/users',
    timestamp: '2026-07-07T00:00:00.000Z',
    tag: 'button',
    role: 'button',
    text: 'Search',
    selector: 'button:nth-of-type(1)',
    ...overrides
  };
}

test('buildRecordedJourneyConfig converts clicks and coalesces input fills', () => {
  const config = buildRecordedJourneyConfig([
    event({ kind: 'input', tag: 'input', inputType: 'text', name: 'q', selector: 'input[name="q"]', value: 'a', text: undefined, role: 'textbox' }),
    event({ kind: 'input', tag: 'input', inputType: 'text', name: 'q', selector: 'input[name="q"]', value: 'abc', text: undefined, role: 'textbox' }),
    event({ kind: 'keydown', tag: 'input', inputType: 'text', name: 'q', selector: 'input[name="q"]', key: 'Enter', text: undefined, role: 'textbox' }),
    event({ kind: 'click', tag: 'button', role: 'button', text: '查看详情', selector: 'button:nth-of-type(2)' })
  ], { url: 'http://example.test/users', name: 'Users search' });

  const journey = config.journeys.journeys[0];
  assert.equal(journey.name, 'Users search');
  assert.equal(journey.startUrl, 'http://example.test/users');
  assert.deepEqual(journey.steps.map((step) => step.action), ['waitForLoad', 'fill', 'press', 'click']);
  assert.equal(journey.steps[1].target, 'css=input[name="q"]');
  assert.equal(journey.steps[1].value, 'abc');
  assert.equal(journey.steps[2].value, 'Enter');
  assert.equal(journey.steps[3].target, 'role=button[name="查看详情"]');
});

test('buildRecordedJourneyConfig redacts sensitive values and keeps mutating clicks safe by default', () => {
  const config = buildRecordedJourneyConfig([
    event({ kind: 'input', tag: 'input', inputType: 'password', name: 'password', selector: 'input[name="password"]', value: 'secret-value', text: undefined, role: 'textbox', isSensitive: true }),
    event({ kind: 'click', tag: 'button', role: 'button', text: '删除', selector: 'button.danger' })
  ], { url: 'http://example.test/users' });

  const steps = config.journeys.journeys[0].steps;
  assert.equal(steps[1].value, '<REDACTED>');
  assert.equal(steps[2].action, 'click');
  assert.equal(steps[2].allowMutating, undefined);
  assert.match(steps[2].description ?? '', /默认回放会被安全策略阻断/);
});

test('buildRecordedJourneyConfig can opt into allowMutating for recorded business flows', () => {
  const config = buildRecordedJourneyConfig([
    event({ kind: 'click', tag: 'button', role: 'button', text: '保存', selector: 'button.save' })
  ], { url: 'http://example.test/edit', allowMutatingSteps: true, maxSteps: 1 });

  const steps = config.journeys.journeys[0].steps;
  assert.equal(steps.length, 2);
  assert.equal(steps[1].allowMutating, true);
});
