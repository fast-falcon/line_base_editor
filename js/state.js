export const state = {
  tool: 'select',
  items: [],
  selected: new Set(),
  drawing: null,
  history: [],
  future: [],
  animations: [],
  currentAnimId: null,
  tl: { sec: 0, playing: false, startTime: 0 }
};