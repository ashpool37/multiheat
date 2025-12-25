const std = @import("std");
const toml = @import("toml");

const common = @import("common");

fn isFiniteNonNegative(maybe_float: ?f32) bool {
    if (maybe_float) |value| {
        return std.math.isFinite(value) and value >= 0.0;
    } else return false;
}

fn isFinitePositive(maybe_float: ?f32) bool {
    if (maybe_float) |value| {
        return std.math.isFinite(value) and value > 0.0;
    } else return false;
}

pub const HeatStream = struct {
    in: f32,
    out: ?f32,
    rate: ?f32,
    load: ?f32,

    pub fn isValid(self: *const HeatStream) bool {
        if (!isFiniteNonNegative(self.in)) return false;
        if (self.out) |out| {
            if (!isFiniteNonNegative(out)) return false;
            if (out == self.in) {
                if (!isFinitePositive(self.load)) return false;
            } else if (!isFinitePositive(self.load) and !isFinitePositive(self.rate))
                return false;
        } else if (!isFinitePositive(self.load) and !isFinitePositive(self.rate))
            return false;
        return true;
    }

    pub fn toSystem(self: *const HeatStream) common.HeatStream {
        var result: common.HeatStream = undefined;
        result.in_temp_K = self.in;
        if (self.out == null or self.out.? == self.in) {
            result.isothermal = true;
            result.out_temp_K = self.in;
            result.load_MW = self.load.?;
        } else {
            result.isothermal = false;
            result.out_temp_K = self.out.?;
            if (self.rate) |rate| {
                result.rate_MW_per_K = rate;
                result.load_MW = rate *
                    @abs(result.out_temp_K - result.in_temp_K);
            } else if (self.load) |load| {
                result.load_MW = load;
                result.rate_MW_per_K = load /
                    @abs(result.out_temp_K - result.in_temp_K);
            }
        }
        return result;
    }
};

pub const HeatExchanger = struct {
    hot: ?u16,
    cold: ?u16,
    load: f32,

    pub fn isValid(self: *const HeatExchanger) bool {
        if (self.hot == null and self.cold == null) return false;
        if (!isFinitePositive(self.load)) return false;

        return true;
    }

    pub fn toSystem(self: *const HeatExchanger) common.HeatExchanger {
        var result: common.HeatExchanger = undefined;
        result.load_MW = self.load;
        if (self.hot) |hot| result.hot_end = hot;
        if (self.cold) |cold| result.cold_end = cold;
        return result;
    }
};

pub const MultiheatOptions = struct {
    version: []const u8,
    temp_unit: []const u8,

    pub fn isValid(self: *const MultiheatOptions) bool {
        if (!std.mem.eql(u8, self.version, "0.0.1")) return false;
        if (!std.mem.eql(u8, self.temp_unit, "K")) return false;
        return true;
    }
};

pub const Config = struct {
    multiheat: MultiheatOptions,
    hot: []const HeatStream,
    cold: []const HeatStream,
    exchanger: ?[]const HeatExchanger,

    pub fn isValid(self: *const Config) bool {
        if (!self.multiheat.isValid()) return false;
        for (self.hot) |stream|
            if (!stream.isValid()) return false;
        for (self.cold) |stream|
            if (!stream.isValid()) return false;
        if (self.exchanger) |exchangers| {
            for (exchangers) |exchanger|
                if (!exchanger.isValid()) return false;
        }
        return true;
    }

    pub fn toSystem(self: *const Config, alloc: std.mem.Allocator) !common.HeatSystem {
        const result: common.HeatSystem = .{
            .hot_streams = try alloc.alloc(common.HeatStream, self.hot.len),
            .cold_streams = try alloc.alloc(common.HeatStream, self.cold.len),
            .exchangers = if (self.exchanger) |exchangers|
                try alloc.alloc(common.HeatExchanger, exchangers.len)
            else
                &[0]common.HeatExchanger{},
        };
        for (result.hot_streams, 0..) |*stream, i| {
            stream.* = self.hot[i].toSystem();
        }
        for (result.cold_streams, 0..) |*stream, i| {
            stream.* = self.cold[i].toSystem();
        }
        for (result.exchangers, 0..) |*exchanger, i| {
            exchanger.* = self.exchanger.?[i].toSystem();
        }
        return result;
    }
};

pub fn parse(allocator: std.mem.Allocator, file_name: []const u8) !toml.Parsed(Config) {
    var parser = toml.Parser(Config).init(allocator);
    defer parser.deinit();

    return try parser.parseFile(file_name);
}
