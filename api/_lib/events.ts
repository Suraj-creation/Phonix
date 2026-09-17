import events from "./events.json";

export interface EventDef {
  id: string;
  title: string;
  category: string;
  description: string;
  event_date: string;
  event_time: string;
  venue: string;
  capacity: number;
  is_active: boolean;
  reg_open_date: string;
  reg_close_date: string;
}

const EVENTS = events as EventDef[];

export function listActiveEvents(): EventDef[] {
  return EVENTS.filter((e) => e.is_active);
}

/** Matches by id first, then an exact/partial title match (mirrors the old SQL LIKE lookup). */
export function findEvent(eventId?: string | null, eventName?: string | null): EventDef | undefined {
  if (eventId) {
    const byId = EVENTS.find((e) => e.id === eventId && e.is_active);
    if (byId) return byId;
  }
  if (eventName) {
    const needle = eventName.trim().toLowerCase();
    return EVENTS.find(
      (e) => e.is_active && (e.title.toLowerCase() === needle || e.title.toLowerCase().includes(needle))
    );
  }
  return undefined;
}
