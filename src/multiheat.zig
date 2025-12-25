const std = @import("std");
const common = @import("common");

pub const Error = error{
    Infeasible,
    NoCompatiblePair,
};

const Side = enum { hot, cold };

const StreamState = struct {
    side: Side,
    index: u16,
    isothermal: bool,
    temp: f32,
    target: f32,
    rate: f32, // MW/K; zero for isothermal
    rem: f32, // MW remaining to transfer (always >= 0)
};

const UtilityPlan = struct {
    side: Side, // hot -> cooler (dump heat); cold -> heater (supply heat)
    index: u16,
    load: f32,
};

fn computeRequiredLoad(stream: common.HeatStream) f32 {
    if (stream.isothermal) return stream.load_MW;
    return stream.rate_MW_per_K * @abs(stream.out_temp_K - stream.in_temp_K);
}

fn initState(side: Side, idx: u16, stream: common.HeatStream) StreamState {
    const req = computeRequiredLoad(stream);
    return .{
        .side = side,
        .index = idx,
        .isothermal = stream.isothermal,
        .temp = stream.in_temp_K,
        .target = stream.out_temp_K,
        .rate = if (stream.isothermal) 0.0 else stream.rate_MW_per_K,
        .rem = req,
    };
}

fn min3(a: f32, b: f32, c: f32) f32 {
    return @min(a, @min(b, c));
}

fn maxTransferable(
    hot: StreamState,
    cold: StreamState,
    dt_min: f32,
) ?f32 {
    const eps: f32 = 1e-6;
    const d0 = hot.temp - cold.temp;
    if (d0 < dt_min - eps) return null;

    if (!hot.isothermal and !cold.isothermal) {
        const slope = (1.0 / hot.rate) + (1.0 / cold.rate);
        if (slope <= eps) return null;
        const q_dt = (d0 - dt_min) / slope;
        if (q_dt <= 0) return null;

        const q_hot_target = if (hot.temp > hot.target)
            (hot.temp - hot.target) * hot.rate
        else
            0.0;

        const q_cold_target = if (cold.target > cold.temp)
            (cold.target - cold.temp) * cold.rate
        else
            0.0;

        return @min(q_dt, min3(q_hot_target, q_cold_target, std.math.inf(f32)));
    } else if (hot.isothermal and !cold.isothermal) {
        const q_dt = (d0 - dt_min) * cold.rate;
        const q_cold_target = if (cold.target > cold.temp)
            (cold.target - cold.temp) * cold.rate
        else
            0.0;
        const q_lim = @min(q_dt, q_cold_target);
        return if (q_lim <= 0) null else q_lim;
    } else if (!hot.isothermal and cold.isothermal) {
        const q_dt = (d0 - dt_min) * hot.rate;
        const q_hot_target = if (hot.temp > hot.target)
            (hot.temp - hot.target) * hot.rate
        else
            0.0;
        const q_lim = @min(q_dt, q_hot_target);
        return if (q_lim <= 0) null else q_lim;
    } else {
        // both isothermal
        return if (d0 < dt_min - eps) null else std.math.inf(f32);
    }
}

/// Reserve the utility mismatch on as few streams as possible (greedy by largest remaining duty).
fn planUtilities(
    allocator: std.mem.Allocator,
    hot_states: []StreamState,
    cold_states: []StreamState,
    mismatch: f32,
    side: Side,
) ![]UtilityPlan {
    // side == hot  => need coolers (dump heat)
    // side == cold => need heaters (supply heat)
    const eps: f32 = 1e-6;
    if (mismatch <= eps) return &[_]UtilityPlan{};

    var plans = try std.ArrayList(UtilityPlan).initCapacity(allocator, 0);
    errdefer plans.deinit(allocator);

    var remaining = mismatch;
    while (remaining > eps) {
        var best_idx: ?usize = null;
        var best_cap: f32 = -1.0;

        if (side == .hot) {
            for (hot_states, 0..) |hs, i| {
                if (hs.rem > best_cap + eps) {
                    best_cap = hs.rem;
                    best_idx = i;
                }
            }
        } else {
            for (cold_states, 0..) |cs, i| {
                if (cs.rem > best_cap + eps) {
                    best_cap = cs.rem;
                    best_idx = i;
                }
            }
        }

        if (best_idx == null or best_cap <= eps) return Error.Infeasible;

        const idx = best_idx.?;
        const take = @min(remaining, best_cap);
        try plans.append(allocator, .{
            .side = side,
            .index = if (side == .hot)
                hot_states[idx].index
            else
                cold_states[idx].index,
            .load = take,
        });

        if (side == .hot) {
            hot_states[idx].rem -= take;
            if (hot_states[idx].rem < eps) hot_states[idx].rem = 0.0;
        } else {
            cold_states[idx].rem -= take;
            if (cold_states[idx].rem < eps) cold_states[idx].rem = 0.0;
        }

        remaining -= take;
    }

    return plans.toOwnedSlice(allocator);
}

