const ESC = String.fromCharCode(27);
const ANSI = new RegExp(`${ESC}\\[[0-9;]*m`, "g");

export const CHECK_TIMEOUT_MS = 20_000;

export function stripAnsi(text: string): string {
  return text.replace(ANSI, "");
}
