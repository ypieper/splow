"use client";

import { Icon } from "@/components/ui/icons";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type FocusEvent, type KeyboardEvent } from "react";

type DatePickerProps = {
  value: string;
  onChange: (event: { target: { value: string } }) => void;
  min?: string;
  max?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  id?: string;
  lang?: string;
  "aria-label"?: string;
};

const weekdayLabels = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

function toISODate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function parseDate(value: string): string | null {
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const germanMatch = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(value.trim());
  const year = isoMatch ? Number(isoMatch[1]) : germanMatch ? Number(germanMatch[3]) : NaN;
  const month = isoMatch ? Number(isoMatch[2]) : germanMatch ? Number(germanMatch[2]) : NaN;
  const day = isoMatch ? Number(isoMatch[3]) : germanMatch ? Number(germanMatch[1]) : NaN;
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    ? toISODate(date)
    : null;
}

function formatDate(value: string) {
  const iso = parseDate(value);
  if (!iso) return "";
  const [year, month, day] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(year, month - 1, day));
}

function monthFor(value: string) {
  const iso = parseDate(value);
  if (!iso) return new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const [year, month] = iso.split("-").map(Number);
  return new Date(year, month - 1, 1);
}

function makeCalendarDays(month: Date) {
  const firstDay = new Date(month.getFullYear(), month.getMonth(), 1);
  const mondayOffset = (firstDay.getDay() + 6) % 7;
  const start = new Date(month.getFullYear(), month.getMonth(), 1 - mondayOffset);
  return Array.from({ length: 42 }, (_, index) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + index));
}

