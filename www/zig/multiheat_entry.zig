const common = @import("common");
const multiheat = @import("multiheat");
const build_options = @import("build_options");

// Почему: тонкая точка входа для JS позволяет не менять исходники CLI и контролировать экспортируемое API.

// Версии должны задаваться на уровне сборки и экспортироваться в JS/WASM как единый источник правды.
//
// Важно: экспорт строк `[]const u8` через zigar может приходить в JS как объект-обёртка,
// поэтому дополнительно экспортируем численные компоненты версий (u16), чтобы Web UI мог
// надёжно собрать строку версии без декодирования.
pub const multiheat_version = build_options.multiheat_version;
pub const multiheat_version_major: u16 = build_options.multiheat_version_major;
pub const multiheat_version_minor: u16 = build_options.multiheat_version_minor;
pub const multiheat_version_patch: u16 = build_options.multiheat_version_patch;

pub const earliest_config_version = build_options.earliest_config_version;
pub const earliest_config_version_major: u16 = build_options.earliest_config_version_major;
pub const earliest_config_version_minor: u16 = build_options.earliest_config_version_minor;
pub const earliest_config_version_patch: u16 = build_options.earliest_config_version_patch;

pub const HeatStream = common.HeatStream;
pub const HeatExchanger = common.HeatExchanger;
pub const HeatSystem = common.HeatSystem;

pub const EqCurvePoint = common.EqCurvePoint;
pub const EquivalentCurves = common.EquivalentCurves;

pub const computeRequiredLoad = multiheat.computeRequiredLoad;

// Новый API (явные имена алгоритмов)
pub const solve_greedy = multiheat.solve_greedy;
pub const solve_curves = multiheat.solve_curves;
pub const solve_trivial = multiheat.solve_trivial;

// Совместимость со старым API
pub const solve = multiheat.solve;
pub const solve2 = multiheat.solve2;

pub const verifySolution = multiheat.verifySolution;

pub const computeEquivalentCurves = multiheat.computeEquivalentCurves;
pub const freeEquivalentCurves = multiheat.freeEquivalentCurves;
