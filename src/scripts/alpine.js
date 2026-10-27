// Alpine helpers are plain JavaScript: they run in the browser and keep the
// HTML templates readable. No build step or client store is involved.

const PLATES = [45, 35, 25, 10, 5, 2.5];
const BAR_WEIGHT = 45;

function decomposeBarbell(load) {
  const perSide = (Number(load) - BAR_WEIGHT) / 2;
  if (!Number.isFinite(perSide) || perSide < -0.001) return null;

  const counts = {};
  let remaining = Math.round(perSide * 100) / 100;

  for (const plate of PLATES) {
    let count = 0;
    while (remaining + 0.001 >= plate && count < 20) {
      remaining = Math.round((remaining - plate) * 100) / 100;
      count += 1;
    }
    if (count > 0) counts[plate] = count;
  }

  if (Math.abs(remaining) > 0.011) return null;
  return counts;
}

window.setLogger = (config) => ({
  category: config.category,
  plates: config.plates ?? {},
  manual: Boolean(config.manual),
  manualLoad: Number(config.manualLoad ?? 0),
  reps: Number(config.reps ?? 10),
  editingSetId: null,

  get barbellLoad() {
    let total = BAR_WEIGHT;
    for (const plate of PLATES) {
      total += 2 * plate * (Number(this.plates[plate]) || 0);
    }
    return Math.round(total * 100) / 100;
  },

  get load() {
    if (this.category === 'barbell' && !this.manual) return this.barbellLoad;
    return Math.max(0, Number(this.manualLoad) || 0);
  },

  get displayLoad() {
    const value = this.load;
    return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
  },

  addPlate(plate) {
    this.plates[plate] = (Number(this.plates[plate]) || 0) + 1;
  },

  removePlate(plate) {
    const count = Number(this.plates[plate]) || 0;
    if (count > 0) this.plates[plate] = count - 1;
  },

  toggleManual() {
    if (this.category !== 'barbell') return;
    if (!this.manual) {
      this.manualLoad = this.barbellLoad;
      this.manual = true;
      return;
    }
    const counts = decomposeBarbell(Number(this.manualLoad) || 0);
    if (counts !== null) {
      this.plates = counts;
      this.manual = false;
    }
  },

  setStack(delta) {
    this.manualLoad = Math.max(5, (Number(this.manualLoad) || 0) + delta);
  },

  setReps(delta) {
    this.reps = Math.min(1000, Math.max(1, (Number(this.reps) || 1) + delta));
  },

  beginEdit(load, reps, id) {
    this.editingSetId = id;
    this.reps = Number(reps);
    const value = Number(load);
    if (this.category === 'barbell') {
      const counts = decomposeBarbell(value);
      if (counts !== null) {
        this.plates = counts;
        this.manual = false;
      } else {
        this.manual = true;
        this.manualLoad = value;
      }
    } else {
      this.manualLoad = value;
    }
  },

  cancelEdit() {
    this.editingSetId = null;
  },
});

window.sessionPage = (count, initialIndex) => ({
  index: Math.min(Math.max(0, initialIndex), Math.max(0, count - 1)),
  count,

  next() {
    if (this.index < this.count - 1) this.index += 1;
  },

  previous() {
    if (this.index > 0) this.index -= 1;
  },

  get isFirst() {
    return this.index === 0;
  },

  get isLast() {
    return this.index === this.count - 1;
  },

  get progress() {
    return this.count === 0 ? 0 : ((this.index + 1) / this.count) * 100;
  },
});

window.routineBuilder = (config) => ({
  name: config.name,
  items: config.items,
  catalog: config.catalog,
  filter: '',

  add(exercise) {
    if (this.items.some((item) => item.exerciseId === exercise.id)) return;
    this.items.push({
      exerciseId: exercise.id,
      name: exercise.name,
      equipmentCategory: exercise.equipmentCategory,
      targetSetCount: 3,
      targetRepMin: 8,
      targetRepMax: 12,
    });
  },

  remove(index) {
    this.items.splice(index, 1);
  },

  move(index, direction) {
    const target = index + direction;
    if (target < 0 || target >= this.items.length) return;
    const [item] = this.items.splice(index, 1);
    this.items.splice(target, 0, item);
  },

  get available() {
    const chosen = new Set(this.items.map((item) => item.exerciseId));
    const query = this.filter.trim().toLowerCase();
    return this.catalog.filter(
      (exercise) =>
        !chosen.has(exercise.id) &&
        (query === '' || exercise.name.toLowerCase().includes(query)),
    );
  },
});
