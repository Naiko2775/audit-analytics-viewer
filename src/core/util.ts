export const esc = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o));
export const store = {
  get<T>(k: string, d: T): T { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* stockage indisponible */ } },
  del(k: string) { try { localStorage.removeItem(k); } catch { /* idem */ } },
};
