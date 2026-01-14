const app = document.querySelector("#app");

app.innerHTML = `
  <div style="font-family: system-ui, sans-serif; padding: 16px;">
    <h1>multiheat WASM PoC</h1>
    <pre id="out">Loading...</pre>
  </div>
`;

const out = document.querySelector("#out");

try {
  // Почему: top-level await позволяет дождаться инициализации WASM
  const multiheat = await import("../zig/multiheat_entry.zig");

  const stream = {
    isothermal: false,
    in_temp_K: 420.0,
    out_temp_K: 360.0,
    rate_MW_per_K: 1.25,
    load_MW: 0.0,
  };

  const q = multiheat.computeRequiredLoad(stream);

  const msg = `computeRequiredLoad(stream) = ${q}`;
  console.log(msg, { stream });
  out.textContent = msg;
} catch (err) {
  console.error(err);
  out.textContent = `Failed: ${String(err)}`;
}
