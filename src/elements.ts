import { normalizeSearchText } from './search.js';
import type {
  ElementCard,
  ElementFact,
  ElementFactMode,
  ElementProjectionChange,
  EventCard,
  MemoryElementType,
} from './types.js';
import { criticalityFloor } from './weights.js';

const ELEMENT_TYPES = new Set<MemoryElementType>(['person', 'project', 'organization', 'tool', 'place']);
const FACT_MODES = new Set<ElementFactMode>(['state', 'set', 'relation']);

function compactText(value: unknown, limit: number): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, limit) : '';
}

function stringList(value: unknown, limit: number, itemLimit = 240): string[] {
  return Array.isArray(value)
    ? [...new Set(value.map((item) => compactText(item, itemLimit)).filter(Boolean))].slice(0, limit)
    : [];
}

function eventChronology(event: EventCard): string {
  return event.temporal.happenedStart
    ?? event.temporal.happenedEnd
    ?? event.temporal.mentionedAt
    ?? event.createdAt;
}

export function renderElementState(facts: readonly ElementFact[], includeHistorical = false): string {
  const visible = includeHistorical ? facts : facts.filter((fact) => fact.status === 'active');
  const sets = new Map<string, string[]>();
  const lines: string[] = [];
  for (const fact of visible) {
    const values = Array.isArray(fact.value) ? fact.value : [fact.value];
    if (fact.mode === 'set') {
      sets.set(fact.key, [...new Set([...(sets.get(fact.key) ?? []), ...values])]);
    } else {
      lines.push(`${fact.key}: ${values.join(', ')}`);
    }
  }
  for (const [key, values] of sets) lines.push(`${key}: ${values.join(', ')}`);
  return lines.join('\n');
}

export interface ApplyElementChangesOptions {
  elements: ElementCard[];
  events: readonly EventCard[];
  changes: readonly ElementProjectionChange[];
  allowedEventIds: ReadonlySet<string>;
  now: string;
  currentTurn: number;
  idFactory: (prefix: 'elem' | 'fact') => string;
}

/**
 * Applies a model-proposed materialized view only when every fact cites an
 * event from the claimed projection batch. Events themselves are never edited.
 */
export function applyElementChanges(options: ApplyElementChangesOptions): ElementCard[] {
  const touched = new Map<string, ElementCard>();
  for (const rawChange of options.changes) {
    const name = compactText(rawChange.element?.name, 160);
    const type = rawChange.element?.type;
    const key = compactText(rawChange.key, 160);
    const mode = rawChange.mode;
    const operation = rawChange.operation;
    const requestedSourceEventIds = stringList(rawChange.sourceEventIds, 24);
    const sourceEventIds = requestedSourceEventIds.filter((id) => options.allowedEventIds.has(id));
    const rawValue = rawChange.value;
    const value = Array.isArray(rawValue) ? stringList(rawValue, 40) : compactText(rawValue, 1_200);
    const operationMatchesMode = (mode === 'state' && operation === 'set_state')
      || (mode === 'set' && operation === 'add_set_item')
      || (mode === 'relation' && operation === 'set_relation');
    if (!name || !ELEMENT_TYPES.has(type) || !key || !FACT_MODES.has(mode)
      || !operationMatchesMode || sourceEventIds.length === 0
      || sourceEventIds.length !== requestedSourceEventIds.length
      || (Array.isArray(value) ? value.length === 0 : !value)) continue;

    const aliases = stringList(rawChange.element?.aliases, 20, 160)
      .filter((alias) => normalizeSearchText(alias) !== normalizeSearchText(name));
    const knownNames = new Set([name, ...aliases].map(normalizeSearchText));
    let element = options.elements.find((candidate) => candidate.type === type
      && [candidate.name, ...candidate.aliases]
        .some((candidateName) => knownNames.has(normalizeSearchText(candidateName))));
    if (!element) {
      element = {
        id: options.idFactory('elem'),
        name,
        type,
        aliases,
        currentState: '',
        facts: [],
        sourceEventIds: [],
        sourceMessageIds: [],
        weight: {
          mentionCount: 1,
          lastAdoptedTurn: options.currentTurn,
          lastRetrievedAt: null,
          pinned: false,
          floorWeight: criticalityFloor('routine'),
          forcedCap: null,
        },
        createdAt: options.now,
        updatedAt: options.now,
      };
      options.elements.push(element);
    } else {
      element.aliases = [...new Set([...element.aliases, ...aliases])];
    }

    const sourceEvents = sourceEventIds.flatMap((id) => options.events.find((event) => event.id === id) ?? []);
    const validFrom = compactText(rawChange.validFrom, 80)
      || sourceEvents.map(eventChronology).sort().at(-1)
      || options.now;
    const validTo = compactText(rawChange.validTo, 80) || undefined;
    if (mode !== 'set') {
      for (const fact of element.facts.filter((candidate) =>
        candidate.status === 'active' && candidate.key === key && candidate.mode === mode)) {
        fact.status = 'superseded';
        if (!fact.validTo) fact.validTo = validFrom;
        fact.updatedAt = options.now;
      }
    }

    const existingSetValues = new Set(element.facts
      .filter((fact) => fact.status === 'active' && fact.mode === 'set' && fact.key === key)
      .flatMap((fact) => Array.isArray(fact.value) ? fact.value : [fact.value])
      .map(normalizeSearchText));
    const factValue = mode === 'set'
      ? (Array.isArray(value) ? value : [value])
        .filter((item) => !existingSetValues.has(normalizeSearchText(item)))
      : value;
    if (mode !== 'set' || factValue.length > 0) {
      const fact: ElementFact = {
        id: options.idFactory('fact'),
        key,
        mode,
        value: factValue,
        ...(validFrom ? { validFrom } : {}),
        ...(validTo ? { validTo } : {}),
        sourceEventIds,
        ...(typeof rawChange.confidence === 'number'
          ? { confidence: Math.max(0, Math.min(1, rawChange.confidence)) }
          : {}),
        status: 'active',
        createdAt: options.now,
        updatedAt: options.now,
      };
      element.facts.push(fact);
    }
    element.sourceEventIds = [...new Set([...element.sourceEventIds, ...sourceEventIds])];
    element.sourceMessageIds = [...new Set([
      ...element.sourceMessageIds,
      ...sourceEvents.flatMap((event) => event.sourceMessageIds),
    ])];
    element.currentState = renderElementState(element.facts);
    element.updatedAt = options.now;
    touched.set(element.id, element);
  }
  return [...touched.values()];
}

function dateValue(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function elementViewAt(element: ElementCard, at?: string): ElementCard {
  const view = structuredClone(element);
  if (!at) return view;
  const instant = dateValue(at, Number.NaN);
  if (!Number.isFinite(instant)) return view;
  view.facts = view.facts.filter((fact) =>
    dateValue(fact.validFrom, Number.NEGATIVE_INFINITY) <= instant
    && dateValue(fact.validTo, Number.POSITIVE_INFINITY) >= instant);
  view.currentState = renderElementState(view.facts, true);
  return view;
}
