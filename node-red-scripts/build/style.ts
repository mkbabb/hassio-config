/**
 * Console Output Styling System
 *
 * Vite-inspired terminal formatting utilities for the build system. Provides consistent,
 * visually appealing output with color-coded messages, bordered panels, progress indicators,
 * and status symbols.
 *
 * Design principles:
 * - Minimal, clean aesthetics (no excessive decoration)
 * - Consistent color semantics (green=success, red=error, yellow=warning, cyan=info)
 * - Proper ANSI code handling for accurate width calculations
 * - Box-drawing characters for structured output
 *
 * @module build/style
 *
 * @example
 * console.log(StyleHelper.banner("Build System", "Compiling TypeScript"));
 * console.log(StyleHelper.success("Built app.ts", "142ms"));
 * console.log(StyleHelper.panel(
 *   ["Total: 42", "Built: 38", "Cached: 4"],
 *   "Summary"
 * ));
 */

import chalk from "chalk";

export class StyleHelper {
    /**
     * Semantic color palette for consistent terminal output.
     * Uses chalk color functions for cross-platform ANSI support.
     *
     * @property {Function} primary - Blue for primary elements (borders, headers)
     * @property {Function} success - Green for successful operations
     * @property {Function} warning - Yellow for warnings and modifications
     * @property {Function} error - Red for errors and failures
     * @property {Function} info - Cyan for informational messages
     * @property {Function} muted - Gray for secondary/less important text
     * @property {Function} dim - Dimmed text (reduced brightness)
     * @property {Function} bold - Bold weight for emphasis
     * @property {Function} italic - Italic style for metadata
     */
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

    /**
     * Unicode symbols for status indicators and visual markers.
     * Cross-platform compatible characters for terminal output.
     *
     * @property {string} success - Checkmark (✓) for successful operations
     * @property {string} error - Cross (✗) for failures
     * @property {string} warning - Exclamation (!) for warnings
     * @property {string} info - Info (i) for informational messages
     * @property {string} bullet - Bullet point (•) for lists
     * @property {string} arrow - Right arrow (→) for directional flow
     * @property {string} progress - Triangle (▸) for in-progress operations
     */
    static symbols = {
        success: "✓",
        error: "✗",
        warning: "!",
        info: "i",
        bullet: "•",
        arrow: "→",
        progress: "▸"
    };

    /**
     * Box-drawing characters for borders and separators.
     * Unicode line-drawing characters for structured layouts.
     *
     * @property {string} light - Light horizontal line (─)
     * @property {string} heavy - Heavy horizontal line (═)
     * @property {string} double - Double heavy line (══)
     * @property {string} dotted - Dotted separator (·)
     */
    static borders = {
        light: "─",
        heavy: "═",
        double: "══",
        dotted: "·"
    };

    /**
     * Creates a prominent banner for major sections or startup messages.
     * Uses heavy borders with centered title and optional subtitle.
     *
     * @param title - Main banner text (bold, centered)
     * @param subtitle - Optional secondary text (muted, centered)
     * @returns Formatted banner with top/bottom borders
     *
     * @example
     * StyleHelper.banner("Node-RED TypeScript Builder", "Compiling automation functions")
     * // ══════════════════════════════
     * //   Node-RED TypeScript Builder
     * //   Compiling automation functions
     * // ══════════════════════════════
     */
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

    /**
     * Creates a simple section header with underline.
     * Lighter-weight alternative to banner() for subsections.
     *
     * @param title - Section heading text
     * @returns Bold title with light underline
     *
     * @example
     * StyleHelper.section("Build Summary")
     * // Build Summary
     * // ─────────────
     */
    static section(title: string): string {
        return (
            "\n" +
            this.colors.bold(title) +
            "\n" +
            this.colors.muted(this.borders.light.repeat(title.length))
        );
    }

    /**
     * Creates a bordered panel for grouping related information.
     * Uses box-drawing characters with optional centered title.
     *
     * @param content - Array of lines to display in panel
     * @param title - Optional panel title (centered above content)
     * @returns Formatted panel with borders, max width 80 characters
     *
     * @example
     * StyleHelper.panel(
     *   ["File: src/app.ts", "Confidence: 99%", "Status: Mapped"],
     *   "Match Found"
     * )
     * // ┌─────────────────┐
     * // │   Match Found   │
     * // ├─────────────────┤
     * // │ File: src/app.ts│
     * // │ Confidence: 99% │
     * // │ Status: Mapped  │
     * // └─────────────────┘
     */
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

