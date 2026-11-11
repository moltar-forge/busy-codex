import { device } from "@shared/device";
import { stack, render, type Node } from "@busy-app/busy-lib";
import manifest from "./appmeta/manifest.json";
const APP = manifest.id;
const POLL_MS = 15000;
const STALE_MS = 600000;
type Usage = { remaining: number; windowMins: number; resetsAt: number; updatedAt: number };
function valid(value: Usage): boolean {
  return value !== null && typeof value === "object" &&
    typeof value.remaining === "number" && isFinite(value.remaining) && value.remaining >= 0 && value.remaining <= 100 &&
    typeof value.windowMins === "number" && value.windowMins > 0 &&
    typeof value.resetsAt === "number" && isFinite(value.resetsAt) &&
    typeof value.updatedAt === "number" && isFinite(value.updatedAt);
}
function resetLabel(seconds: number): string {
  const minutes = Math.max(0, Math.floor(seconds / 60));
  const hours = Math.floor(minutes / 60);
  if (hours >= 24) return Math.floor(hours / 24) + "d " + hours % 24 + "h";
  return hours > 0 ? hours + "h " + minutes % 60 + "m" : minutes + "m";
}
const GLYPHS: Record<string, string[]> = {
  "0": ["111", "101", "101", "101", "111"], "1": ["010", "110", "010", "010", "111"],
  "2": ["110", "001", "010", "100", "111"], "3": ["110", "001", "010", "001", "110"],
  "4": ["101", "101", "111", "001", "001"], "5": ["111", "100", "110", "001", "110"],
  "6": ["011", "100", "111", "101", "111"], "7": ["111", "001", "010", "010", "010"],
  "8": ["111", "101", "111", "101", "111"], "9": ["111", "101", "111", "001", "110"],
  ":": ["0", "1", "0", "1", "0"],
  "%": ["101", "001", "010", "100", "101"], "-": ["000", "000", "111", "000", "000"],
  "C": ["011", "100", "100", "100", "011"], "O": ["111", "101", "101", "101", "111"],
  "D": ["110", "101", "101", "101", "110"], "E": ["111", "100", "110", "100", "111"],
  "X": ["101", "101", "010", "101", "101"], "L": ["100", "100", "100", "100", "111"],
  "F": ["111", "100", "110", "100", "100"], "T": ["111", "010", "010", "010", "010"],
  "S": ["011", "100", "010", "001", "110"], "A": ["010", "101", "111", "101", "101"],
  "U": ["101", "101", "101", "101", "111"], "B": ["110", "101", "110", "101", "110"],
  "W": ["101", "101", "111", "111", "101"], "I": ["111", "010", "010", "010", "111"],
  "d": ["001", "001", "111", "101", "111"], "h": ["100", "100", "110", "101", "101"],
  "m": ["000", "000", "111", "111", "101"], " ": ["0", "0", "0", "0", "0"],
};
function frame(data: Usage | null, clock: string): Node {
  const stale = data !== null && Date.now() - data.updatedAt > STALE_MS;
  const remaining = data === null ? 0 : Math.round(data.remaining);
  const accent = stale || data === null ? "#E4A34A" : remaining <= 10 ? "#F06B55" : "#5AABFF";
  const amount = data === null ? "--" : String(remaining);
  const label = data === null ? "USB" : stale ? "STALE" : resetLabel(data.resetsAt - Date.now() / 1000).replace(/ /g, "");
  const pixels: string[][] = [];
  for (let y = 0; y < 16; y++) pixels.push(new Array<string>(72).fill("."));
  function rectangle(x: number, y: number, width: number, height: number, color: string): void {
    for (let dy = y; dy < y + height; dy++) {
      for (let dx = x; dx < x + width; dx++) {
        if (dx >= 0 && dx < 72 && dy >= 0 && dy < 16) pixels[dy][dx] = color;
      }
    }
  }
  function text(value: string, x: number, y: number, color: string, scale: number): void {
    for (let i = 0; i < value.length; i++) {
      const glyph = GLYPHS[value[i]] || GLYPHS[" "];
      for (let gy = 0; gy < glyph.length; gy++) {
        for (let gx = 0; gx < glyph[gy].length; gx++) {
          if (glyph[gy][gx] === "1") rectangle(x + gx * scale, y + gy * scale, scale, scale, color);
        }
      }
      x += (glyph[0].length + 1) * scale;
    }
  }
  text(amount + "%", 1, 1, "w", 2);
  let clockWidth = -1;
  for (let i = 0; i < clock.length; i++) clockWidth += (GLYPHS[clock[i]] || GLYPHS[" "])[0].length + 1;
  const amountRight = 1 + (amount.length + 1) * 8 - 2;
  const clockX = Math.floor((amountRight + 51 - clockWidth) / 2);
  text(clock, clockX, 4, "g", 1);
  text(label, 51, 1, stale ? "b" : "w", 1);
  text("CODEX", 51, 7, "g", 1);
  rectangle(1, 14, 70, 2, "t");
  rectangle(1, 14, Math.round(70 * remaining / 100), 2, "b");
  return stack({ width: 72, height: 16, justify: "start", align: "start" }, [{
    type: "xpmbitmap", id: "big_number", width: 72, height: 16,
    data: "! XPM2\n72 16 5 1\n. c #000000\nw c #E9EDF2\ng c #7E8B9B\nt c #202A35\nb c " +
      accent + "\n" + pixels.map(row => row.join("")).join("\n"),
  }]);
}
function main(): void {
  let data: Usage | null = null;
  let clock = "--:--";
  let stopped = false;
  let pending = false;
  let lastFrame = "";
  const report = (error: unknown) => console.error(APP + ": " + String(error));
  async function update(read: boolean): Promise<void> {
    if (pending || stopped) return;
    pending = true;
    try {
      if (read) {
        try {
          const response = await fetch("http://localhost/api/apps/settings?app_id=" + APP);
          if (response.ok) {
            const document = await response.json() as { values: { snapshot: string } };
            const next = JSON.parse(document.values.snapshot) as Usage;
            if (valid(next)) data = next;
          }
        } catch (error) { report(error); }
      }
      try {
        const response = await fetch("http://localhost/api/time");
        if (response.ok) {
          const time = await response.json() as { timestamp: string };
          const match = /^\d{4}-\d{2}-\d{2}T(\d{2}):(\d{2}):/.exec(time.timestamp);
          if (match) {
            const hour = Number(match[1]);
            if (hour < 24 && Number(match[2]) < 60) clock = String(hour % 12 || 12) + ":" + match[2];
          }
        }
      } catch (error) { report(error); }
      if (stopped) return;
      const elements = render(frame(data, clock));
      const serialized = JSON.stringify(elements);
      if (serialized !== lastFrame) {
        await device.DisplayDraw({ application_name: APP, priority: 50, elements });
        lastFrame = serialized;
      }
    } finally { pending = false; }
  }
  void update(true).catch(report);
  const timer = setInterval(() => { void update(true).catch(report); }, POLL_MS);
  const unbind = listen("input", (event) => {
    if (stopped || event.action !== "short") return;
    if (event.key === "ok" || event.key === "start") {
      void update(true).catch(report);
    }
    if (event.key === "back") {
      stopped = true;
      clearInterval(timer);
      setTimeout(unbind, 0);
    }
  });
}
main();
