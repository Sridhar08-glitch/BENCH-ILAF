// What the API sends about a company's custom face (see backend designs.services.face_json).
export interface CustomFacePalette {
  name: string;
  bg: string;
  bg2: string;
  fg: string;
  acc: string;
  on: string;
}

/** A face made for one company: a template in the safe template language, its CSS, and four colourways. */
export interface CustomFaceData {
  id: number;
  name: string;
  tags: string[];
  palettes: CustomFacePalette[];
  template: string;
  css: string;
  /** The face keeps its own fonts and ignores the font a card owner picks. */
  font_locked: boolean;
  version: number;
  /** A short fingerprint of the face's content: it changes whenever the face does. */
  hash: string;
}

/** A face as the company's own list shows it. */
export interface CompanyFace extends CustomFaceData {
  status: "approved" | "live";
  published_at: string | null;
}