    /**
     * Formats a key-value pair with consistent spacing and colors.
     * Used for metadata display in panels and summaries.
     *
     * @param key - Property name (left side)
     * @param value - Property value (right side)
     * @param keyColor - Color function for key (default: muted)
     * @param valueColor - Color function for value (default: bold)
     * @returns Formatted string "key: value"
     *
     * @example
     * StyleHelper.keyValue("File", "app.ts")
     * // File: app.ts (muted key, bold value)
     *
     * StyleHelper.keyValue("Status", "Success", StyleHelper.colors.info, StyleHelper.colors.success)
     * // Status: Success (cyan key, green value)
     */
    static keyValue(
        key: string,
        value: string,
        keyColor = this.colors.muted,
        valueColor = this.colors.bold
    ): string {
        return `${keyColor(key)}: ${valueColor(value)}`;
    }

    /**
     * Creates a horizontal divider line.
     * Useful for separating sections in output.
     *
     * @param length - Width of divider in characters (default: 40)
     * @returns Muted horizontal line
     *
     * @example
     * StyleHelper.divider(50)
     * // ──────────────────────────────────────────────────
     */
    static divider(length: number = 40): string {
        return this.colors.muted("─".repeat(length));
    }

    /**
     * Formats a success message with checkmark symbol.
     * Green color for positive feedback.
     *
     * @param message - Main success message
     * @param details - Optional secondary information (muted, indented)
     * @returns Formatted success message with ✓ symbol
     *
     * @example
     * StyleHelper.success("Build complete", "142ms")
     * // ✓ Build complete
     * //   142ms
     */
    static success(message: string, details?: string): string {
        const main = `${this.colors.success(this.symbols.success)} ${this.colors.success(message)}`;
        return details ? `${main}\n  ${this.colors.muted(details)}` : main;
    }

    /**
     * Formats an error message with cross symbol.
     * Red color for failure feedback.
     *
     * @param message - Main error message
     * @param details - Optional error details (muted, indented)
     * @returns Formatted error message with ✗ symbol
     *
     * @example
     * StyleHelper.error("Build failed", "TypeError: undefined")
     * // ✗ Build failed
     * //   TypeError: undefined
     */
    static error(message: string, details?: string): string {
        const main = `${this.colors.error(this.symbols.error)} ${this.colors.error(message)}`;
        return details ? `${main}\n  ${this.colors.muted(details)}` : main;
    }

    /**
     * Formats a warning message with exclamation symbol.
     * Yellow color for cautionary feedback.
     *
     * @param message - Main warning message
     * @param details - Optional warning details (muted, indented)
     * @returns Formatted warning message with ! symbol
     *
     * @example
     * StyleHelper.warning("Deprecated API usage", "Use newMethod() instead")
     * // ! Deprecated API usage
     * //   Use newMethod() instead
     */
    static warning(message: string, details?: string): string {
        const main = `${this.colors.warning(this.symbols.warning)} ${this.colors.warning(message)}`;
        return details ? `${main}\n  ${this.colors.muted(details)}` : main;
    }

    /**
     * Formats an informational message with info symbol.
     * Cyan color for neutral information.
     *
     * @param message - Main informational message
     * @param details - Optional additional info (muted, indented)
     * @returns Formatted info message with i symbol
     *
     * @example
     * StyleHelper.info("Starting build process", "37 files to compile")
     * // i Starting build process
     * //   37 files to compile
     */
    static info(message: string, details?: string): string {
        const main = `${this.colors.info(this.symbols.info)} ${this.colors.info(message)}`;
        return details ? `${main}\n  ${this.colors.muted(details)}` : main;
    }

    /**
     * Formats a build progress indicator.
     * Shows triangle symbol with filename during compilation.
     *
     * @param filename - File currently being built
     * @returns Progress message with ▸ symbol
     *
     * @example
     * StyleHelper.building("src/app.ts")
     * // ▸ Building src/app.ts...
     */
    static building(filename: string): string {
        return `${this.colors.primary(this.symbols.progress)} Building ${this.colors.bold(filename)}...`;
    }

