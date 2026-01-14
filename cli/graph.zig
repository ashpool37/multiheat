const std = @import("std");
const common = @import("common");
const multiheat = @import("multiheat");

/// Формирует представление теплообменной системы в виде mermaid sequenceDiagram.
/// Горячие и холодные потоки трактуются как участники процесса; теплообменники — как
/// акт передачи тепловой мощности; односторонние утилиты отражаются отдельными участниками.
pub fn renderMermaid(
    allocator: std.mem.Allocator,
    system: *const common.HeatSystem,
    writer: anytype,
) !void {
    _ = allocator; // аллокатор не используется в текущей реализации

    try writer.writeAll("sequenceDiagram\n");

    // Объявление участников (горячие и холодные потоки) с фиксацией температур на входе и выходе
    for (system.hot_streams, 0..) |hs, i| {
        try writer.print(
            "    participant H{d} as Hot {d} (Tin={d:.1}, Tout={d:.1})\n",
            .{ i, i, hs.in_temp_K, hs.out_temp_K },
        );
    }
    for (system.cold_streams, 0..) |cs, i| {
        try writer.print(
            "    participant C{d} as Cold {d} (Tin={d:.1}, Tout={d:.1})\n",
            .{ i, i, cs.in_temp_K, cs.out_temp_K },
        );
    }

    // Для односторонних утилит создаётся отдельный участник по факту обнаружения такого аппарата
    var util_hot_count: usize = 0;
    var util_cold_count: usize = 0;

    // Представление теплообменных аппаратов в виде направленных сообщений с величиной тепловой нагрузки
    for (system.exchangers, 0..) |ex, idx| {
        const loadf = @as(f64, @floatCast(ex.load_MW));

        if (ex.hot_end != null and ex.cold_end != null) {
            const h = ex.hot_end.?;
            const c = ex.cold_end.?;
            try writer.print(
                "    H{d}->>C{d}: Ex {d} (load={d:.3})\n",
                .{ h, c, idx, loadf },
            );
        } else if (ex.hot_end != null and ex.cold_end == null) {
            const h = ex.hot_end.?;
            try writer.print(
                "    participant Uc{d} as Cooler {d}\n",
                .{ util_hot_count, util_hot_count },
            );

            try writer.print(
                "    H{d}->>Uc{d}: Ex {d} (load={d:.3})\n",
                .{ h, util_hot_count, idx, loadf },
            );
            util_hot_count += 1;
        } else if (ex.hot_end == null and ex.cold_end != null) {
            const c = ex.cold_end.?;
            try writer.print(
                "    participant Uh{d} as Heater {d}\n",
                .{ util_cold_count, util_cold_count },
            );

            try writer.print(
                "    Uh{d}->>C{d}: Ex {d} (load={d:.3})\n",
                .{ util_cold_count, c, idx, loadf },
            );
            util_cold_count += 1;
        } else {
            // Обменник без концов — считаем невалидным, но всё равно отобразим
            try writer.print(
                "    Note over Ex{d}: недопустимое соединение теплообменного аппарата, нагрузка={d:.3}\n",
                .{ idx, loadf },
            );
        }
    }
}
