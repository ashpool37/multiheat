const std = @import("std");
const toml = @import("toml");

pub const HeatStream = struct {
    in: f32,
    out: ?f32,
    rate: ?f32,
    load: ?f32,
};

pub const HeatExchanger = struct {
    hot: ?u16,
    cold: ?u16,
    load: f32,
};

pub const MultiheatOptions = struct {
    version: []const u8,
    temp_unit: []const u8,
};

pub const Config = struct {
    multiheat: MultiheatOptions,
    hot: []const HeatStream,
    cold: []const HeatStream,
    exchanger: ?[]const HeatExchanger,
};

pub fn parse(allocator: std.mem.Allocator, file_name: []const u8) !Config {
    var parser = toml.Parser(Config).init(allocator);
    defer parser.deinit();

    var result = try parser.parseFile(file_name);
    defer result.deinit();

    const config = result.value;
    return config;
}

pub fn validate(config: *const Config) bool {
    if (!std.mem.eql(u8, config.multiheat.version, "0.0.1")) return false;
    if (!std.mem.eql(u8, config.multiheat.temp_unit, "K")) return false;
    for (config.hot) |stream| {
        if (stream.out == null) {
            if (stream.load == null) return false;
        } else if (stream.load == null and stream.rate == null)
            return false;
    }
    for (config.cold) |stream| {
        if (stream.out == null) {
            if (stream.load == null) return false;
        } else if (stream.load == null and stream.rate == null)
            return false;
    }
    if (config.exchanger) |exchangers| {
        for (exchangers) |exchanger| {
            if (exchanger.hot == null and exchanger.cold == null) return false;
        }
    }
    return true;
}
