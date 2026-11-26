import type { EditorSectionData, SectionOf } from "@/lib/api-content";
import type { SectionKind } from "@/lib/public-api";
import type { EditorApi } from "../types";

/** What every section form receives: the editor, its section, a way to change the section's data, and the plan lock. */
export interface SectionFormProps<K extends SectionKind> {
  ed: EditorApi;
  section: SectionOf<K>;
  /** Replace the section's data; the tab saves it after a short pause. */
  onChange: (data: EditorSectionData[K]) => void;
  disabled: boolean;
}
