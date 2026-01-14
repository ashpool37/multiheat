pub const HeatStream = struct {
    isothermal: bool,
    in_temp_K: f32, // T_in
    out_temp_K: f32, // T_out
    rate_MW_per_K: f32, // W
    load_MW: f32, // q
};

pub const HeatExchanger = struct {
    hot_end: ?u16, // index in hot_streams
    cold_end: ?u16, // index in cold_streams
    load_MW: f32, // W
};

pub const HeatSystem = struct {
    min_dt: u16 = 20,
    def_dt: u16 = 30,
    hot_streams: []HeatStream,
    cold_streams: []HeatStream,
    exchangers: []HeatExchanger,
};
