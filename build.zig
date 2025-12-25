const std = @import("std");

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});

    const clap = b.dependency("clap", .{});
    const toml = b.dependency("toml", .{});

    const mod_common = b.addModule("common", .{
        .root_source_file = b.path("src/common.zig"),
        .target = target,
    });
    const mod_multiheat = b.addModule("multiheat", .{
        .root_source_file = b.path("src/multiheat.zig"),
        .target = target,
        .imports = &.{
            .{ .name = "common", .module = mod_common },
        },
    });
    const mod_config = b.addModule("config", .{
        .root_source_file = b.path("src/config.zig"),
        .target = target,
        .imports = &.{
            .{ .name = "common", .module = mod_common },
            .{ .name = "toml", .module = toml.module("toml") },
        },
    });
    const exe = b.addExecutable(.{
        .name = "multiheat",
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/main.zig"),
            .target = target,
            .optimize = optimize,
            .imports = &.{
                .{ .name = "common", .module = mod_common },
                .{ .name = "multiheat", .module = mod_multiheat },
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
