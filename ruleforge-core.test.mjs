import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(resolve(root, "index.html"), "utf8");
const scriptMatch = html.match(/<script>\s*([\s\S]*?)\s*<\/script>\s*<\/body>/);

assert.ok(scriptMatch, "Inline Ruleforge script should be present");

const initMarker = '    refs.startBtn.addEventListener("click", startTask);';
const initIndex = scriptMatch[1].indexOf(initMarker);

assert.ok(initIndex > -1, "Ruleforge initialization marker should be present");

const appSource = scriptMatch[1].slice(0, initIndex);

const elementDefaults = {
  recipe: "multimodal",
  minutes: "12",
  cogLoad: "6",
  moveLoad: "5",
  readiness: "7",
  fatigue: "2",
  soundVolume: "0.35"
};

const checkedDefaults = {
  adaptiveMode: true,
  balanceGuard: true,
  tutorialMode: false,
  lowImpact: false,
  soundMode: false,
  soundVoice: false,
  soundSpatial: false,
  cleanView: false
};

function createFakeElement(id = "") {
  return {
    id,
    value: elementDefaults[id] ?? "",
    checked: checkedDefaults[id] ?? false,
    textContent: "",
    innerHTML: "",
    className: "",
    style: {},
    dataset: {},
    children: [],
    classList: {
      add() {},
      remove() {},
      toggle() {},
      contains() {
        return false;
      }
    },
    addEventListener() {},
    removeEventListener() {},
    append(...nodes) {
      this.children.push(...nodes);
    },
    appendChild(node) {
      this.children.push(node);
      return node;
    },
    setAttribute() {},
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
    focus() {},
    remove() {},
    click() {}
  };
}

const elementCache = new Map();
const context = {
  console,
  Date,
  Math,
  JSON,
  Set,
  Map,
  Blob: class Blob {},
  URL: {
    createObjectURL() {
      return "blob:ruleforge-test";
    },
    revokeObjectURL() {}
  },
  navigator: {
    clipboard: {
      async writeText() {}
    }
  },
  localStorage: {
    getItem() {
      return null;
    },
    setItem() {},
    removeItem() {}
  },
  document: {
    getElementById(id) {
      if (!elementCache.has(id)) elementCache.set(id, createFakeElement(id));
      return elementCache.get(id);
    },
    createElement(tag) {
      return createFakeElement(tag);
    },
    createElementNS(_namespace, tag) {
      return createFakeElement(tag);
    },
    querySelectorAll() {
      return [];
    },
    body: createFakeElement("body")
  },
  window: {
    clearInterval() {},
    setInterval() {
      return 1;
    },
    clearTimeout() {},
    setTimeout(callback) {
      if (typeof callback === "function") callback();
      return 1;
    },
    confirm() {
      return true;
    },
    lucide: null
  }
};

context.globalThis = context;
context.window.document = context.document;
context.window.localStorage = context.localStorage;
context.window.navigator = context.navigator;

vm.createContext(context);
vm.runInContext(`${appSource}

globalThis.__ruleforge = {
  taskLibrary,
  resetState(settings = {}) {
    taskLevel = settings.taskLevel ?? 7.8;
    flexPressure = settings.flexPressure ?? 7.1;
    volatility = settings.volatility ?? 6.8;
    adaptiveState = freshAdaptiveState();
    stats = freshStats();
    currentMode = "mixed";
    plan = [];
    currentIndex = 0;
    variantHistory = [];
  },
  makeDualNBack,
  makeStroop,
  makeSwitch,
  makeSort,
  makeGoNoGo,
  makeMetaRule,
  makeReversal,
  makeAnalog,
  makeBinding,
  makeMatrix,
  applyTaskVariant,
  normalizeChallenge,
  deriveChallengeAnswer,
  getBindingRelation,
  resolveMetaDimension
};
`, context, { filename: "ruleforge-inline.js" });

const core = context.__ruleforge;
const modes = ["dual", "inhibit", "switch", "sort", "goNoGo", "meta", "reversal", "analog", "bind", "matrix"];

function buildChallenge(mode, round, variant) {
  if (mode === "dual") return core.makeDualNBack(round, variant);
  if (mode === "inhibit") return core.makeStroop(variant);
  if (mode === "switch") return core.makeSwitch(variant);
  if (mode === "sort") return core.makeSort(variant);
  if (mode === "goNoGo") return core.makeGoNoGo(variant);
  if (mode === "meta") return core.makeMetaRule(variant);
  if (mode === "reversal") return core.makeReversal(variant);
  if (mode === "analog") return core.makeAnalog(variant);
  if (mode === "bind") return core.makeBinding(round, variant);
  if (mode === "matrix") return core.makeMatrix(variant);
  throw new Error(`Unhandled mode: ${mode}`);
}

function assertChallengeInvariant(challenge) {
  const expected = core.deriveChallengeAnswer(challenge);
  assert.equal(challenge.answer, expected, `${challenge.mode} answer should be derived from rendered data`);

  const optionValues = challenge.options.map((option) => option.value);
  assert.equal(new Set(optionValues).size, optionValues.length, `${challenge.mode} options should not duplicate values`);
  assert.ok(optionValues.includes(challenge.answer), `${challenge.mode} options should contain the answer`);

  if (challenge.mode === "dual" && !challenge.data.previous) {
    assert.equal(challenge.answer, "neither", "dual n-back buffer-fill trials should answer neither");
  }

  if (challenge.mode === "meta") {
    assert.equal(challenge.data.dimension, core.resolveMetaDimension(challenge.data.parityRule, challenge.data.number), "meta route should match parity rule");
    assert.equal(challenge.data.flipped, challenge.data.marker === "cycle", "meta marker and cycle state should agree");
  }

  if (challenge.mode === "bind") {
    assert.equal(challenge.data.relation, core.getBindingRelation(challenge.data.card, challenge.data.previous), "binding relation should match card data");
  }
}

assert.equal(core.taskLibrary.length, 180, "generated task library size");
assert.equal(new Set(core.taskLibrary.map((item) => item.id)).size, 180, "generated task IDs should be unique");

for (const mode of modes) {
  const variants = core.taskLibrary.filter((item) => item.mode === mode);
  assert.ok(variants.length > 0, `${mode} should have generated variants`);

  core.resetState();
  const round = { stream: [], bindingStream: [] };

  for (let index = 0; index < 120; index += 1) {
    const variant = variants[index % variants.length];
    const challenge = core.normalizeChallenge(core.applyTaskVariant(buildChallenge(mode, round, variant), variant));
    assertChallengeInvariant(challenge);
  }
}

console.log("Ruleforge core audit passed: 180 blueprints and 1,200 generated challenges verified.");
