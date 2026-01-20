const std = @import("std");
const cfg = @import("build.cfg.zig");

// Версии должны задаваться в корневом build.zig как единственный источник правды.
// Однако zigar компилирует этот build.extra.zig в отдельном модульном окружении и запрещает
// `@import("../../build.zig")` (import outside module path).
//
// Поэтому версии извлекаются из build.zig как текст и преобразуются в build_options для WASM-сборки.

const VersionTriplet = struct {
    major: u16,
    minor: u16,
    patch: u16,
};

fn parseU16Field(scope: []const u8, needle: []const u8) !u16 {
    const pos = std.mem.indexOf(u8, scope, needle) orelse return error.MissingField;
    var i: usize = pos + needle.len;

    // Пропустить пробелы
    while (i < scope.len and (scope[i] == ' ' or scope[i] == '\t')) : (i += 1) {}

    // Прочитать десятичное целое
    const start = i;
    while (i < scope.len and scope[i] >= '0' and scope[i] <= '9') : (i += 1) {}
    if (i == start) return error.InvalidField;

    const n_u32 = try std.fmt.parseUnsigned(u32, scope[start..i], 10);
    if (n_u32 > std.math.maxInt(u16)) return error.InvalidField;
    return @intCast(n_u32);
}

fn parseVersionTripletFromBuildZig(text: []const u8, decl_name: []const u8) !VersionTriplet {
    // Ожидаемый формат (как в корневом build.zig):
    // pub const <decl_name> = .{ .major = X, .minor = Y, .patch = Z };
    const decl_pos = std.mem.indexOf(u8, text, decl_name) orelse return error.MissingDecl;

    // Ограничить область поиска до "разумного окна" после объявления, чтобы не зацепить другие совпадения.
    const window = text[decl_pos..@min(text.len, decl_pos + 512)];

    const major = try parseU16Field(window, ".major = ");
    const minor = try parseU16Field(window, ".minor = ");
    const patch = try parseU16Field(window, ".patch = ");

    return .{ .major = major, .minor = minor, .patch = patch };
}

pub fn getImports(b: *std.Build, args: anytype) []const std.Build.Module.Import {
    // Прочитать корневой build.zig как текст.
    const build_zig_path = cfg.module_dir ++ "../../build.zig";
    const build_zig_text = std.fs.cwd().readFileAlloc(
        b.allocator,
        build_zig_path,
        1024 * 1024,
    ) catch |err| {
        std.debug.panic("Не удалось прочитать build.zig для извлечения версий: {s}: {any}", .{
            build_zig_path,
            err,
        });
    };
    defer b.allocator.free(build_zig_text);

    const mv = parseVersionTripletFromBuildZig(build_zig_text, "multiheat_version") catch |err| {
        std.debug.panic("Не удалось извлечь multiheat_version из build.zig: {any}", .{err});
    };
    const ev = parseVersionTripletFromBuildZig(build_zig_text, "earliest_config_version") catch |err| {
        std.debug.panic("Не удалось извлечь earliest_config_version из build.zig: {any}", .{err});
    };

    // Build options для WASM-сборки (версии передаются как compile-time константы в Zig/WASM и далее в Web UI).
    const opts = b.addOptions();

    opts.addOption(u16, "multiheat_version_major", mv.major);
    opts.addOption(u16, "multiheat_version_minor", mv.minor);
    opts.addOption(u16, "multiheat_version_patch", mv.patch);
    opts.addOption([]const u8, "multiheat_version", b.fmt("{d}.{d}.{d}", .{ mv.major, mv.minor, mv.patch }));

    opts.addOption(u16, "earliest_config_version_major", ev.major);
    opts.addOption(u16, "earliest_config_version_minor", ev.minor);
    opts.addOption(u16, "earliest_config_version_patch", ev.patch);
    opts.addOption([]const u8, "earliest_config_version", b.fmt("{d}.{d}.{d}", .{ ev.major, ev.minor, ev.patch }));

    const build_options_mod = opts.createModule();

    // Почему: zigar собирает в отдельной директории, поэтому пути строим от исходного модуля.
    const common_mod = b.createModule(.{
        .root_source_file = .{ .cwd_relative = cfg.module_dir ++ "../../cli/common.zig" },
        .target = args.target,
        .optimize = args.optimize,
        .imports = &.{
            .{ .name = "build_options", .module = build_options_mod },
        },
    });

    const multiheat_mod = b.createModule(.{
        .root_source_file = .{ .cwd_relative = cfg.module_dir ++ "../../cli/multiheat.zig" },
        .target = args.target,
        .optimize = args.optimize,
        .imports = &.{
            .{ .name = "build_options", .module = build_options_mod },
            .{ .name = "common", .module = common_mod },
        },
    });

    const imports = [_]std.Build.Module.Import{
        .{ .name = "build_options", .module = build_options_mod },
        .{ .name = "common", .module = common_mod },
        .{ .name = "multiheat", .module = multiheat_mod },
    };
    return &imports;
}

pub fn getCSourceFiles(_: *std.Build, _: anytype) []const []const u8 {
    return &.{};
}

pub fn getIncludePaths(_: *std.Build, _: anytype) []const []const u8 {
    return &.{};
}
