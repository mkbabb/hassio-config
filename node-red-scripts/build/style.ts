import chalk from "chalk";

// Modern styling utilities inspired by Vite/Vitest
export class StyleHelper {
    // Color palette
    static colors = {
        primary: chalk.blue,
        success: chalk.green,
        warning: chalk.yellow,
        error: chalk.red,
        info: chalk.cyan,
        muted: chalk.gray,
        dim: chalk.dim,
        bold: chalk.bold,
        italic: chalk.italic
    };

    // Minimal symbols and indicators
    static symbols = {
        success: "✓",
        error: "✗",
        warning: "!",
        info: "i",
        bullet: "•",
        arrow: "→",
        progress: "▸"
    };

    // Borders and separators
    static borders = {
        light: "─",
        heavy: "═",
        double: "══",
        dotted: "·"
    };

    // Create a banner with title
    static banner(title: string, subtitle?: string): string {
        const width = Math.max(title.length, subtitle?.length || 0) + 4;
        const border = this.borders.heavy.repeat(width);

        let output = "\n" + this.colors.primary(border) + "\n";
        output += this.colors.primary(`  ${this.colors.bold(title)}  `) + "\n";

        if (subtitle) {
            output += this.colors.muted(`  ${subtitle}  `) + "\n";
        }

        output += this.colors.primary(border) + "\n";
        return output;
    }

    // Create a section header
    static section(title: string): string {
        return (
            "\n" +
            this.colors.bold(title) +
            "\n" +
            this.colors.muted(this.borders.light.repeat(title.length))
        );
    }

    // Create a subtle panel for grouping related information
    static panel(content: string[], title?: string): string {
        if (content.length === 0) return "";

        const maxLength = Math.max(
            ...content.map((line) => this.stripAnsi(line).length),
            title ? title.length : 0
        );
        const width = Math.min(maxLength + 4, 80);
        const topBorder = "┌" + "─".repeat(width - 2) + "┐";
        const bottomBorder = "└" + "─".repeat(width - 2) + "┘";

        let output = this.colors.muted(topBorder) + "\n";

        if (title) {
            const titlePadding = " ".repeat(
                Math.max(0, (width - 4 - title.length) / 2)
            );
            output +=
                this.colors.muted("│ ") +
                titlePadding +
                this.colors.bold(title) +
                titlePadding +
                this.colors.muted(" │") +
                "\n";
            output += this.colors.muted("├" + "─".repeat(width - 2) + "┤") + "\n";
        }

        content.forEach((line) => {
            const padding = " ".repeat(
                Math.max(0, width - 4 - this.stripAnsi(line).length)
            );
            output +=
                this.colors.muted("│ ") +
                line +
                padding +
                this.colors.muted(" │") +
                "\n";
        });

        output += this.colors.muted(bottomBorder);
        return output;
    }

    // Format a key-value pair with consistent spacing
    static keyValue(
        key: string,
        value: string,
        keyColor = this.colors.muted,
        valueColor = this.colors.bold
    ): string {
        return `${keyColor(key)}: ${valueColor(value)}`;
    }

    // Create a simple divider
    static divider(length: number = 40): string {
        return this.colors.muted("─".repeat(length));
    }

    // Success message
    static success(message: string, details?: string): string {
        const main = `${this.colors.success(this.symbols.success)} ${this.colors.success(message)}`;
        return details ? `${main}\n  ${this.colors.muted(details)}` : main;
    }

    // Error message
    static error(message: string, details?: string): string {
        const main = `${this.colors.error(this.symbols.error)} ${this.colors.error(message)}`;
        return details ? `${main}\n  ${this.colors.muted(details)}` : main;
    }

    // Warning message
    static warning(message: string, details?: string): string {
        const main = `${this.colors.warning(this.symbols.warning)} ${this.colors.warning(message)}`;
        return details ? `${main}\n  ${this.colors.muted(details)}` : main;
    }

    // Info message
    static info(message: string, details?: string): string {
        const main = `${this.colors.info(this.symbols.info)} ${this.colors.info(message)}`;
        return details ? `${main}\n  ${this.colors.muted(details)}` : main;
    }

