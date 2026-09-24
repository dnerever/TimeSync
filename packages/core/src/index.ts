export {
  FORMAT_VERSION,
  SLOT_MINUTES,
  MAX_DAY_COUNT,
  MAX_LABEL_BYTES,
  MAX_TIME_ZONE_BYTES,
  MAX_PAYLOAD_CHARS,
  slotsPerDay,
  totalSlots,
  slotStart,
  encodeAvailability,
  decodeAvailability,
  buildShareUrl,
  extractPayload,
} from './codec.ts';
export type { Availability, SlotMinutes } from './codec.ts';
