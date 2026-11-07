import { dark, light, type Theme } from "./theme";

/** WCAG's relative luminance of a `#rrggbb` colour. */
function luminance(colour: string) {
  const [r, g, b] = [1, 3, 5].map((at) => {
    const channel = parseInt(colour.slice(at, at + 2), 16) / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG's contrast ratio between two colours, from 1 to 21. */
function contrast(a: string, b: string) {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

const texts = ["text", "textMuted", "accent", "brandStrong", "danger"] as const;
const grounds = ["bg", "surfaceRaised"] as const;

/**
 * Every colour text is set in can be read on the page and on the raised grey (#527): WCAG's 4.5:1.
 * `theme.test.ts` keeps these the website's colours, so this holds for both.
 */
describe.each([
  ["light", light],
  ["dark", dark],
] as [string, Theme][])("the %s colours", (_, theme) => {
  it.each(
    texts.flatMap((text) => grounds.map((ground) => [text, ground] as const)),
  )("set %s readably on %s", (text, ground) => {
    expect(contrast(theme[text], theme[ground])).toBeGreaterThanOrEqual(4.5);
  });
});
