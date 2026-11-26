// Which of the owner's details a design draws, so the guided editor asks only for those. The table comes from
// fields.ts (checked against real renders by fields.test.ts). A header that shows the chosen face inside it also uses the face's details.
import { FACE_FIELDS, TOP_FIELDS } from "./fields";
import { FACE_COUNT, TOP_COUNT, topInfo } from "./index";
import type { Design } from "@/lib/types";

export interface DesignFields {
  title: boolean;
  company: boolean;
  address: boolean;
  /** The intro text (bio). */
  bio: boolean;
  photo: boolean;
  cover: boolean;
}

const ALL: DesignFields = { title: true, company: true, address: true, bio: true, photo: true, cover: true };

export function fieldsFromMask(m: number): DesignFields {
  return { title: !!(m & 1), company: !!(m & 2), address: !!(m & 4), bio: !!(m & 8), photo: !!(m & 16), cover: !!(m & 32) };
}

/** The details this design draws. A company's own face can draw anything, so it asks for everything. */
export function fieldsOf(d: Pick<Design, "face" | "top" | "custom_face">): DesignFields {
  if (d.custom_face) return ALL;
  const face = d.face >= 1 && d.face <= FACE_COUNT ? FACE_FIELDS[d.face - 1] ?? 0 : 0;
  if (d.top < 1 || d.top > TOP_COUNT) return fieldsFromMask(face);
  const top = TOP_FIELDS[d.top - 1] ?? 0;
  return fieldsFromMask(topInfo(d.top).face ? top | face : top);
}

/** The words of the details this design does not draw, in a fixed order. */
export const unusedFields = (f: DesignFields): (keyof DesignFields)[] => (["title", "company", "address", "bio", "photo", "cover"] as const).filter((k) => !f[k]);
