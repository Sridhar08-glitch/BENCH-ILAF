// Keeps a value typed by a person (a name, an e-mail, a zone) from reordering the sentence it is placed in.
const FSI = "⁨";
const LRI = "⁦";
const PDI = "⁩";

/** A name or other text of unknown direction, set apart from the sentence around it. */
export function isolate(text: string): string {
  return `${FSI}${text}${PDI}`;
}

/** An address, a code or a zone name (always left to right), set apart from the sentence around it. */
export function isolateLtr(text: string): string {
  return `${LRI}${text}${PDI}`;
}
