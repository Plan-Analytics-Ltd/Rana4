/**
 * Generic programme label rules — see projectDetection.naming.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isGenericProgrammeLabel,
  meaningfulFilenameTitle,
} from "../../dist/services/import/projectDetection.naming.js";

describe("project detection naming", () => {
  it("treats common generic Primavera labels as generic", () => {
    for (const label of [
      "Programme_V2.xml-3",
      "Programme_V2",
      "Project1",
      "Test",
      "Baseline",
      "Copy",
      "Schedule",
      "Untitled",
      "Project",
    ]) {
      assert.equal(isGenericProgrammeLabel(label), true, label);
    }
  });

  it("accepts meaningful project titles", () => {
    for (const label of [
      "Emergency Care Building",
      "Northern Line Station Upgrade",
      "M25 Junction 10 Improvement",
      "Airport Terminal Expansion",
    ]) {
      assert.equal(isGenericProgrammeLabel(label), false, label);
    }
  });

  it("cleans export filenames into human-readable titles", () => {
    const title = meaningfulFilenameTitle(
      "SYN1-Emergency Care Wing - Northvale - Civils Programme - Baseline.xer"
    );
    assert.equal(title, "Northvale Emergency Care Wing");
  });
});
