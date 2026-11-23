// The words for what the sanitiser removed, chosen by its code (the sentence the API sends is English only).
import { tk, type MessageKey, type TFunction } from "@/lib/i18n";
import type { SanitizeWarning } from "@/lib/library/custom/sanitize";

const KEYS: Record<string, MessageKey> = {
  comment: tk("staff.warn.comment"), unfinished_tag: tk("staff.warn.unfinished_tag"), declaration: tk("staff.warn.declaration"), if_closed: tk("staff.warn.if_closed"),
  dropped_element: tk("staff.warn.dropped_element"), unwrapped: tk("staff.warn.unwrapped"), too_deep: tk("staff.warn.too_deep"), class: tk("staff.warn.class"),
  reserved_class: tk("staff.warn.reserved_class"), event_attr: tk("staff.warn.event_attr"), style_attr: tk("staff.warn.style_attr"), img_src: tk("staff.warn.img_src"),
  img_no_src: tk("staff.warn.img_no_src"), svg_attr: tk("staff.warn.svg_attr"), attr: tk("staff.warn.attr"), if_unknown: tk("staff.warn.if_unknown"),
  else_stray: tk("staff.warn.else_stray"), endif_stray: tk("staff.warn.endif_stray"), placeholder: tk("staff.warn.placeholder"), nested_rule: tk("staff.warn.nested_rule"),
  bad_declaration: tk("staff.warn.bad_declaration"), important: tk("staff.warn.important"), custom_property: tk("staff.warn.custom_property"), property: tk("staff.warn.property"),
  bad_value: tk("staff.warn.bad_value"), value: tk("staff.warn.value"), selector: tk("staff.warn.selector"), rule_selector: tk("staff.warn.rule_selector"),
  too_many_rules: tk("staff.warn.too_many_rules"), unfinished: tk("staff.warn.unfinished"), at_rule: tk("staff.warn.at_rule"), keyframes_name: tk("staff.warn.keyframes_name"),
  keyframes_step: tk("staff.warn.keyframes_step"), type: tk("staff.warn.type"), too_large: tk("staff.warn.too_large"), too_many: tk("staff.warn.too_many"),
  too_much_data: tk("staff.warn.too_much_data"),
};

/** One line of the warnings list, in the page's language. */
export function warningText(w: { code: string; message: string; params?: SanitizeWarning["params"] }, t: TFunction): string {
  const key = KEYS[w.code];
  return key ? t(key, (w.params ?? {}) as Record<string, string | number>) : w.message;
}
