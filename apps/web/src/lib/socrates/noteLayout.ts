export type SocratesNoteId = "work" | "goal";
export type SocratesNotePosition = Readonly<{ x: number; y: number }>;
export type SocratesNoteLayout = Readonly<{
  version: 1;
  positions: Record<SocratesNoteId, SocratesNotePosition>;
  frontNoteId: SocratesNoteId;
}>;

export const SOCRATES_NOTE_IDS = ["work", "goal"] as const satisfies readonly SocratesNoteId[];
export const DEFAULT_SOCRATES_NOTE_LAYOUT: SocratesNoteLayout = {
  version: 1,
  positions: { work: { x: 0, y: 0 }, goal: { x: 0, y: 0 } },
  frontNoteId: "goal",
};

export const resetSocratesNoteLayout = (): SocratesNoteLayout => ({
  version: 1,
  positions: { work: { x: 0, y: 0 }, goal: { x: 0, y: 0 } },
  frontNoteId: "goal",
});

const finitePosition = (value: unknown): value is SocratesNotePosition => {
  if (!value || typeof value !== "object") return false;
  const position = value as Partial<SocratesNotePosition>;
  return Number.isFinite(position.x) && Number.isFinite(position.y);
};

export const parseSocratesNoteLayout = (value: string | null): SocratesNoteLayout => {
  if (!value) return resetSocratesNoteLayout();
  try {
    const parsed = JSON.parse(value) as Partial<SocratesNoteLayout>;
    if (parsed.version !== 1 || !parsed.positions) return resetSocratesNoteLayout();
    return {
      version: 1,
      positions: {
        work: finitePosition(parsed.positions.work) ? parsed.positions.work : { x: 0, y: 0 },
        goal: finitePosition(parsed.positions.goal) ? parsed.positions.goal : { x: 0, y: 0 },
      },
      frontNoteId: parsed.frontNoteId === "work" || parsed.frontNoteId === "goal" ? parsed.frontNoteId : "goal",
    };
  } catch {
    return resetSocratesNoteLayout();
  }
};

type Rect = Readonly<{ left: number; right: number; top: number; bottom: number }>;

export const clampSocratesNotePosition = (input: Readonly<{
  current: SocratesNotePosition;
  requested: SocratesNotePosition;
  note: Rect;
  surface: Rect;
  inset?: number;
}>): SocratesNotePosition => {
  const inset = input.inset ?? 16;
  const clampAxis = (current: number, requested: number, start: number, end: number, surfaceStart: number, surfaceEnd: number) => {
    const delta = requested - current;
    const min = surfaceStart + inset - start;
    const max = surfaceEnd - inset - end;
    return Math.round((current + (min <= max ? Math.min(Math.max(delta, min), max) : (surfaceStart + surfaceEnd - start - end) / 2)) * 100) / 100;
  };
  return {
    x: clampAxis(input.current.x, input.requested.x, input.note.left, input.note.right, input.surface.left, input.surface.right),
    y: clampAxis(input.current.y, input.requested.y, input.note.top, input.note.bottom, input.surface.top, input.surface.bottom),
  };
};

export const moveSocratesNoteWithKey = (
  position: SocratesNotePosition,
  key: string,
  shift: boolean,
): SocratesNotePosition | null => {
  if (key === "Home") return { x: 0, y: 0 };
  const step = shift ? 40 : 14;
  if (key === "ArrowLeft") return { x: position.x - step, y: position.y };
  if (key === "ArrowRight") return { x: position.x + step, y: position.y };
  if (key === "ArrowUp") return { x: position.x, y: position.y - step };
  if (key === "ArrowDown") return { x: position.x, y: position.y + step };
  return null;
};
