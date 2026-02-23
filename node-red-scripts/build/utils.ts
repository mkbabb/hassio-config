/**
 * Build System Utilities
 *
 * Core utilities for the Node-RED TypeScript build system. Provides file discovery,
 * caching, dependency tracking, and esbuild integration for incremental compilation.
 *
 * Key responsibilities:
 * - File scanning with blacklist filtering
 * - MD5-based change detection
 * - Persistent cache management (24hr staleness window)
 * - Dependency extraction from esbuild metafiles
 * - CommonJS wrapper cleanup for Node-RED compatibility
 *
 * @module build/utils
 */

import { existsSync, readFileSync, writeFileSync } from "fs";
import { readdir, stat, unlink, readFile, writeFile, rm, mkdir } from "fs/promises";
import { resolve, relative, join, basename } from "path";
import crypto from "crypto";
import chalk from "chalk";
import * as esbuild from "esbuild";

/**
 * Node-RED compatibility footer appended to all compiled functions.
 * Required for message passing in Node-RED function nodes.
 */
export const RETURN_MSG = "\nreturn msg;";

/**
 * Paths excluded from file scanning.
 * Prevents compilation of dependencies, type definitions, and deployment scripts.
 */
export const DEFAULT_BLACKLIST = ["node_modules", /\.d\.ts$/, "src/deploy"];

/**
 * Persistent cache file location for storing compilation metadata.
 */
export const CACHE_FILE = ".build-cache.json";

/**
 * Cache expiration window in milliseconds.
 * Entries older than 24 hours are considered stale and trigger rebuilds.
 */
export const CACHE_STALE_TIME = 24 * 60 * 60 * 1000;

/**
 * Metadata for a single cached compilation.
 */
export interface CacheEntry {
    /** MD5 hash of source file content */
    hash: string;
    /** Unix timestamp of last validation check */
    lastChecked: number;
    /** Absolute paths of imported dependencies */
    dependencies: string[];
}

/**
 * Build cache mapping file paths to their compilation metadata.
 */
export interface BuildCache {
    [filePath: string]: CacheEntry;
}

/**
 * Recursively discovers TypeScript files in a directory tree.
 * Filters out blacklisted paths (node_modules, .d.ts, deployment scripts).
 *
 * @param dir - Root directory to scan
 * @param recursive - Whether to traverse subdirectories
 * @param debug - Enable verbose logging of scan progress
 * @returns Array of absolute paths to .ts files
 */
export async function getFiles(dir: string, recursive: boolean, debug: boolean): Promise<string[]> {
    const files: string[] = [];

    try {
        const list = await readdir(dir);

        for (const file of list) {
            const filePath = resolve(dir, file);

            if (shouldSkipPath(filePath, debug)) {
                continue;
            }

            const fileStat = await stat(filePath);

            if (fileStat.isDirectory() && recursive) {
                if (debug) {
                    console.log(chalk.blue(`Scanning directory: ${filePath}`));
                }
                files.push(...(await getFiles(filePath, recursive, debug)));
            } else if (fileStat.isFile() && filePath.endsWith(".ts")) {
                files.push(filePath);
            }
        }
    } catch (error) {
        console.error(chalk.red(`Error reading directory ${dir}:`), error);
    }

    return files;
}

/**
 * Checks if a path should be excluded from compilation.
 * Matches against DEFAULT_BLACKLIST patterns (strings and regex).
 *
 * @param filePath - Path to validate
 * @param debug - Enable logging of skipped paths
 */
function shouldSkipPath(filePath: string, debug: boolean): boolean {
    const shouldSkip = DEFAULT_BLACKLIST.some((item) =>
        item instanceof RegExp ? item.test(filePath) : filePath.includes(item)
    );

    if (shouldSkip && debug) {
        console.log(chalk.yellow(`Skipping blacklisted path: ${filePath}`));
    }

    return shouldSkip;
}

/**
 * Deletes a compiled output file.
 * Used when source files are deleted to keep dist/ synchronized.
 *
 * @param outputPath - Absolute path to the .js file to remove
 */
export async function removeOutputFile(outputPath: string): Promise<void> {
    if (existsSync(outputPath)) {
        await unlink(outputPath).catch(() => {});
        console.log(chalk.yellow(`Removed output file: ${outputPath}`));
    }
}

/**
 * Recursively clears a directory and recreates it.
 * Typically used to clean the dist/ directory before full rebuilds.
 *
 * @param dir - Directory path to empty
 */
export async function emptyDirectory(dir: string): Promise<void> {
    console.log(chalk.yellow(`Emptying output directory: ${dir}`));
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    await mkdir(dir, { recursive: true });
}

/**
 * Generates MD5 hash of file contents for change detection.
 * Used to determine if a file needs recompilation by comparing hashes.
 *
 * @param filePath - Absolute path to file
 * @returns 32-character hexadecimal MD5 digest
 */
