const std = @import("std");
const common = @import("common");

pub const Error = error{
    Infeasible,
    NoCompatiblePair,
    Unbalanced,
};

const Side = enum { hot, cold };

const StreamState = struct {
    side: Side,
    index: u16,
    isothermal: bool,
    temp: f32,
    target: f32,
    rate: f32, // МВт/К; нулевое значение для изотермических участков
    rem: f32, // Остаточная тепловая нагрузка, подлежащая передаче (МВт)
};

pub fn computeRequiredLoad(stream: common.HeatStream) f32 {
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
        // Оба потока изотермические: единственное ограничение — минимально допустимый температурный напор
        return if (d0 < dt_min - eps) null else std.math.inf(f32);
    }
}

pub fn solve(allocator: std.mem.Allocator, system: *common.HeatSystem) !void {
    const dt_min: f32 = @floatFromInt(system.min_dt);

    const hot_count = system.hot_streams.len;
    const cold_count = system.cold_streams.len;

    var hot_states = try allocator.alloc(StreamState, hot_count);
    var cold_states = try allocator.alloc(StreamState, cold_count);
    defer allocator.free(hot_states);
    defer allocator.free(cold_states);

    const eps: f32 = 1e-6;

    for (system.hot_streams, 0..) |s, i| {
        hot_states[i] = initState(.hot, @intCast(i), s);
    }
    for (system.cold_streams, 0..) |s, i| {
        cold_states[i] = initState(.cold, @intCast(i), s);
    }

    var exchangers = try std.ArrayList(common.HeatExchanger).initCapacity(allocator, 0);
    errdefer exchangers.deinit(allocator);

    // Жадный перебор пар с постановкой односторонних утилит при отсутствии совместимости
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
            // При отсутствии совместимого горячего потока нагреватель ставится на наиболее горячий из оставшихся холодных
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
            break; // все холодные потоки удовлетворены
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
            // При отсутствии совместимого горячего потока остаток холодного покрывается нагревателем
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
            // Температурная несовместимость: весь остаток холодного покрывается нагревателем
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
            // Вырожденный режим: остаток холодного перекладывается на нагреватель
            try exchangers.append(allocator, .{
                .hot_end = null,
                .cold_end = cstate.index,
                .load_MW = cstate.rem,
            });
            cold_states[cold_sel_idx.?].rem = 0.0;
            continue;
        }

        // Фиксация синтезированного теплообменного аппарата
        try exchangers.append(allocator, .{
            .hot_end = hstate.index,
            .cold_end = cstate.index,
            .load_MW = q_hex,
        });

        // Коррекция текущих температурных состояний потоков
        if (!hot_states[hot_idx.?].isothermal and hot_states[hot_idx.?].rate > eps)
            hot_states[hot_idx.?].temp -= q_hex / hot_states[hot_idx.?].rate;
        if (!cold_states[cold_sel_idx.?].isothermal and cold_states[cold_sel_idx.?].rate > eps)
            cold_states[cold_sel_idx.?].temp += q_hex / cold_states[cold_sel_idx.?].rate;

        hot_states[hot_idx.?].rem -= q_hex;
        cold_states[cold_sel_idx.?].rem -= q_hex;
    }

    // Финальные несбалансированные нагрузки покрываются минимальным числом односторонних утилит
    var residual_hot: f32 = 0.0;
    for (hot_states) |h| residual_hot += h.rem;
    var residual_cold: f32 = 0.0;
    for (cold_states) |c| residual_cold += c.rem;

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

    system.exchangers = try exchangers.toOwnedSlice(allocator);
}

// Проверка баланса готового решения: суммарные тепловые нагрузки горячей и холодной подсистем должны совпадать.
pub fn verifySolution(allocator: std.mem.Allocator, system: *const common.HeatSystem) !void {
    _ = allocator;
    const eps: f32 = 1e-3;

    const hot_len = system.hot_streams.len;
    const cold_len = system.cold_streams.len;

    var total_hot_req: f32 = 0;
    var total_cold_req: f32 = 0;
    for (system.hot_streams) |s| total_hot_req += computeRequiredLoad(s);
    for (system.cold_streams) |s| total_cold_req += computeRequiredLoad(s);

    var total_hot_got: f32 = 0;
    var total_cold_got: f32 = 0;

    for (system.exchangers) |ex| {
        if (ex.hot_end == null and ex.cold_end == null) return Error.Unbalanced;
        if (!(ex.load_MW > 0)) return Error.Unbalanced;
        if (ex.hot_end) |h| {
            if (h >= hot_len) return Error.Unbalanced;
            total_hot_got += ex.load_MW;
        }
        if (ex.cold_end) |c| {
            if (c >= cold_len) return Error.Unbalanced;
            total_cold_got += ex.load_MW;
        }
    }

    if (@abs(total_hot_got - total_hot_req) > eps) return Error.Unbalanced;
    if (@abs(total_cold_got - total_cold_req) > eps) return Error.Unbalanced;
}