/// Greedy synthesis: returns exchangers (process-process + utility) as owned slice.
pub fn synthesize(
    allocator: std.mem.Allocator,
    system: common.HeatSystem,
) ![]common.HeatExchanger {
    const dt_min: f32 = @floatFromInt(system.min_dt);

    const hot_count = system.hot_streams.len;
    const cold_count = system.cold_streams.len;

    var hot_states = try allocator.alloc(StreamState, hot_count);
    var cold_states = try allocator.alloc(StreamState, cold_count);
    defer allocator.free(hot_states);
    defer allocator.free(cold_states);

    var total_hot: f32 = 0;
    var total_cold: f32 = 0;

    for (system.hot_streams, 0..) |s, i| {
        hot_states[i] = initState(.hot, @intCast(i), s);
        total_hot += hot_states[i].rem;
    }
    for (system.cold_streams, 0..) |s, i| {
        cold_states[i] = initState(.cold, @intCast(i), s);
        total_cold += cold_states[i].rem;
    }

    const eps: f32 = 1e-6;

    var exchangers = try std.ArrayList(common.HeatExchanger).initCapacity(allocator, 0);
    errdefer exchangers.deinit(allocator);

    // Main greedy loop
    while (true) {
        var cold_idx: ?usize = null;
        var cold_best_temp: f32 = -std.math.inf(f32);

        for (cold_states, 0..) |c, i| {
            if (c.rem <= eps) continue;

            var has_hot = false;
            for (hot_states) |h| {
                if (h.rem <= eps) continue;
                if (h.temp - c.temp < dt_min - eps) continue;
                const q_candidate_opt = maxTransferable(h, c, dt_min);
                if (q_candidate_opt != null and q_candidate_opt.? > eps) {
                    has_hot = true;
                    break;
                }
            }
            if (!has_hot) continue;

            if (c.temp > cold_best_temp) {
                cold_best_temp = c.temp;
                cold_idx = i;
            }
        }

        const cold_sel_idx = cold_idx;
        if (cold_sel_idx == null) {
            var worst_idx: ?usize = null;
            var worst_temp: f32 = -std.math.inf(f32);
            for (cold_states, 0..) |c, i| {
                if (c.rem <= eps) continue;
                if (c.temp > worst_temp) {
                    worst_temp = c.temp;
                    worst_idx = i;
                }
            }
            if (worst_idx) |wi| {
                try exchangers.append(allocator, .{
                    .hot_end = null,
                    .cold_end = cold_states[wi].index,
                    .load_MW = cold_states[wi].rem,
                });
                cold_states[wi].rem = 0.0;
                continue;
            }
            break; // all cold satisfied
        }

        const cstate = cold_states[cold_sel_idx.?];

        var hot_idx: ?usize = null;
        var hot_best_temp: f32 = std.math.inf(f32);
        for (hot_states, 0..) |h, i| {
            if (h.rem <= eps) continue;
            if (h.temp - cstate.temp < dt_min - eps) continue;
            const q_candidate_opt = maxTransferable(h, cstate, dt_min);
            if (q_candidate_opt == null or q_candidate_opt.? <= eps) continue;
            if (h.temp < hot_best_temp) {
                hot_best_temp = h.temp;
                hot_idx = i;
            }
        }

        if (hot_idx == null) {
            // No compatible hot: add heater utility to this cold stream
            try exchangers.append(allocator, .{
                .hot_end = null,
                .cold_end = cstate.index,
                .load_MW = cstate.rem,
            });
            cold_states[cold_sel_idx.?].rem = 0.0;
            continue;
        }

        const hstate = hot_states[hot_idx.?];

        const q_limit_opt = maxTransferable(hstate, cstate, dt_min);
        if (q_limit_opt == null) {
            // Incompatible by temperature: use heater on cold stream
            try exchangers.append(allocator, .{
                .hot_end = null,
                .cold_end = cstate.index,
                .load_MW = cstate.rem,
            });
            cold_states[cold_sel_idx.?].rem = 0.0;
            continue;
        }
        var q_hex = q_limit_opt.?;
        q_hex = @min(q_hex, hstate.rem);
        q_hex = @min(q_hex, cstate.rem);
        if (q_hex <= eps) {
            // Degenerate transfer: fall back to utility on cold
            try exchangers.append(allocator, .{
                .hot_end = null,
                .cold_end = cstate.index,
                .load_MW = cstate.rem,
            });
            cold_states[cold_sel_idx.?].rem = 0.0;
            continue;
        }

        // Record exchanger
        try exchangers.append(allocator, .{
            .hot_end = hstate.index,
            .cold_end = cstate.index,
            .load_MW = q_hex,
        });

        // Update states
        if (!hot_states[hot_idx.?].isothermal and hot_states[hot_idx.?].rate > eps)
            hot_states[hot_idx.?].temp -= q_hex / hot_states[hot_idx.?].rate;
        if (!cold_states[cold_sel_idx.?].isothermal and cold_states[cold_sel_idx.?].rate > eps)
            cold_states[cold_sel_idx.?].temp += q_hex / cold_states[cold_sel_idx.?].rate;

        hot_states[hot_idx.?].rem -= q_hex;
        cold_states[cold_sel_idx.?].rem -= q_hex;
    }

    // Verify no residual duties remain (beyond utilities)
    var residual_hot: f32 = 0.0;
    for (hot_states) |h| residual_hot += h.rem;
    var residual_cold: f32 = 0.0;
    for (cold_states) |c| residual_cold += c.rem;

    // If anything remains unmatched, cover it with minimal one-ended utilities (one per side)
    if (residual_hot > eps) {
        var best_idx: ?u16 = null;
        var best_rem: f32 = 0.0;
        for (hot_states) |h| {
            if (h.rem > best_rem) {
                best_rem = h.rem;
                best_idx = h.index;
            }
        }
        if (best_idx) |idx| {
            try exchangers.append(allocator, .{
                .hot_end = idx,
                .cold_end = null,
                .load_MW = residual_hot,
            });
        }
    }
    if (residual_cold > eps) {
        var best_idx: ?u16 = null;
        var best_rem: f32 = 0.0;
        for (cold_states) |c| {
            if (c.rem > best_rem) {
                best_rem = c.rem;
                best_idx = c.index;
            }
        }
        if (best_idx) |idx| {
            try exchangers.append(allocator, .{
                .hot_end = null,
                .cold_end = idx,
                .load_MW = residual_cold,
            });
        }
    }

    return exchangers.toOwnedSlice(allocator);
}

/// Convenience: run synthesis and write TOML [[exchanger]] list to `writer`.
pub fn solveAndWrite(
    allocator: std.mem.Allocator,
    system: common.HeatSystem,
    writer: anytype,
) !void {
    const exchangers = try synthesize(allocator, system);
    defer allocator.free(exchangers);

    try writeTomlSolution(writer, exchangers);
}

/// Emit TOML for the exchangers only (table array [[exchanger]]).
pub fn writeTomlSolution(
    writer: anytype,
    exchangers: []const common.HeatExchanger,
) !void {
    for (exchangers) |ex| {
        try writer.writeAll("[[exchanger]]\n");
        if (ex.hot_end) |h| {
            try writer.print("hot = {d}\n", .{h});
        }
        if (ex.cold_end) |c| {
            try writer.print("cold = {d}\n", .{c});
        }
        try writer.print("load = {d:.6}\n\n", .{ex.load_MW});
    }
}