export function calculateHash(filePath: string): string {
    const content = readFileSync(filePath);
    return crypto.createHash("md5").update(content).digest("hex");
}

/**
 * Loads persistent build cache from disk.
 * Falls back to empty cache if file doesn't exist or is corrupted.
 *
 * @param debug - Enable cache loading confirmation
 * @returns Deserialized cache or empty object on failure
 */
export async function loadCache(debug: boolean): Promise<BuildCache> {
    try {
        if (existsSync(CACHE_FILE)) {
            const cacheData = readFileSync(CACHE_FILE, "utf8");
            console.log(chalk.gray("Cache loaded"));
            return JSON.parse(cacheData);
        }
    } catch (error) {
        console.warn(chalk.yellow("Failed to load cache file, starting fresh"));
    }
    return {};
}

/**
 * Persists build cache to disk as JSON.
 * Enables fast incremental builds across sessions.
 *
 * @param cache - Current cache state to serialize
 * @param debug - Enable cache save confirmation
 */
export async function saveCache(cache: BuildCache, debug: boolean): Promise<void> {
    try {
        writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
        if (debug) {
            console.log(chalk.gray("Cache saved to disk"));
        }
    } catch (error) {
        console.error(chalk.red("Failed to save cache file:"), error);
    }
}

/**
 * Extracts import dependencies from esbuild metafile.
 * Used to build dependency graphs for tracking which files need rebuilding
 * when dependencies change.
 *
 * @param metafile - esbuild compilation metadata containing input relationships
 * @param inputFile - Source file being analyzed (excluded from results)
 * @param debug - Enable logging of discovered dependencies
 * @returns Absolute paths of all imported modules
 */
export function extractDependencies(metafile: esbuild.Metafile, inputFile: string, debug: boolean): string[] {
    const dependencies: string[] = [];

    if (metafile?.inputs) {
        for (const depPath of Object.keys(metafile.inputs)) {
            if (resolve(depPath) !== resolve(inputFile)) {
                const resolvedPath = resolve(depPath);
                dependencies.push(resolvedPath);

                if (debug) {
                    console.log(chalk.gray(`Extracted dependency: ${inputFile} -> ${resolvedPath}`));
                }
            }
        }
    }

    return dependencies;
}

/**
 * Removes CommonJS export patterns from compiled output.
 * Node-RED function nodes require clean IIFE output without module.exports
 * or other CommonJS artifacts that esbuild may inject.
 *
 * Strips patterns like:
 * - `module.exports = __toCommonJS(...)`
 * - `exports.foo = ...`
 * - `Object.defineProperty(exports, ...)`
 *
 * @param filePath - Absolute path to compiled .js file
 * @param debug - Enable logging of strip operations
 */
export async function stripCommonJSWrapper(filePath: string, debug: boolean): Promise<void> {
    try {
        let content = await readFile(filePath, 'utf8');

        const patterns = [
            /var __defProp[\s\S]*?module\.exports\s*=\s*__toCommonJS\([^)]+\);[\r\n]*/g,
            /module\.exports\s*=\s*[^;]+;[\r\n]*/g,
            /exports\.[a-zA-Z_$][a-zA-Z0-9_$]*\s*=\s*[^;]+;[\r\n]*/g,
            /Object\.defineProperty\(exports,[\s\S]*?\);[\r\n]*/g,
            /var [a-zA-Z_$][a-zA-Z0-9_$]*_exports\s*=\s*\{\};[\r\n]*/g
        ];

        for (const pattern of patterns) {
            content = content.replace(pattern, '');
        }

        await writeFile(filePath, content, 'utf8');

        if (debug) {
            console.log(chalk.gray(`Stripped CommonJS wrapper from ${basename(filePath)}`));
        }
    } catch (error) {
        console.error(chalk.red(`Failed to strip CommonJS wrapper from ${filePath}:`), error);
    }
}

/**
 * Converts source TypeScript path to corresponding dist JavaScript path.
 * Preserves directory structure and replaces .ts with .js extension.
 *
 * @param inputFile - Absolute path to source .ts file
 * @param inputDir - Root source directory (e.g., "src")
 * @param outputDir - Root output directory (e.g., "dist")
 * @returns Corresponding output path in dist directory
 *
 * @example
 * getOutputPath("/app/src/utils/foo.ts", "/app/src", "/app/dist")
 * // Returns: "/app/dist/utils/foo.js"
 */
export function getOutputPath(inputFile: string, inputDir: string, outputDir: string): string {
    return join(outputDir, relative(inputDir, inputFile).replace(/\.ts$/, ".js"));
}

/**
 * Computes relative path from base directory to target file.
 *
 * @param file - Absolute path to target file
 * @param baseDir - Base directory for relative path calculation
 * @returns Relative path string
 */
export function getRelativePath(file: string, baseDir: string): string {
    return relative(baseDir, file);
}