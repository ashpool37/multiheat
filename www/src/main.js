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

  const HeatStream = multiheat.HeatStream;
  const HeatSystem = multiheat.HeatSystem;

  const stream = new HeatStream({
    isothermal: false,
    in_temp_K: 503.0,
    out_temp_K: 308.0,
    rate_MW_per_K: 0.0664,
    load_MW: 0.0,
  });

  const q = multiheat.computeRequiredLoad(stream);

  const system = new HeatSystem({
    min_dt: 20,
    def_dt: 30,
    hot_streams: [
      new HeatStream({
        isothermal: false,
        in_temp_K: 503.0,
        out_temp_K: 308.0,
        rate_MW_per_K: 0.0664,
        load_MW: 0.0,
      }),
      new HeatStream({
        isothermal: true,
        in_temp_K: 425.0,
        out_temp_K: 425.0,
        rate_MW_per_K: 0.0,
        load_MW: 33.02,
      }),
      new HeatStream({
        isothermal: true,
        in_temp_K: 381.0,
        out_temp_K: 381.0,
        rate_MW_per_K: 0.0,
        load_MW: 12.87,
      }),
    ],
    cold_streams: [
      new HeatStream({
        isothermal: false,
        in_temp_K: 323.0,
        out_temp_K: 503.0,
        rate_MW_per_K: 0.0491,
        load_MW: 0.0,
      }),
      new HeatStream({
        isothermal: true,
        in_temp_K: 408.0,
        out_temp_K: 408.0,
        rate_MW_per_K: 0.0,
        load_MW: 18.4131,
      }),
      new HeatStream({
        isothermal: true,
        in_temp_K: 391.0,
        out_temp_K: 391.0,
        rate_MW_per_K: 0.0,
        load_MW: 18.4984,
      }),
      new HeatStream({
        isothermal: true,
        in_temp_K: 353.0,
        out_temp_K: 353.0,
        rate_MW_per_K: 0.0,
        load_MW: 16.3477,
      }),
    ],
    exchangers: [],
  });

  const getOptionalValue = (v) => {
    if (v === null || v === undefined) return null;
    if (typeof v === "object" && "value" in v) return v.value;
    return v;
  };

  const toPlainExchanger = (ex) => {
    if (!ex) return ex;
    return {
      hot_end: getOptionalValue(ex.hot_end),
      cold_end: getOptionalValue(ex.cold_end),
      load_MW: ex.load_MW,
    };
  };

  const dumpExchangers = (xs) => {
    if (xs === null || xs === undefined) return [];
    if (Array.isArray(xs)) return xs.map(toPlainExchanger);

    const obj = Object(xs);
    if (typeof obj[Symbol.iterator] === "function") {
      return Array.from(xs, toPlainExchanger);
    }

    if (typeof obj.length === "number") {
      const out = [];
      for (let i = 0; i < obj.length; i++) {
        const ex = obj[i] ?? obj.at?.(i) ?? obj.get?.(i);
        out.push(toPlainExchanger(ex));
      }
      return out;
    }

    // Почему: формат контейнера зависит от зигаровского представления массива/среза
    return [toPlainExchanger(xs)];
  };

  const safeJson = (value) =>
    JSON.stringify(
      value,
      (_k, v) => (typeof v === "bigint" ? v.toString() : v),
      2,
    );

  if (typeof multiheat.solve !== "function") {
    // Почему: текущая точка входа экспортирует только computeRequiredLoad/HeatStream.
    const msg =
      `computeRequiredLoad(stream) = ${q}\n` +
      `solve() is not exported from the Zig entrypoint yet. ` +
      `Export solve + HeatSystem/HeatExchanger from ../zig/multiheat_entry.zig to proceed.`;
    console.log(msg, { stream, system, multiheat });
    out.textContent = msg;
  } else {
    multiheat.solve(system);

    let verifyMsg = "verifySolution skipped";
    if (typeof multiheat.verifySolution === "function") {
      try {
        multiheat.verifySolution(system);
        verifyMsg = "verifySolution OK";
      } catch (e) {
        verifyMsg = `verifySolution FAILED: ${String(e)}`;
      }
    }

    const exchangers = dumpExchangers(system.exchangers);
    const msg =
      `computeRequiredLoad(stream) = ${q}\n` +
      `solve(system) OK\n` +
      `${verifyMsg}\n` +
      `exchangers = ${safeJson(exchangers)}`;
    console.log(msg, { stream, system, exchangers });
    out.textContent = msg;
  }
} catch (err) {
  console.error(err);
  out.textContent = `Failed: ${String(err)}`;
}
