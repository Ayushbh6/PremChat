"use client";

import { ChevronDown, Paperclip } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { SocratesGoal, SocratesGoalCapsule } from "@socrates/contracts";
import {
  SOCRATES_NOTE_IDS,
  clampSocratesNotePosition,
  moveSocratesNoteWithKey,
  parseSocratesNoteLayout,
  resetSocratesNoteLayout,
  type SocratesNoteId,
  type SocratesNoteLayout,
  type SocratesNotePosition,
} from "@/lib/socrates/noteLayout";
import type { SocratesLiveWorkItem } from "@/lib/socrates/presentation";
import styles from "./socrates.module.css";

const STORAGE_KEY = "socrates.board.notes";

type LiveNotesProps = Readonly<{
  goal?: SocratesGoal;
  capsule?: SocratesGoalCapsule;
  taskLabel: string;
  liveWork: readonly SocratesLiveWorkItem[];
  onOpenGoal: () => void;
  onOpenWork: () => void;
}>;

export function LiveNotes({ goal, capsule, taskLabel, liveWork, onOpenGoal, onOpenWork }: LiveNotesProps) {
  const reduceMotion = useReducedMotion();
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const noteRefs = useRef<Record<SocratesNoteId, HTMLElement | null>>({ work: null, goal: null });
  const [layout, setLayout] = useState<SocratesNoteLayout>(() => resetSocratesNoteLayout());
  const [expandedMobile, setExpandedMobile] = useState<SocratesNoteId | null>(null);
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setLayout(parseSocratesNoteLayout(window.localStorage.getItem(STORAGE_KEY)));
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const clampAll = () => setLayout((current) => {
      const surface = surfaceRef.current?.getBoundingClientRect();
      if (!surface) return current;
      const positions = { ...current.positions };
      for (const id of SOCRATES_NOTE_IDS) {
        const note = noteRefs.current[id]?.getBoundingClientRect();
        if (note) positions[id] = clampSocratesNotePosition({ current: current.positions[id], requested: current.positions[id], note, surface });
      }
      const next = { ...current, positions };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
    window.addEventListener("resize", clampAll);
    return () => window.removeEventListener("resize", clampAll);
  }, []);

  const move = (id: SocratesNoteId, requested: SocratesNotePosition, persist = false) => {
    setLayout((current) => {
      const surface = surfaceRef.current?.getBoundingClientRect();
      const note = noteRefs.current[id]?.getBoundingClientRect();
      const position = surface && note
        ? clampSocratesNotePosition({ current: current.positions[id], requested, note, surface })
        : requested;
      const next = { ...current, positions: { ...current.positions, [id]: position }, frontNoteId: id };
      if (persist) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };

  return (
    <div ref={surfaceRef} className={styles.notesSurface} aria-label="Movable live notes">
      <p className={styles.srOnly} aria-live="polite">{announcement}</p>
      {SOCRATES_NOTE_IDS.map((id) => (
        <StickyNote
          key={id}
          id={id}
          position={layout.positions[id]}
          front={layout.frontNoteId === id}
          mobileExpanded={expandedMobile === id}
          reduceMotion={Boolean(reduceMotion)}
          onRef={(element) => { noteRefs.current[id] = element; }}
          onActivate={() => setLayout((current) => ({ ...current, frontNoteId: id }))}
          onMove={move}
          onAnnounce={setAnnouncement}
          onMobileToggle={() => setExpandedMobile((current) => current === id ? null : id)}
          onOpen={id === "goal" ? onOpenGoal : onOpenWork}
        >
          {id === "goal" ? (
            <>
              <span className={styles.noteEyebrow}>Live goal</span>
              <strong className={styles.noteTitle}>{goal?.title ?? "Waiting for the first goal"}</strong>
              <p className={styles.noteBody}>{capsule?.summary ?? goal?.summary ?? "Socrates will place the routed goal here."}</p>
              <small className={styles.noteFooter}>{goal ? `${goal.status.replaceAll("_", " ")} · ${taskLabel}` : taskLabel}</small>
            </>
          ) : (
            <>
              <span className={styles.noteEyebrow}>Live work</span>
              <strong className={styles.noteTitle}>{taskLabel}</strong>
              <div className={styles.noteWorkList}>
                {liveWork.slice(-3).map((item) => (
                  <span key={item.id} data-state={item.state}><b>{item.label}</b><small>{item.detail}</small></span>
                ))}
                {!liveWork.length ? <p className={styles.noteBody}>Files, tools, memory, evidence, and Terminal work will appear here.</p> : null}
              </div>
              <small className={styles.noteFooter}>{liveWork.length ? `${liveWork.length} recent work item${liveWork.length === 1 ? "" : "s"}` : "No work yet"}</small>
            </>
          )}
        </StickyNote>
      ))}
    </div>
  );
}

type StickyNoteProps = Readonly<{
  id: SocratesNoteId;
  position: SocratesNotePosition;
  front: boolean;
  mobileExpanded: boolean;
  reduceMotion: boolean;
  children: React.ReactNode;
  onRef: (element: HTMLElement | null) => void;
  onActivate: () => void;
  onMove: (id: SocratesNoteId, position: SocratesNotePosition, persist?: boolean) => void;
  onAnnounce: (message: string) => void;
  onMobileToggle: () => void;
  onOpen: () => void;
}>;

function StickyNote({ id, position, front, mobileExpanded, reduceMotion, children, onRef, onActivate, onMove, onAnnounce, onMobileToggle, onOpen }: StickyNoteProps) {
  const drag = useRef<{ pointerId: number; x: number; y: number; origin: SocratesNotePosition } | null>(null);
  const [dragging, setDragging] = useState(false);
  const requested = (clientX: number, clientY: number): SocratesNotePosition => drag.current
    ? { x: drag.current.origin.x + clientX - drag.current.x, y: drag.current.origin.y + clientY - drag.current.y }
    : position;
  const start = (event: PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    onActivate();
    drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, origin: position };
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const continueDrag = (event: PointerEvent<HTMLButtonElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    onMove(id, requested(event.clientX, event.clientY));
  };
  const finish = (event: PointerEvent<HTMLButtonElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    onMove(id, requested(event.clientX, event.clientY), true);
    drag.current = null;
    setDragging(false);
    onAnnounce(`${id === "goal" ? "Live goal" : "Live work"} note moved.`);
  };
  const keyMove = (event: KeyboardEvent<HTMLButtonElement>) => {
    const next = moveSocratesNoteWithKey(position, event.key, event.shiftKey);
    if (!next) return;
    event.preventDefault();
    onActivate();
    onMove(id, next, true);
    onAnnounce(`${id === "goal" ? "Live goal" : "Live work"} note moved.`);
  };
  return (
    <motion.article
      ref={onRef}
      className={styles.liveNote}
      data-note={id}
      data-front={front || undefined}
      data-dragging={dragging || undefined}
      data-mobile-expanded={mobileExpanded || undefined}
      style={{ x: position.x, y: position.y, zIndex: front ? 4 : 3 }}
      initial={reduceMotion ? false : { opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
    >
      <button
        type="button"
        className={styles.noteHandle}
        aria-label={`Move ${id === "goal" ? "live goal" : "live work"} note`}
        aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Home"
        onPointerDown={start}
        onPointerMove={continueDrag}
        onPointerUp={finish}
        onPointerCancel={finish}
        onKeyDown={keyMove}
      ><Paperclip aria-hidden="true" /></button>
      <button
        type="button"
        className={styles.noteMobileToggle}
        aria-label={`${mobileExpanded ? "Collapse" : "Expand"} ${id === "goal" ? "live goal" : "live work"} note`}
        aria-expanded={mobileExpanded}
        onClick={onMobileToggle}
      >
        <ChevronDown aria-hidden="true" />
      </button>
      <button type="button" className={styles.noteContent} onClick={onOpen}>{children}</button>
    </motion.article>
  );
}
