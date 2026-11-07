import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { font, fontFiles } from "./fonts";

/**
 * The PostScript name (name ID 6) in a TrueType font's `name` table: the name iOS and Android
 * choose the face by.
 */
function postScriptName(file: string) {
  const data = readFileSync(file);
  const tables = data.readUInt16BE(4);
  for (let table = 0; table < tables; table++) {
    const entry = 12 + table * 16;
    if (data.toString("latin1", entry, entry + 4) !== "name") continue;
    const start = data.readUInt32BE(entry + 8);
    const records = data.readUInt16BE(start + 2);
    const strings = start + data.readUInt16BE(start + 4);
    for (let record = 0; record < records; record++) {
      const at = start + 6 + record * 12;
      if (data.readUInt16BE(at + 6) !== 6) continue;
      const bytes = data.subarray(
        strings + data.readUInt16BE(at + 10),
        strings + data.readUInt16BE(at + 10) + data.readUInt16BE(at + 8),
      );
      // Platform 1 (Macintosh) is single-byte; 0 and 3 are UTF-16, big-endian.
      return data.readUInt16BE(at) === 1
        ? bytes.toString("latin1")
        : Buffer.from(bytes).swap16().toString("utf16le");
    }
  }
  return undefined;
}

/** The faces the styles name (#527) are all there: a missing one would quietly be the system's. */
describe("the app’s fonts", () => {
  it.each(fontFiles)("has %s", (file) => {
    expect(existsSync(join(__dirname, "..", file))).toBe(true);
  });

  it.each(Object.values(font))(
    "names %s inside its file as the styles do",
    (name) => {
      expect(
        postScriptName(join(__dirname, `../assets/fonts/${name}.ttf`)),
      ).toBe(name);
    },
  );
});
