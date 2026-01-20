const common = @import("common");
const multiheat = @import("multiheat");

// Почему: тонкая точка входа для JS позволяет не менять исходники CLI и контролировать экспортируемое API.

pub const HeatStream = common.HeatStream;
pub const HeatExchanger = common.HeatExchanger;
pub const HeatSystem = common.HeatSystem;

pub const EqCurvePoint = common.EqCurvePoint;
pub const EquivalentCurves = common.EquivalentCurves;

pub const computeRequiredLoad = multiheat.computeRequiredLoad;
pub const solve = multiheat.solve;
pub const solve2 = multiheat.solve2;
pub const verifySolution = multiheat.verifySolution;

pub const computeEquivalentCurves = multiheat.computeEquivalentCurves;
pub const freeEquivalentCurves = multiheat.freeEquivalentCurves;
