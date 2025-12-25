const std = @import("std");

const clap = @import("clap");

// const multiheat = @import("multiheat");
const config = @import("config");

const Command = enum {
    help,
    verify,
};

const main_params = clap.parseParamsComptime(
    \\-h, --help        Команда: напечатать инструкцию (этот текст).
    \\--verify          Команда: проверить корректность входных данных или решения.
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

    const command =
        if (res.args.help != 0)
            Command.help
        else if (res.args.verify != 0)
            Command.verify
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
        .verify => {
            if (res.positionals.len < 1) return error.NotEnoughArguments;
            try verifyMain(allocator, res);
        },
    }
}

fn verifyMain(allocator: std.mem.Allocator, args: MainArgs) !void {
    const result = try config.parse(allocator, args.positionals[0].?);
    defer result.deinit();

    const conf = result.value;
    if (!conf.isValid()) return error.InvalidConfiguration;
}
