pub const HeatStream = struct {
    isothermal: bool,
    in_temp_K: f32,
    out_temp_K: f32,
    rate_MW_per_K: f32,
    load_MW: f32,
};

pub const HeatExchanger = struct {
    hot_end: ?u16,
    cold_end: ?u16,
    load_MW: f32,
};

pub const HeatSystem = struct {
    hot_streams: []HeatStream,
    cold_streams: []HeatStream,
    exchangers: []HeatExchanger,
};
