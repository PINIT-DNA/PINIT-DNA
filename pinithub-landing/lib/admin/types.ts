export type ActionResult =
  | { ok: true; previewUrl?: string }
  | { ok: false; error: string };
