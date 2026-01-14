const std = @import("std");
const cfg = @import("build.cfg.zig");

pub fn getImports(b: *std.Build, args: anytype) []const std.Build.Module.Import {
    // Почему: zigar собирает в отдельной директории, поэтому пути строим от исходного модуля.
    const common_mod = b.createModule(.{
        .root_source_file = .{ .cwd_relative = cfg.module_dir ++ "../../cli/common.zig" },
        .target = args.target,
        .optimize = args.optimize,
    });

    const multiheat_mod = b.createModule(.{
        .root_source_file = .{ .cwd_relative = cfg.module_dir ++ "../../cli/multiheat.zig" },
        .target = args.target,
        .optimize = args.optimize,
        .imports = &.{
            .{ .name = "common", .module = common_mod },
        },
    });

    const imports = [_]std.Build.Module.Import{
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
