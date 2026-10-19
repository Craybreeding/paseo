// Run against an Android dev client serving this checkout, with a real software keyboard.
// node packages/app/e2e/mobile/appearance-keyboard/android.mjs <session> <metro-url> [app-id]
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const [, , session, metroUrl, appId = "sh.paseo.debug"] = process.argv;
assert(session && metroUrl, "Pass the agent-device session and Metro URL");
const artifacts = resolve(".dev/agent-device-artifacts/appearance-keyboard-android");
mkdirSync(artifacts, { recursive: true });

function ad(...args) {
  return execFileSync("agent-device", ["--session", session, ...args], {
    encoding: "utf8",
    timeout: 60_000,
  });
}

function evaluate(expression) {
  return ad("cdp", "runtime", "eval", "--expr", expression, "--json");
}

// Read the mounted app's public React Native APIs through Metro. Accessibility
// snapshots with Gboard open can block while waiting for an idle hierarchy.
const reactNative = `Array.from(__r.getModules().values()).find(
  m => m.verboseName?.endsWith("/react-native/index.js")
).publicModule.exports`;

function measureFocusedInput() {
  evaluate(`(() => {
    const rn = ${reactNative};
    globalThis.__appearanceKeyboardMeasurement = null;
    rn.TextInput.State.currentlyFocusedInput()?.measureInWindow((x, y, width, height) => {
      globalThis.__appearanceKeyboardMeasurement = JSON.stringify({
        x, y, width, height,
        statusBarHeight: rn.StatusBar.currentHeight,
        scale: rn.PixelRatio.get(),
        keyboard: rn.Keyboard.metrics(),
      });
    });
  })()`);
  const value = JSON.parse(evaluate("globalThis.__appearanceKeyboardMeasurement"));
  return value ? JSON.parse(value) : null;
}

ad("open", appId, "--platform", "android", "--no-test-ime");
const target = ad("cdp", "target", "list", "--url", metroUrl)
  .split("\n")
  .find((line) => line.includes(appId))
  ?.split(/\s+/)[0];
assert(target, "The app must be connected to this Metro server");
ad("cdp", "target", "select", target);

try {
  evaluate(`(${reactNative}).Keyboard.dismiss()`);
  ad("open", appId, "paseo://settings", "--platform", "android", "--no-test-ime");
  ad("wait", "text", "Appearance", "5000");
  ad("open", appId, "paseo://settings/appearance", "--platform", "android", "--no-test-ime");
  ad("wait", "text", "Code size", "5000");
  const snapshot = JSON.parse(ad("snapshot", "-i", "--json"));
  const numericFields = snapshot.data.nodes.filter(
    (node) => node.type === "android.widget.EditText" && /^\d+$/.test(node.value ?? ""),
  );
  assert.equal(numericFields.length, 3, "All three font sizes must be visible without scrolling");
  ad("screenshot", resolve(artifacts, "before-keyboard.png"));
  // Appearance orders Interface size, Content size, then Code size.
  ad("press", `@${numericFields[2].ref}`);

  let measurement;
  let previous;
  let stable = 0;
  const deadline = Date.now() + 30_000;
  do {
    measurement = measureFocusedInput();
    const current = measurement?.keyboard
      ? [measurement.y, measurement.height, measurement.keyboard.screenY].map(Math.round).join(",")
      : null;
    stable = measurement?.keyboard && current === previous ? stable + 1 : 0;
    previous = current;
    if (stable >= 3) break;
    await delay(150);
  } while (Date.now() < deadline);

  assert(stable >= 3, `Focused input and keyboard must settle: ${JSON.stringify(measurement)}`);
  // Android measureInWindow excludes the status bar, Keyboard.metrics uses screen coordinates.
  const inputBottom = measurement.y + measurement.height + measurement.statusBarHeight;
  const keyboardTop = measurement.keyboard.screenY;
  console.log(JSON.stringify({ inputBottom, keyboardTop, measurement }));
  ad("screenshot", resolve(artifacts, "keyboard.png"));
  assert(
    inputBottom <= keyboardTop + 1 / measurement.scale,
    "Code size must be fully visible above the number keyboard (within one physical pixel)",
  );
  console.log("PASS: focusing Code size reveals the whole field above the keyboard");
} finally {
  evaluate(`(${reactNative}).Keyboard.dismiss()`);
  evaluate("delete globalThis.__appearanceKeyboardMeasurement");
}
