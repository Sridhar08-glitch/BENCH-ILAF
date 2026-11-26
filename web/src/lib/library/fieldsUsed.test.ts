import { describe, expect, it } from "vitest";
import { defaultDesign } from "./index";
import { fieldsFromMask, fieldsOf, unusedFields } from "./fieldsUsed";

describe("fieldsOf", () => {
  it("reads the bits", () => {
    expect(fieldsFromMask(1 | 16)).toEqual({ title: true, company: false, address: false, bio: false, photo: true, cover: false });
  });
  it("gives a face its own details", () => {
    const f = fieldsOf({ ...defaultDesign(), face: 1, top: 0 });
    expect(f.title).toBe(true);
  });
  it("a header that draws its own top uses the header's details, not the face's", () => {
    const f = fieldsOf({ ...defaultDesign(), face: 1, top: 1 });
    expect(f.cover).toBe(true);
  });
  it("a company face asks for everything", () => {
    expect(unusedFields(fieldsOf({ ...defaultDesign(), custom_face: 5 }))).toEqual([]);
  });
  it("names what is left out", () => {
    expect(unusedFields(fieldsFromMask(1))).toEqual(["company", "address", "bio", "photo", "cover"]);
  });
  it("stays in range for a design number the library does not have", () => {
    expect(() => fieldsOf({ ...defaultDesign(), face: 9999, top: 9999 })).not.toThrow();
  });
});