export function DatePicker({ value, onChange, min, max, required, disabled, className, id, lang, "aria-label": ariaLabel }: DatePickerProps) {
  const generatedId = useId();
  const calendarId = `date-picker-${generatedId.replaceAll(":", "")}`;
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const editingRef = useRef(false);
  const [draft, setDraft] = useState(() => formatDate(value));
  const [open, setOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState(() => monthFor(value));
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (editingRef.current) return;
    setDraft(formatDate(value));
    if (value) setViewMonth(monthFor(value));
  }, [value]);

  const days = useMemo(() => makeCalendarDays(viewMonth), [viewMonth]);
  const today = toISODate(new Date());
  const monthLabel = new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" }).format(viewMonth);
  const monthNumber = viewMonth.getMonth();

  const updatePosition = useCallback(() => {
    const rect = inputRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(292, window.innerWidth - 24);
    const estimatedHeight = 350;
    const top = window.innerHeight - rect.bottom >= estimatedHeight + 12
      ? rect.bottom + 8
      : Math.max(12, rect.top - estimatedHeight - 8);
    setPosition({ top, left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)) });
  }, []);

  const openCalendar = useCallback(() => {
    if (disabled) return;
    setViewMonth(monthFor(value));
    updatePosition();
    setOpen(true);
  }, [disabled, updatePosition, value]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const reposition = () => updatePosition();
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onEscape);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onEscape);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open, updatePosition]);

  function getValidationMessage(dateValue: string) {
    if (!dateValue) return required ? "Bitte gib ein Datum ein." : "";
    const parsed = parseDate(dateValue);
    if (!parsed) return "Bitte gib ein gültiges Datum im Format TT.MM.JJJJ ein.";
    if (min && parsed < min) return `Das Datum muss am oder nach dem ${formatDate(min)} liegen.`;
    if (max && parsed > max) return `Das Datum muss am oder vor dem ${formatDate(max)} liegen.`;
    return "";
  }

  function isInRange(iso: string) {
    return (!min || iso >= min) && (!max || iso <= max);
  }

  const firstAvailableInMonth = days.find((day) => day.getMonth() === monthNumber && isInRange(toISODate(day)));
  const initialFocusDate = days.map(toISODate).find((iso) => iso === value && isInRange(iso))
    ?? (isInRange(today) && days.some((day) => toISODate(day) === today) ? today : undefined)
    ?? (firstAvailableInMonth ? toISODate(firstAvailableInMonth) : undefined)
    ?? days.map(toISODate).find(isInRange);

  function selectDate(iso: string) {
    if (!isInRange(iso)) return;
    onChange({ target: { value: iso } });
    setDraft(formatDate(iso));
    editingRef.current = false;
    inputRef.current?.setCustomValidity("");
    setOpen(false);
  }

  function handleInputChange(event: ChangeEvent<HTMLInputElement>) {
    const next = event.target.value;
    editingRef.current = true;
    setDraft(next);
    const iso = next.trim() ? parseDate(next) : "";
    const validation = getValidationMessage(next);
    event.target.setCustomValidity(validation);
    if (iso && !validation) onChange({ target: { value: iso } });
    if (!next.trim()) onChange({ target: { value: "" } });
  }

  function handleBlur(event: FocusEvent<HTMLInputElement>) {
    const nextTarget = event.relatedTarget as Node | null;
    if (nextTarget && (rootRef.current?.contains(nextTarget) || popoverRef.current?.contains(nextTarget))) return;
    editingRef.current = false;
    const validation = getValidationMessage(draft);
    event.currentTarget.setCustomValidity(validation);
    const iso = parseDate(draft);
    if (iso && !validation) setDraft(formatDate(iso));
    else if (!draft.trim() && !required) setDraft("");
    else setOpen(false);
  }

  function handleInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) openCalendar();
      window.requestAnimationFrame(() => popoverRef.current?.querySelector<HTMLButtonElement>(".date-picker-day[tabindex='0']")?.focus());
    }
  }

  function handleDayKeyDown(event: KeyboardEvent<HTMLButtonElement>, iso: string) {
    const offsets: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    const offset = offsets[event.key];
    if (!offset) return;
    event.preventDefault();
    const [year, month, day] = iso.split("-").map(Number);
    let nextDay = new Date(year, month - 1, day + offset);
    for (let attempt = 0; attempt < 42 && !isInRange(toISODate(nextDay)); attempt += 1) {
      nextDay = new Date(nextDay.getFullYear(), nextDay.getMonth(), nextDay.getDate() + offset);
    }
    const nextIso = toISODate(nextDay);
    if (nextDay.getMonth() !== monthNumber || nextDay.getFullYear() !== viewMonth.getFullYear()) {
      setViewMonth(new Date(nextDay.getFullYear(), nextDay.getMonth(), 1));
    }
    window.requestAnimationFrame(() => popoverRef.current?.querySelector<HTMLButtonElement>(`[data-date="${nextIso}"]`)?.focus());
  }

  function changeMonth(offset: number) {
    setViewMonth((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1));
  }

  return <div className="date-picker" ref={rootRef}>
    <input
      ref={inputRef}
      id={id}
      className={`date-picker-input${className ? ` ${className}` : ""}`}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      placeholder="TT.MM.JJJJ"
      value={draft}
      required={required}
      disabled={disabled}
      lang={lang ?? "de"}
      aria-label={ariaLabel}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-controls={calendarId}
      onFocus={openCalendar}
      onClick={() => { if (!open) openCalendar(); }}
      onChange={handleInputChange}
      onBlur={handleBlur}
      onKeyDown={handleInputKeyDown}
    />
    <button className="date-picker-trigger" type="button" aria-label="Kalender öffnen" aria-expanded={open} disabled={disabled} onPointerDown={(event) => event.preventDefault()} onClick={() => open ? setOpen(false) : openCalendar()}>
      <Icon name="calendar" size={17}/>
    </button>
    {open && position ? createPortal(<div className="date-picker-popover" id={calendarId} role="dialog" aria-label="Datum auswählen" ref={popoverRef} style={{ top: position.top, left: position.left }}>
      <div className="date-picker-popover-header">
        <strong>{monthLabel}</strong>
        <div className="date-picker-month-controls">
          <button type="button" aria-label="Vorheriger Monat" onClick={() => changeMonth(-1)}><span aria-hidden="true">‹</span></button>
          <button type="button" aria-label="Nächster Monat" onClick={() => changeMonth(1)}><span aria-hidden="true">›</span></button>
        </div>
      </div>
      <div className="date-picker-weekdays" aria-hidden="true">{weekdayLabels.map((label, index) => <span key={`${label}-${index}`}>{label}</span>)}</div>
      <div className="date-picker-days" role="group" aria-label={monthLabel}>
        {days.map((day) => {
          const iso = toISODate(day);
          const outsideMonth = day.getMonth() !== monthNumber;
          const selected = iso === value;
          const unavailable = !isInRange(iso);
          return <button
            key={iso}
            type="button"
            className={`date-picker-day${outsideMonth ? " is-outside" : ""}${selected ? " is-selected" : ""}${iso === today ? " is-today" : ""}`}
            data-date={iso}
            aria-label={new Intl.DateTimeFormat("de-DE", { dateStyle: "full" }).format(day)}
            aria-pressed={selected}
            tabIndex={iso === initialFocusDate ? 0 : -1}
            disabled={unavailable}
            onClick={() => selectDate(iso)}
            onKeyDown={(event) => handleDayKeyDown(event, iso)}
          >{day.getDate()}</button>;
        })}
      </div>
      <div className="date-picker-popover-footer">
        <button type="button" disabled={!isInRange(today)} onClick={() => selectDate(today)}>Heute</button>
        <button type="button" onClick={() => { onChange({ target: { value: "" } }); setDraft(""); editingRef.current = false; inputRef.current?.setCustomValidity(""); setOpen(false); }}>Leeren</button>
      </div>
    </div>, document.body) : null}
  </div>;
}