    // Build progress indicator
    static building(filename: string): string {
        return `${this.colors.primary(this.symbols.progress)} Building ${this.colors.bold(filename)}...`;
    }

    // Build completion
    static built(filename: string, time?: number): string {
        const timeStr = time ? ` ${this.colors.muted(`(${time}ms)`)}` : "";
        return `${this.colors.success(this.symbols.success)} Built ${this.colors.bold(filename)}${timeStr}`;
    }

    // Summary box
    static summary(stats: {
        total?: number;
        built?: number;
        cached?: number;
        failed?: number;
        time?: number;
    }): string {
        const lines: string[] = [];

        if (stats.total !== undefined) {
            lines.push(`Total files: ${this.colors.bold(stats.total.toString())}`);
        }

        if (stats.built !== undefined && stats.built > 0) {
            lines.push(
                `${this.colors.success("Built")}: ${this.colors.bold(stats.built.toString())}`
            );
        }

        if (stats.cached !== undefined && stats.cached > 0) {
            lines.push(
                `${this.colors.info("Cached")}: ${this.colors.bold(stats.cached.toString())}`
            );
        }

        if (stats.failed !== undefined && stats.failed > 0) {
            lines.push(
                `${this.colors.error("Failed")}: ${this.colors.bold(stats.failed.toString())}`
            );
        }

        if (stats.time !== undefined) {
            const timeStr =
                stats.time > 1000
                    ? `${(stats.time / 1000).toFixed(2)}s`
                    : `${stats.time}ms`;
            lines.push(`${this.colors.muted("Time")}: ${this.colors.bold(timeStr)}`);
        }

        if (lines.length === 0) return "";

        const maxLength = Math.max(...lines.map((line) => this.stripAnsi(line).length));
        const border = this.borders.light.repeat(maxLength + 4);

        let output = "\n" + this.colors.muted("╭" + border + "╮") + "\n";
        lines.forEach((line) => {
            const padding = " ".repeat(maxLength - this.stripAnsi(line).length);
            output +=
                this.colors.muted("│ ") +
                line +
                padding +
                this.colors.muted(" │") +
                "\n";
        });
        output += this.colors.muted("╰" + border + "╯") + "\n";

        return output;
    }

    // Watch mode indicator
    static watching(directory: string): string {
        return (
            `\n${this.colors.info("Watching for changes in")} ${this.colors.bold(directory)}...\n` +
            this.colors.muted("  Press Ctrl+C to exit\n")
        );
    }

    // File change notification
    static fileChanged(
        filename: string,
        action: "added" | "changed" | "removed" = "changed"
    ): string {
        const actionColors = {
            added: this.colors.success,
            changed: this.colors.warning,
            removed: this.colors.error
        };

        const actionSymbols = {
            added: "+",
            changed: "~",
            removed: "-"
        };

        return `${actionColors[action](actionSymbols[action])} ${this.colors.muted("File")} ${this.colors.bold(filename)} ${action}`;
    }

    // Cache operations
    static cacheOperation(operation: string, details?: string): string {
        return `${this.colors.info(operation)}${details ? ` ${this.colors.muted(details)}` : ""}`;
    }

    // Performance timing
    static timing(label: string, time: number): string {
        const timeStr =
            time > 1000 ? `${(time / 1000).toFixed(2)}s` : `${Math.round(time)}ms`;
        const color = time > 1000 ? this.colors.warning : this.colors.muted;
        return `${this.colors.muted(label)}: ${color(timeStr)}`;
    }

    // Utility to strip ANSI codes for length calculation
    private static stripAnsi(str: string): string {
        return str.replace(/\u001b\[[0-9;]*m/g, "");
    }

    // Create a progress bar
    static progressBar(current: number, total: number, width: number = 20): string {
        const percentage = Math.round((current / total) * 100);
        const filled = Math.round((current / total) * width);
        const empty = width - filled;

        const bar =
            this.colors.success("█".repeat(filled)) +
            this.colors.muted("░".repeat(empty));
        return `[${bar}] ${percentage}% (${current}/${total})`;
    }
}
