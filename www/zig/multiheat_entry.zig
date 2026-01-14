const common = @import("common");
const multiheat = @import("multiheat");

// Почему: для PoC экспортируем только нужные символы, чтобы упростить связывание и избежать сюрпризов ABI.

pub const HeatStream = common.HeatStream;
pub const computeRequiredLoad = multiheat.computeRequiredLoad;