// ----------------------------
// Эквивалентные температурные кривые T+(Q), T-(Q) для визуализации
// ----------------------------

fn lessF32Asc(_: void, a: f32, b: f32) bool {
    return a < b;
}
fn lessF32Desc(_: void, a: f32, b: f32) bool {
    return a > b;
}

fn buildUniqueSortedTemps(
    allocator: std.mem.Allocator,
    streams: []const common.HeatStream,
    descending: bool,
) ![]f32 {
    var temps = try std.ArrayList(f32).initCapacity(allocator, streams.len * 2);
    errdefer temps.deinit(allocator);

    for (streams) |s| {
        // Для изотермических участков in==out, но оставим оба добавления — затем уберём дубликаты.
        try temps.append(allocator, s.in_temp_K);
        try temps.append(allocator, s.out_temp_K);
    }

    if (temps.items.len == 0) {
        temps.deinit(allocator);
        return try allocator.alloc(f32, 0);
    }

    if (descending) {
        std.sort.pdq(f32, temps.items, {}, lessF32Desc);
    } else {
        std.sort.pdq(f32, temps.items, {}, lessF32Asc);
    }

    const eps: f32 = 1e-6;
    var uniq = try std.ArrayList(f32).initCapacity(allocator, temps.items.len);
    errdefer uniq.deinit(allocator);

    for (temps.items) |t| {
        if (uniq.items.len == 0) {
            try uniq.append(allocator, t);
            continue;
        }
        const prev = uniq.items[uniq.items.len - 1];
        if (@abs(t - prev) > eps) try uniq.append(allocator, t);
    }

    temps.deinit(allocator);
    return try uniq.toOwnedSlice(allocator);
}

fn sumIsothermalLoadAtTemp(
    streams: []const common.HeatStream,
    temp_K: f32,
) f32 {
    const eps: f32 = 1e-6;
    var total: f32 = 0.0;
    for (streams) |s| {
        if (!s.isothermal) continue;
        if (@abs(s.in_temp_K - temp_K) <= eps) total += s.load_MW;
    }
    return total;
}

fn sumActiveRateOnInterval(
    streams: []const common.HeatStream,
    t0: f32,
    t1: f32,
) f32 {
    // Сумма теплоёмкостных расходов (МВт/К) всех неизотермических потоков,
    // которые полностью покрывают температурный интервал.
    const eps: f32 = 1e-6;
    const lo_int = @min(t0, t1);
    const hi_int = @max(t0, t1);

    var w_total: f32 = 0.0;
    for (streams) |s| {
        if (s.isothermal) continue;
        const lo = @min(s.in_temp_K, s.out_temp_K);
        const hi = @max(s.in_temp_K, s.out_temp_K);
        if (lo <= lo_int + eps and hi >= hi_int - eps) {
            w_total += s.rate_MW_per_K;
        }
    }
    return w_total;
}

fn buildEquivalentCurve(
    allocator: std.mem.Allocator,
    streams: []const common.HeatStream,
) ![]common.EqCurvePoint {
    const eps: f32 = 1e-6;

    // Важно: строим обе кривые в возрастающем направлении температуры (как в run.ijs),
    // чтобы на графике обе зависимости были монотонно возрастающими по T при росте Q.
    const temps = try buildUniqueSortedTemps(allocator, streams, false);
    defer allocator.free(temps);

    if (temps.len == 0) return try allocator.alloc(common.EqCurvePoint, 0);

    var points = try std.ArrayList(common.EqCurvePoint).initCapacity(allocator, temps.len * 2);
    errdefer points.deinit(allocator);

    var q_acc: f32 = 0.0;

    // Стартовая точка: Q=0 на минимальной температуре.
    try points.append(allocator, .{ .q_MW = 0.0, .temp_K = temps[0] });

    var i: usize = 0;
    while (i + 1 < temps.len) : (i += 1) {
        const t0 = temps[i];
        const t1 = temps[i + 1];

        // Температура возрастает: t1 >= t0.
        const dT = @abs(t1 - t0);
        if (dT > eps) {
            const w_total = sumActiveRateOnInterval(streams, t0, t1);
            if (w_total > eps) {
                q_acc += w_total * dT;
            }
            // Даже если w_total==0, точку температурного излома фиксируем для визуализации.
            // Это делает кривую “кусочно-линейной” по заданной сетке температур.
            if (@abs(points.items[points.items.len - 1].temp_K - t1) > eps) {
                try points.append(allocator, .{ .q_MW = q_acc, .temp_K = t1 });
            } else if (@abs(points.items[points.items.len - 1].q_MW - q_acc) > eps) {
                try points.append(allocator, .{ .q_MW = q_acc, .temp_K = t1 });
            }
        }

        // Изотермические участки на температуре t1 дают “плато” (рост Q при постоянной T).
        const q_iso = sumIsothermalLoadAtTemp(streams, t1);
        if (q_iso > eps) {
            q_acc += q_iso;
            try points.append(allocator, .{ .q_MW = q_acc, .temp_K = t1 });
        }
    }

    return try points.toOwnedSlice(allocator);
}