    /**
     * Formats a build completion message.
     * Shows checkmark with filename and optional timing.
     *
     * @param filename - File that was built
     * @param time - Optional build time in milliseconds
     * @returns Success message with ✓ symbol
     *
     * @example
     * StyleHelper.built("src/app.ts", 142)
     * // ✓ Built src/app.ts (142ms)
     */
    static built(filename: string, time?: number): string {
        const timeStr = time ? ` ${this.colors.muted(`(${time}ms)`)}` : "";
        return `${this.colors.success(this.symbols.success)} Built ${this.colors.bold(filename)}${timeStr}`;
    }

    /**
     * Creates a formatted summary box with build statistics.
     * Uses rounded box-drawing characters (╭╮╰╯) for a polished look.
     *
     * @param stats - Statistics object with optional properties
     * @param stats.total - Total number of files
     * @param stats.built - Number of files built
     * @param stats.cached - Number of files served from cache
     * @param stats.failed - Number of files that failed
     * @param stats.time - Total build time in milliseconds
     * @returns Formatted summary box, or empty string if no stats
     *
     * @example
     * StyleHelper.summary({ total: 42, built: 38, cached: 4, time: 1523 })
     * // ╭───────────────────╮
     * // │ Total files: 42   │
     * // │ Built: 38         │
     * // │ Cached: 4         │
     * // │ Time: 1.52s       │
     * // ╰───────────────────╯
     */
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

    /**
     * Formats a watch mode header message.
     * Indicates that the build system is monitoring for file changes.
     *
     * @param directory - Directory being watched
     * @returns Watch mode message with exit instructions
     *
     * @example
     * StyleHelper.watching("src/")
     * // Watching for changes in src/...
     * //   Press Ctrl+C to exit
     */
    static watching(directory: string): string {
        return (
            `\n${this.colors.info("Watching for changes in")} ${this.colors.bold(directory)}...\n` +
            this.colors.muted("  Press Ctrl+C to exit\n")
        );
    }

    /**
     * Formats a file change notification for watch mode.
     * Different colors for added (green), changed (yellow), removed (red).
     *
     * @param filename - File that changed
     * @param action - Type of change (default: "changed")
     * @returns Formatted change notification
     *
     * @example
     * StyleHelper.fileChanged("app.ts", "changed")
     * // ~ File app.ts changed
     *
     * StyleHelper.fileChanged("new.ts", "added")
     * // + File new.ts added
     */
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

    /**
     * Formats a cache operation message.
     * Generic formatter for cache hits, misses, and updates.
     *
     * @param operation - Cache operation description
     * @param details - Optional additional information
     * @returns Formatted cache message
     *
     * @example
     * StyleHelper.cacheOperation("Cache hit", "app.ts")
     * // Cache hit app.ts
     */
    static cacheOperation(operation: string, details?: string): string {
        return `${this.colors.info(operation)}${details ? ` ${this.colors.muted(details)}` : ""}`;
    }

    /**
     * Formats a performance timing measurement.
     * Converts to seconds if >1000ms. Warns on slow operations (>1s).
     *
     * @param label - Operation label
     * @param time - Duration in milliseconds
     * @returns Formatted timing string
     *
     * @example
     * StyleHelper.timing("Build time", 142)
     * // Build time: 142ms
     *
     * StyleHelper.timing("Build time", 1523)
     * // Build time: 1.52s (yellow warning)
     */
    static timing(label: string, time: number): string {
        const timeStr =
            time > 1000 ? `${(time / 1000).toFixed(2)}s` : `${Math.round(time)}ms`;
        const color = time > 1000 ? this.colors.warning : this.colors.muted;
        return `${this.colors.muted(label)}: ${color(timeStr)}`;
    }

    /**
     * Strips ANSI escape codes from a string.
     * Used internally for accurate width calculations in bordered layouts.
     *
     * @param str - String potentially containing ANSI codes
     * @returns Plain string with all ANSI codes removed
     *
     * @example
     * stripAnsi("\u001b[32mSuccess\u001b[0m") // "Success"
     */
    private static stripAnsi(str: string): string {
        return str.replace(/\u001b\[[0-9;]*m/g, "");
    }

    /**
     * Creates an ASCII progress bar.
     * Uses filled (█) and empty (░) block characters.
     *
     * @param current - Current progress value
     * @param total - Maximum progress value
     * @param width - Bar width in characters (default: 20)
     * @returns Formatted progress bar with percentage
     *
     * @example
     * StyleHelper.progressBar(38, 42, 20)
     * // [██████████████████░░] 90% (38/42)
     */
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
