const std = @import("std");
const multiheat = @import("multiheat");

pub fn main() !void {
    std.debug.print("{}\n", .{multiheat.isFeasible()});
}
