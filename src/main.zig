const std = @import("std");

const clap = @import("clap");

const multiheat = @import("multiheat");
const config = @import("config");

const Command = enum {
    help,
    checkinput,
    verify,
    solve,
};

const main_params = clap.parseParamsComptime(
    \\-h, --help        Команда: напечатать инструкцию (этот текст).
    \\--checkinput      Команда: проверить корректность входных данных.
    \\--verify          Команда: проверить корректность готового решения.
    \\--solve           Команда: найти решение системы (вывод в формате TOML)
    \\--terse           Вывести только таблицу [[exchanger]].
    \\<input_file>      Путь до файла с описанием системы в формате TOML.
);

const main_parsers = .{
    .input_file = clap.parsers.string,
};

const MainArgs = clap.ResultEx(clap.Help, &main_params, &main_parsers);

pub fn main() !void {
    var arena = std.heap.ArenaAllocator.init(std.heap.page_allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    var iter = try std.process.ArgIterator.initWithAllocator(allocator);
    defer iter.deinit();
    const invocation = iter.next();

    var diag = clap.Diagnostic{};
    var res = clap.parseEx(clap.Help, &main_params, &main_parsers, &iter, .{
        .diagnostic = &diag,
        .allocator = allocator,
    }) catch |err| {
        try diag.reportToFile(.stderr(), err);
        return err;
    };
    defer res.deinit();

    const sumCommands = res.args.checkinput + res.args.verify + res.args.solve;
    if (sumCommands > 1)
        return error.MultipleCommandsSpecified;
    const command =
        if (res.args.help != 0)
            Command.help
        else if (res.args.checkinput != 0)
            Command.checkinput
        else if (res.args.verify != 0)
            Command.verify
        else if (res.args.solve != 0)
            Command.solve
        else
            Command.help;
    switch (command) {
        .help => {
            std.debug.print("Использование:\n    {s} ", .{invocation orelse "multiheat"});
            try clap.usageToFile(.stderr(), clap.Help, &main_params);
            std.debug.print("\n\nАргументы:\n", .{});
            try clap.helpToFile(.stderr(), clap.Help, &main_params, .{
                .description_on_new_line = false,
                .spacing_between_parameters = 0,
            });
        },
        .checkinput => {
            if (res.positionals.len < 1) return error.NotEnoughArguments;
            try checkInputMain(allocator, res);
        },
        .verify => {
            if (res.positionals.len < 1) return error.NotEnoughArguments;
            try verifySolutionMain(allocator, res);
        },
        .solve => {
            if (res.positionals.len < 1) return error.NotEnoughArguments;
            try solveMain(allocator, res);
        },
    }
}

fn checkInputMain(allocator: std.mem.Allocator, args: MainArgs) !void {
    const result = try config.parse(allocator, args.positionals[0].?);
    defer result.deinit();

    const conf = result.value;
    if (!conf.isValid()) return error.InvalidConfiguration;
}

fn verifySolutionMain(allocator: std.mem.Allocator, args: MainArgs) !void {
    const result = try config.parse(allocator, args.positionals[0].?);
    defer result.deinit();

    const conf = result.value;
    if (!conf.isValid()) return error.InvalidConfiguration;

    var system = try conf.toSystem(allocator);
    if (system.exchangers.len == 0) return error.MissingSolution;
    try multiheat.verifySolution(allocator, &system);
}

fn solveMain(allocator: std.mem.Allocator, args: MainArgs) !void {
    const input_path = args.positionals[0].?;
    const original = try std.fs.cwd().readFileAlloc(allocator, input_path, std.math.maxInt(usize));
    defer allocator.free(original);

    const result = try config.parse(allocator, input_path);
    defer result.deinit();

    const conf = result.value;
    if (!conf.isValid()) return error.InvalidConfiguration;

    var system = try conf.toSystem(allocator);
    try multiheat.solve(allocator, &system);

    const terse = args.args.terse != 0;

    const stdout_file = std.fs.File.stdout();

    const out_buf = try allocator.alloc(u8, 65536);
    defer allocator.free(out_buf);
    var stdout = std.fs.File.Writer.init(stdout_file, out_buf);

    if (!terse) {
        try stdout.interface.writeAll(original);
        if (!std.mem.endsWith(u8, original, "\n"))
            try stdout.interface.writeByte('\n');
        try stdout.interface.writeByte('\n');
    }

    for (system.exchangers) |ex| {
        const hex = config.HeatExchanger.fromSystem(ex);
        try hex.dumpToml(&stdout.interface);
    }
    try stdout.interface.flush();
}