fn minMaxSystemTemp(system: *const common.HeatSystem) struct { min: f32, max: f32 } {
    var min_t: f32 = std.math.inf(f32);
    var max_t: f32 = -std.math.inf(f32);

    for (system.hot_streams) |s| {
        min_t = @min(min_t, @min(s.in_temp_K, s.out_temp_K));
        max_t = @max(max_t, @max(s.in_temp_K, s.out_temp_K));
    }
    for (system.cold_streams) |s| {
        min_t = @min(min_t, @min(s.in_temp_K, s.out_temp_K));
        max_t = @max(max_t, @max(s.in_temp_K, s.out_temp_K));
    }

    if (!std.math.isFinite(min_t)) min_t = 0.0;
    if (!std.math.isFinite(max_t)) max_t = 0.0;
    return .{ .min = min_t, .max = max_t };
}

fn totalRequired(streams: []const common.HeatStream) f32 {
    var total: f32 = 0.0;
    for (streams) |s| total += computeRequiredLoad(s);
    return total;
}

/// Построить эквивалентные температурные кривые (T+(Q), T-(Q)) для текущей системы.
///
/// Важно:
/// - кривые строятся независимо для горячей и холодной стороны по определению эквивалентной модели;
/// - если суммарные тепловые нагрузки горячей/холодной подсистем не совпадают,
///   добавляется одна синтетическая изотермическая “утилита” (нагреватель или охладитель),
///   чтобы обе кривые имели одинаковую финальную Q (как в run.ijs).
pub fn computeEquivalentCurves(
    allocator: std.mem.Allocator,
    system: *const common.HeatSystem,
) !common.EquivalentCurves {
    const dt_min: f32 = @floatFromInt(system.min_dt);
    const def_dt: f32 = @floatFromInt(system.def_dt);

    const totals = minMaxSystemTemp(system);
    const t_min = totals.min;
    const t_max = totals.max;

    const q_hot = totalRequired(system.hot_streams);
    const q_cold = totalRequired(system.cold_streams);
    const qd: f32 = q_cold - q_hot;

    var hot_buf = try std.ArrayList(common.HeatStream).initCapacity(
        allocator,
        system.hot_streams.len + 1,
    );
    errdefer hot_buf.deinit(allocator);
    try hot_buf.appendSlice(allocator, system.hot_streams);

    var cold_buf = try std.ArrayList(common.HeatStream).initCapacity(
        allocator,
        system.cold_streams.len + 1,
    );
    errdefer cold_buf.deinit(allocator);
    try cold_buf.appendSlice(allocator, system.cold_streams);

    const eps: f32 = 1e-6;
    if (qd > eps) {
        // Не хватает тепла горячих: добавляем “горячую утилиту” как изотермический горячий поток сверху.
        const t_util = t_max + def_dt;
        try hot_buf.append(allocator, .{
            .isothermal = true,
            .in_temp_K = t_util,
            .out_temp_K = t_util,
            .rate_MW_per_K = 0.0,
            .load_MW = qd,
        });
    } else if (qd < -eps) {
        // Избыток тепла горячих: добавляем “холодную утилиту” как изотермический холодный поток снизу.
        const t_util = t_min - def_dt;
        try cold_buf.append(allocator, .{
            .isothermal = true,
            .in_temp_K = t_util,
            .out_temp_K = t_util,
            .rate_MW_per_K = 0.0,
            .load_MW = -qd,
        });
    }

    const hot_curve = try buildEquivalentCurve(allocator, hot_buf.items);
    errdefer allocator.free(hot_curve);

    const cold_curve = try buildEquivalentCurve(allocator, cold_buf.items);
    errdefer allocator.free(cold_curve);

    hot_buf.deinit(allocator);
    cold_buf.deinit(allocator);

    return .{
        .dt_min_K = dt_min,
        .hot = hot_curve,
        .cold = cold_curve,
    };
}

/// Освободить память, выделенную `computeEquivalentCurves`.
/// Почему: кривые возвращаются как срезы, которые должны быть освобождены явным вызовом.
pub fn freeEquivalentCurves(
    allocator: std.mem.Allocator,
    curves: *common.EquivalentCurves,
) void {
    allocator.free(curves.hot);
    allocator.free(curves.cold);
    curves.hot = &.{};
    curves.cold = &.{};
    curves.dt_min_K = 0.0;
}
