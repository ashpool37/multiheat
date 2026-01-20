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

pub fn solve2(allocator: std.mem.Allocator, system: *common.HeatSystem) !void {
    // Алгоритм синтеза по методологии диссертации (через эквивалентную двухпоточную модель)
    // в детерминированной инженерной интерпретации:
    //
    // 1) вводим общий температурный каркас (интервалы однородности) по "сдвинутым" температурам:
    //    cold-сторона сдвигается вверх на ΔTmin, чтобы ограничение реализуемости выполнялось автоматически;
    // 2) идём по температуре сверху вниз и накапливаем "пакеты тепла" от горячих потоков;
    // 3) на каждом температурном интервале удовлетворяем потребность холодных потоков
    //    за счёт накопленного тепла (межпоточный обмен), а остаток — за счёт утилит;
    // 4) оставшийся избыток тепла горячих потоков отправляем на охлаждение (cold utility).
    //
    // Важно: API и структуры данных не меняются — на выходе по-прежнему `system.exchangers`.
    const dt_min: f32 = @floatFromInt(system.min_dt);
    const eps: f32 = 1e-6;

    const hot_count = system.hot_streams.len;
    const cold_count = system.cold_streams.len;

    // Базовая валидация входа (минимум, чтобы избежать деления на ноль и отрицательных W).
    for (system.hot_streams) |s| {
        if (!s.isothermal and !(s.rate_MW_per_K > 0)) return Error.Infeasible;
        if (s.isothermal and !(s.load_MW >= 0)) return Error.Infeasible;
    }
    for (system.cold_streams) |s| {
        if (!s.isothermal and !(s.rate_MW_per_K > 0)) return Error.Infeasible;
        if (s.isothermal and !(s.load_MW >= 0)) return Error.Infeasible;
    }

    // Локальные утилиты для вычисления перекрытия температурного интервала.
    const Local = struct {
        fn overlapDeltaT(a0: f32, a1: f32, lo: f32, hi: f32) f32 {
            const a_lo = @min(a0, a1);
            const a_hi = @max(a0, a1);
            const x0 = @max(a_lo, lo);
            const x1 = @min(a_hi, hi);
            return if (x1 > x0) (x1 - x0) else 0.0;
        }
    };

    // 1) Собираем температурные точки (в единой шкале):
    //    - hot: температуры как есть
    //    - cold: температуры, сдвинутые вверх на ΔTmin
    var temps = try std.ArrayList(f32).initCapacity(allocator, (hot_count + cold_count) * 4);
    errdefer temps.deinit(allocator);

    for (system.hot_streams) |s| {
        try temps.append(allocator, s.in_temp_K);
        try temps.append(allocator, s.out_temp_K);
    }
    for (system.cold_streams) |s| {
        try temps.append(allocator, s.in_temp_K + dt_min);
        try temps.append(allocator, s.out_temp_K + dt_min);
    }

    if (temps.items.len == 0) {
        system.exchangers = try allocator.alloc(common.HeatExchanger, 0);
        temps.deinit(allocator);
        return;
    }

    // Сортировка по убыванию (сверху вниз).
    std.sort.pdq(f32, temps.items, {}, lessF32Desc);

    // Удаляем дубликаты.
    var uniq = try std.ArrayList(f32).initCapacity(allocator, temps.items.len);
    errdefer uniq.deinit(allocator);

    {
        var prev: ?f32 = null;
        for (temps.items) |t| {
            if (prev == null or @abs(t - prev.?) > eps) {
                try uniq.append(allocator, t);
                prev = t;
            }
        }
    }

    temps.deinit(allocator);

    if (uniq.items.len < 2) {
        system.exchangers = try allocator.alloc(common.HeatExchanger, 0);
        uniq.deinit(allocator);
        return;
    }

    // 2) Минимизация утилит: heat cascade по температурным интервалам (в сдвинутой шкале ΔTmin).
    //
    // Идея: считаем минимально необходимый внешний нагрев Q_HU так, чтобы на всех уровнях каскада
    // "остаток тепла" не становился отрицательным. Это классическая процедура pinch/heat cascade
    // в дискретной интерпретации по интервалам однородности.
    //
    // Важно: расчёт ведём по СУММАРНЫМ потокам тепла, без привязки к конкретным парам i↔j.
    // Это даёт минимум по суммарной мощности утилит при заданном ΔTmin.
    var hu_total: f32 = 0.0;
    var cascade: f32 = 0.0;

    {
        var kk: usize = 0;
        while (kk + 1 < uniq.items.len) : (kk += 1) {
            const t_hi = uniq.items[kk];
            const t_lo = uniq.items[kk + 1];
            if (!(t_hi > t_lo + eps)) continue;

            var hot_sum: f32 = 0.0;
            var cold_sum: f32 = 0.0;

            // Горячие: изотермы на границе t_hi + неизотермические вклады на [t_lo, t_hi]
            for (system.hot_streams) |s| {
                if (s.isothermal) {
                    if (@abs(s.in_temp_K - t_hi) <= eps and s.load_MW > eps) hot_sum += s.load_MW;
                } else {
                    const dT = Local.overlapDeltaT(s.in_temp_K, s.out_temp_K, t_lo, t_hi);
                    if (dT > eps) hot_sum += s.rate_MW_per_K * dT;
                }
            }

            // Холодные: изотермы на границе t_hi (в сдвинутой шкале) + неизотермические вклады на [t_lo, t_hi]
            for (system.cold_streams) |s| {
                if (s.isothermal) {
                    const t_shift = s.in_temp_K + dt_min;
                    if (@abs(t_shift - t_hi) <= eps and s.load_MW > eps) cold_sum += s.load_MW;
                } else {
                    const in_s = s.in_temp_K + dt_min;
                    const out_s = s.out_temp_K + dt_min;
                    const dT = Local.overlapDeltaT(in_s, out_s, t_lo, t_hi);
                    if (dT > eps) cold_sum += s.rate_MW_per_K * dT;
                }
            }

            cascade += hot_sum - cold_sum;
            if (cascade < -eps) {
                hu_total += -cascade;
                cascade = 0.0;
            }
        }

        // Обработка изотерм на минимальной температурной границе (t_last),
        // которые иначе могли бы "выпасть" из интервалов.
        const t_last_cascade = uniq.items[uniq.items.len - 1];
        var hot_tail: f32 = 0.0;
        var cold_tail: f32 = 0.0;

        for (system.hot_streams) |s| {
            if (s.isothermal and @abs(s.in_temp_K - t_last_cascade) <= eps and s.load_MW > eps) {
                hot_tail += s.load_MW;
            }
        }
        for (system.cold_streams) |s| {
            if (s.isothermal) {
                const t_shift = s.in_temp_K + dt_min;
                if (@abs(t_shift - t_last_cascade) <= eps and s.load_MW > eps) cold_tail += s.load_MW;
            }
        }

        cascade += hot_tail - cold_tail;
        if (cascade < -eps) {
            hu_total += -cascade;
            cascade = 0.0;
        }
    }

    var hu_remaining: f32 = hu_total;

    // 3) Пулы доступного тепла по горячим потокам (каскад по температуре в эквивалентной модели).
    // Важно: тепло, накопленное на более высоких температурных уровнях, может использоваться ниже
    // (в пределах реализуемости), поэтому этот массив живёт на всём проходе по интервалам.
    var hot_avail = try allocator.alloc(f32, hot_count);
    defer allocator.free(hot_avail);
    @memset(hot_avail, 0.0);

    // 4) Накопители утилит (по одному устройству на поток, чтобы не раздувать решение).
    var heater_load = try allocator.alloc(f32, cold_count);
    defer allocator.free(heater_load);
    @memset(heater_load, 0.0);

    var cooler_load = try allocator.alloc(f32, hot_count);
    defer allocator.free(cooler_load);
    @memset(cooler_load, 0.0);

    // 5) Собираем получающиеся аппараты.
    var exchangers = try std.ArrayList(common.HeatExchanger).initCapacity(allocator, 0);
    errdefer exchangers.deinit(allocator);

    // Основной проход по температурным интервалам сверху вниз (каскадирование тепла).
    //
    // Важно:
    // - `hot_avail[i]` — остаток доступного тепла горячего потока i, накопленный на текущем и более высоких уровнях;
    // - на каждом интервале мы добавляем вклад потоков, активных на этом интервале,
    //   а затем покрываем спрос холодных потоков за счёт накопленного остатка;
    // - дефицит покрывается ИЗ ОГРАНИЧЕННОГО ПУЛА `hu_remaining`, рассчитанного heat cascade (минимальные утилиты).
    var k: usize = 0;
    while (k + 1 < uniq.items.len) : (k += 1) {
        const t_hi = uniq.items[k];
        const t_lo = uniq.items[k + 1];
        if (!(t_hi > t_lo + eps)) continue;

        // 4.1) Добавляем доступное тепло горячих потоков в этом интервале (вклад в каскад).
        // Изотермические горячие нагрузки на границе t_hi (точечные пакеты).
        for (system.hot_streams, 0..) |s, i| {
            if (!s.isothermal) continue;
            if (@abs(s.in_temp_K - t_hi) <= eps and s.load_MW > eps) {
                hot_avail[i] += s.load_MW;
            }
        }
        // Неизотермические горячие участки: W * ΔT на перекрытии с интервалом.
        for (system.hot_streams, 0..) |s, i| {
            if (s.isothermal) continue;
            const dT = Local.overlapDeltaT(s.in_temp_K, s.out_temp_K, t_lo, t_hi);
            if (dT > eps) hot_avail[i] += s.rate_MW_per_K * dT;
        }

        // 4.2) Спрос холодных потоков на этом интервале (в сдвинутой шкале).
        var cold_demand = try allocator.alloc(f32, cold_count);
        defer allocator.free(cold_demand);
        @memset(cold_demand, 0.0);

        // Изотермические холодные нагрузки (точечные пакеты в t_hi с учётом сдвига).
        for (system.cold_streams, 0..) |s, j| {
            if (!s.isothermal) continue;
            const t_shift = s.in_temp_K + dt_min;
            if (@abs(t_shift - t_hi) <= eps and s.load_MW > eps) {
                cold_demand[j] += s.load_MW;
            }
        }
        // Неизотермические холодные участки: W * ΔT на перекрытии с интервалом (в сдвинутой шкале).
        for (system.cold_streams, 0..) |s, j| {
            if (s.isothermal) continue;
            const in_s = s.in_temp_K + dt_min;
            const out_s = s.out_temp_K + dt_min;
            const dT = Local.overlapDeltaT(in_s, out_s, t_lo, t_hi);
            if (dT > eps) cold_demand[j] += s.rate_MW_per_K * dT;
        }

        // 4.3) Распределение тепла (детерминированно): покрываем спрос из hot_avail.
        // Важно: `hot_ptr` сбрасываем на каждом интервале, иначе можно пропустить поток,
        // который "включился" (стал активным) на более низком уровне, но имеет меньший индекс.
        var hot_ptr: usize = 0;

        for (cold_demand, 0..) |_, j| {
            var d = cold_demand[j];
            if (!(d > eps)) continue;

            while (d > eps) {
                while (hot_ptr < hot_count and !(hot_avail[hot_ptr] > eps)) : (hot_ptr += 1) {}
                if (hot_ptr >= hot_count) break;

                const q = @min(d, hot_avail[hot_ptr]);
                if (q <= eps) break;

                try exchangers.append(allocator, .{
                    .hot_end = @intCast(hot_ptr),
                    .cold_end = @intCast(j),
                    .load_MW = q,
                });

                hot_avail[hot_ptr] -= q;
                d -= q;
            }

            if (d > eps) {
                // Дефицит тепла на этом температурном уровне: покрываем внешним нагревом (hot utility).
                // Для минимума утилит используем заранее рассчитанный пул `hu_remaining`.
                const q_hu = @min(d, hu_remaining);
                if (q_hu > eps) {
                    heater_load[j] += q_hu;
                    hu_remaining -= q_hu;
                    d -= q_hu;
                }
                // Если после использования пула дефицит всё ещё есть — значит, входные данные/сдвиг
                // или расчёт каскада несовместимы с текущей процедурой синтеза.
                if (d > 1e-4) return Error.Infeasible;
            }
        }
    }

    // 4.4) Корректный учёт изотермических пакетов на минимальной температурной границе.
    // Ранее такие изотермы могли выпадать из рассмотрения, потому что t_last не является t_hi ни для одного интервала.
    const t_last = uniq.items[uniq.items.len - 1];

    // Добавляем изотермические горячие нагрузки на t_last.
    for (system.hot_streams, 0..) |s, i| {
        if (!s.isothermal) continue;
        if (@abs(s.in_temp_K - t_last) <= eps and s.load_MW > eps) {
            hot_avail[i] += s.load_MW;
        }
    }

    // Закрываем возможные изотермические холодные нагрузки на t_last (в сдвинутой шкале).
    var cold_tail = try allocator.alloc(f32, cold_count);
    defer allocator.free(cold_tail);
    @memset(cold_tail, 0.0);

    for (system.cold_streams, 0..) |s, j| {
        if (!s.isothermal) continue;
        const t_shift = s.in_temp_K + dt_min;
        if (@abs(t_shift - t_last) <= eps and s.load_MW > eps) {
            cold_tail[j] += s.load_MW;
        }
    }

    var hot_ptr_tail: usize = 0;
    for (cold_tail, 0..) |_, j| {
        var d = cold_tail[j];
        if (!(d > eps)) continue;

        while (d > eps) {
            while (hot_ptr_tail < hot_count and !(hot_avail[hot_ptr_tail] > eps)) : (hot_ptr_tail += 1) {}
            if (hot_ptr_tail >= hot_count) break;

            const q = @min(d, hot_avail[hot_ptr_tail]);
            if (q <= eps) break;

            try exchangers.append(allocator, .{
                .hot_end = @intCast(hot_ptr_tail),
                .cold_end = @intCast(j),
                .load_MW = q,
            });

            hot_avail[hot_ptr_tail] -= q;
            d -= q;
        }

        if (d > eps) {
            const q_hu = @min(d, hu_remaining);
            if (q_hu > eps) {
                heater_load[j] += q_hu;
                hu_remaining -= q_hu;
                d -= q_hu;
            }
            if (d > 1e-4) return Error.Infeasible;
        }
    }

    // 4.5) Остаток горячего тепла после каскада отправляем в охлаждение (cold utility) по соответствующим hot-потокам.
    // Если heat cascade посчитан корректно, суммарная мощность cold utility будет минимальной (при данном ΔTmin).
    for (hot_avail, 0..) |q_left, i| {
        if (q_left > eps) cooler_load[i] += q_left;
    }

    // 5) Добавляем утилиты в виде односторонних аппаратов.
    for (heater_load, 0..) |q, j| {
        if (!(q > eps)) continue;
        try exchangers.append(allocator, .{
            .hot_end = null,
            .cold_end = @intCast(j),
            .load_MW = q,
        });
    }
    for (cooler_load, 0..) |q, i| {
        if (!(q > eps)) continue;
        try exchangers.append(allocator, .{
            .hot_end = @intCast(i),
            .cold_end = null,
            .load_MW = q,
        });
    }

    // 7) Компактизация: суммируем одинаковые пары (hot_end, cold_end),
    // чтобы уменьшить число элементов решения.
    const Cmp = struct {
        fn keyOpt(v: ?u16) u16 {
            return v orelse 0xFFFF;
        }
        fn less(_: void, a: common.HeatExchanger, b: common.HeatExchanger) bool {
            const ah = keyOpt(a.hot_end);
            const bh = keyOpt(b.hot_end);
            if (ah != bh) return ah < bh;
            const ac = keyOpt(a.cold_end);
            const bc = keyOpt(b.cold_end);
            return ac < bc;
        }
        fn same(a: common.HeatExchanger, b: common.HeatExchanger) bool {
            return (keyOpt(a.hot_end) == keyOpt(b.hot_end)) and (keyOpt(a.cold_end) == keyOpt(b.cold_end));
        }
    };

    std.sort.pdq(common.HeatExchanger, exchangers.items, {}, Cmp.less);

    var compact = try std.ArrayList(common.HeatExchanger).initCapacity(allocator, exchangers.items.len);
    errdefer compact.deinit(allocator);

    for (exchangers.items) |ex| {
        if (!(ex.load_MW > eps)) continue;

        if (compact.items.len == 0) {
            try compact.append(allocator, ex);
            continue;
        }

        const last_idx = compact.items.len - 1;
        if (Cmp.same(compact.items[last_idx], ex)) {
            compact.items[last_idx].load_MW += ex.load_MW;
        } else {
            try compact.append(allocator, ex);
        }
    }

    exchangers.deinit(allocator);
    uniq.deinit(allocator);

    system.exchangers = try compact.toOwnedSlice(allocator);
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
