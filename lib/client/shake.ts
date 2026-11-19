/**
 * 11-19: what a failed sign-in shakes. The whole auth card used to (AuthForm, the admin LoginForm), and with it
 * everything in the column, so the page itself seemed to shake. Now only the part that is wrong moves: the invalid
 * field that has focus; failing that, every invalid field (the six code boxes move as one); failing that, the error
 * message itself. A field in a .relative box (the password with its eye button) moves with its box, once. Nothing to
 * point at, nothing moves.
 */
export function shakeTargets(root: ParentNode, active: Element | null): HTMLElement[] {
  const box = (el: HTMLElement) => (el.parentElement?.classList.contains("relative") ? el.parentElement : el);
  const invalid = Array.from(root.querySelectorAll<HTMLElement>('[aria-invalid="true"]'));
  const focused = invalid.find((el) => el === active);
  const picked = focused ? [focused] : invalid.length ? invalid : Array.from(root.querySelectorAll<HTMLElement>('[role="alert"]'));
  return Array.from(new Set(picked.map(box)));
}

/** The movement, in px: smaller than the old 9px card shake, since a single field is what moves now. */
export const SHAKE_X = [-7, 6, -4, 3, -1, 0];
