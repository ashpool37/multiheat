const common = @import("common");
const multiheat = @import("multiheat");

// Почему: тонкая точка входа для JS позволяет не менять исходники CLI и контролировать экспортируемое API.

pub const HeatStream = common.HeatStream;
pub const HeatExchanger = common.HeatExchanger;
pub const HeatSystem = common.HeatSystem;

pub const computeRequiredLoad = multiheat.computeRequiredLoad;
pub const solve = multiheat.solve;
pub const verifySolution = multiheat.verifySolution;
