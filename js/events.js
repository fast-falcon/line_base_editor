const bus = new EventTarget();

export const emit = (name, detail) =>
  bus.dispatchEvent(new CustomEvent(name, { detail }));

export const on = (name, handler) => bus.addEventListener(name, handler);

export const off = (name, handler) =>
  bus.removeEventListener(name, handler);
