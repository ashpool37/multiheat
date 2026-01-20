const std = @import("std");

/// Версия сборки Multiheat (единственный источник правды).
pub const multiheat_version = .{ .major = 1, .minor = 0, .patch = 0 };

/// Самая ранняя поддерживаемая версия конфигурации (семантическая версия).
pub const earliest_config_version = .{ .major = 0, .minor = 0, .patch = 1 };

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});

    // Build options: версии как compile-time константы для CLI и WASM.
    const opts = b.addOptions();

    opts.addOption(u16, "multiheat_version_major", multiheat_version.major);
    opts.addOption(u16, "multiheat_version_minor", multiheat_version.minor);
    opts.addOption(u16, "multiheat_version_patch", multiheat_version.patch);

    opts.addOption(u16, "earliest_config_version_major", earliest_config_version.major);
    opts.addOption(u16, "earliest_config_version_minor", earliest_config_version.minor);
    opts.addOption(u16, "earliest_config_version_patch", earliest_config_version.patch);

    // Строковые представления полезны для UI/логов и экспорта в Web UI.
    // Имена без суффикса `_str` — чтобы это было единым API (`build_options.multiheat_version` и т.п.).
    opts.addOption(
        []const u8,
        "multiheat_version",
        std.fmt.comptimePrint("{d}.{d}.{d}", .{
            multiheat_version.major,
            multiheat_version.minor,
            multiheat_version.patch,
        }),
    );
    opts.addOption(
        []const u8,
        "earliest_config_version",
        std.fmt.comptimePrint("{d}.{d}.{d}", .{
            earliest_config_version.major,
            earliest_config_version.minor,
            earliest_config_version.patch,
        }),
    );

    const build_options_mod = opts.createModule();

    const clap = b.dependency("clap", .{});
    const toml = b.dependency("toml", .{});

    const mod_common = b.addModule("common", .{
        .root_source_file = b.path("cli/common.zig"),
        .target = target,
        .imports = &.{
            .{ .name = "build_options", .module = build_options_mod },
        },
    });
    const mod_multiheat = b.addModule("multiheat", .{
        .root_source_file = b.path("cli/multiheat.zig"),
        .target = target,
        .imports = &.{
            .{ .name = "build_options", .module = build_options_mod },
            .{ .name = "common", .module = mod_common },
        },
    });
    const mod_graph = b.addModule("graph", .{
        .root_source_file = b.path("cli/graph.zig"),
        .target = target,
        .imports = &.{
            .{ .name = "build_options", .module = build_options_mod },
            .{ .name = "common", .module = mod_common },
            .{ .name = "multiheat", .module = mod_multiheat },
        },
    });
    const mod_config = b.addModule("config", .{
        .root_source_file = b.path("cli/config.zig"),
        .target = target,
        .imports = &.{
            .{ .name = "build_options", .module = build_options_mod },
            .{ .name = "common", .module = mod_common },
            .{ .name = "toml", .module = toml.module("toml") },
        },
    });
    const exe = b.addExecutable(.{
        .name = "multiheat",
        .root_module = b.createModule(.{
            .root_source_file = b.path("cli/main.zig"),
            .target = target,
            .optimize = optimize,
            .imports = &.{
                .{ .name = "build_options", .module = build_options_mod },
                .{ .name = "common", .module = mod_common },
                .{ .name = "multiheat", .module = mod_multiheat },
                .{ .name = "graph", .module = mod_graph },
                .{ .name = "config", .module = mod_config },
                .{ .name = "clap", .module = clap.module("clap") },
            },
        }),
    });

    b.installArtifact(exe);

    const run_step = b.step("run", "Запустить программу");
    const run_cmd = b.addRunArtifact(exe);
    run_step.dependOn(&run_cmd.step);
    run_cmd.step.dependOn(b.getInstallStep());
    if (b.args) |args| {
        run_cmd.addArgs(args);
    }
}
