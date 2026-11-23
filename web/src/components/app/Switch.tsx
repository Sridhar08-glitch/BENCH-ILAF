"use client";

interface Props {
  checked: boolean;
  onChange: (on: boolean) => void;
  /** Spoken name of the switch (required: the visible text is next to it, not inside). */
  label: string;
  disabled?: boolean;
  id?: string;
}

/** An on/off switch that screen readers and the keyboard treat as a real switch. */
export function Switch({ checked, onChange, label, disabled, id }: Props) {
  return (
    <span className="switch">
      <input id={id} type="checkbox" role="switch" aria-label={label} aria-checked={checked} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <i />
    </span>
  );
}

/** A labelled row with a switch on the right, as used in the editor. */
export function ToggleRow({ title, hint, checked, onChange, first, disabled }: { title: string; hint?: string; checked: boolean; onChange: (on: boolean) => void; first?: boolean; disabled?: boolean }) {
  return (
    <div className={`toggle ${first ? "first" : ""}`}>
      <div>
        {title}
        {hint && <small>{hint}</small>}
      </div>
      <Switch checked={checked} onChange={onChange} label={title} disabled={disabled} />
    </div>
  );
}
